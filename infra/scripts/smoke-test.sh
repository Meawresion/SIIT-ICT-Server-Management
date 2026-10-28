#!/usr/bin/env bash
# Deploys a throwaway copy of the portal (data, queues, app and web in direct mode on the ALB's
# AWS name, with a placeholder Google client), checks it, then deletes what it deployed and checks
# that nothing is left behind. The stacks are deleted even when a step fails or the run is stopped.
# Provisioning is on, with a throwaway site key: fake-site.mjs plays acc-prov-vm on the real queues.
#
# Kept between runs: network and platform (the ECR images; they run nothing), created here only
# when they are missing (first run, or after a Learner Lab reset); images already in ECR are not
# uploaded again. The dns stack is left alone too. Only teardown-all.sh deletes them.
#
# Usage: smoke-test.sh [--keep | --teardown]
#   --keep: leave the test stacks running (delete them later with --teardown)
#   --teardown: only delete the test stacks and check (after a run that was killed hard)
# The private half of the throwaway site key stays in this shell; it is never printed or stored.
read -r SITE_PRIVATE_KEY SITE_PUBLIC_KEYS < <(node --input-type=module -e "
  import { resolve } from 'node:path'; import { pathToFileURL } from 'node:url';
  const { generateKeyBundle } = await import(pathToFileURL(resolve(process.argv[1])));
  const k = generateKeyBundle('smoke-site'); console.log(k.privateBundle, k.publicBundle);" \
  "$(dirname "$0")/../../backend/src/messaging/envelope.js")
export ENTRY_MODE=direct USE_DOMAIN=false PROVISIONING=true SITE_PUBLIC_KEYS GPU_NODES=smoke-node \
  OVPN_PROFILE_URL=https://example.com/smoke-ovpn MANUAL_GPU_URL=https://example.com/smoke-manual
. "$(dirname "$0")/lib.sh"
SCRIPTS="$(dirname "$0")"
STACK_TEST_GOOGLE="$PROJECT-test-google"
# What this run deletes at the end. Never the kept stacks.
TEST_STACKS=("$STACK_WEB" "$STACK_APP" "$STACK_QUEUES" "$STACK_DATA" "$STACK_TEST_GOOGLE")
keep=false
[ "${1:-}" = --keep ] && keep=true
started=$(date +%s)
elapsed() { echo "$(( ($(date +%s) - started) / 60 )) min"; }

failures=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; failures=$((failures + 1)); }
expect() { # expect <label> <wanted> <got>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$3', want '$2')"; fi
}

teardown() {
  local status=$?
  trap - EXIT INT TERM
  set +e
  [ -n "${site_pid:-}" ] && kill "$site_pid" 2>/dev/null
  if [ "$keep" = true ]; then
    echo "Kept the test stacks (--keep). Delete them with: smoke-test.sh --teardown"
    exit "$status"
  fi
  echo "== teardown after $(elapsed) (keeps ${KEPT_STACKS[*]})"
  delete_stacks "${TEST_STACKS[@]}" || status=1
  # A late Lambda log line (queues stack) could recreate its log group just after the delete.
  sleep 60
  leftovers "$STACK_DNS" "${KEPT_STACKS[@]}" || status=1
  echo "Kept for the next run:"
  show_kept
  [ "$failures" = 0 ] || status=1
  if [ "$failures" = 0 ] && [ "$status" != 0 ]; then echo "A deploy step failed (see above)."; fi
  echo "$failures check(s) failed. Total $(elapsed)."
  exit "$status"
}
trap teardown EXIT
# Ctrl+C or a kill also tears down (only the test stacks).
trap 'exit 130' INT TERM
if [ "${1:-}" = --teardown ]; then echo "== teardown only"; exit 0; fi

echo "== deploy (ENTRY_MODE=$ENTRY_MODE, USE_DOMAIN=$USE_DOMAIN)"
for stack in "${KEPT_STACKS[@]}"; do
  state=$(awst cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].StackStatus' 2>/dev/null || echo missing)
  echo "   $stack: $state"
done
# Creates network and platform when they are missing; otherwise a quick no-op (or an update).
"$SCRIPTS/deploy.sh" network platform
"$SCRIPTS/push-images.sh"
deploy "$STACK_TEST_GOOGLE" test-google.yaml "Project=$PROJECT"
GOOGLE_SECRET_ARN=$(stack_output "$STACK_TEST_GOOGLE" SecretArn)
export GOOGLE_SECRET_ARN
"$SCRIPTS/deploy.sh" data queues app web

url=$(stack_output "$STACK_APP" PublicUrl)
echo "== checks against $url (after $(elapsed))"
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
wait_for_200() { # the ALB registers the task, and MySQL may still be running init.sql on EFS
  for _ in $(seq 1 40); do [ "$(status "$1")" = 200 ] && return; sleep 15; done
}
wait_for_200 "$url/health"
wait_for_200 "$url/health/ready"
wait_for_200 "$url/"
expect "backend answers through the ALB (/health)" 200 "$(status "$url/health")"
expect "backend reaches MySQL through the internal NLB as the app user (/health/ready)" 200 "$(status "$url/health/ready")"
has_root() { curl -s "$1" | grep -c '<div id="root">'; }
expect "frontend answers through the ALB (/)" 1 "$(has_root "$url/")"
expect "a client-side route gets index.html (/requests)" 1 "$(has_root "$url/requests")"
expect "an unknown asset is 404, not index.html" 404 "$(status "$url/assets/missing.js")"
expect "no sign-in token gives 401 (/api/auth/me)" 401 "$(status "$url/api/auth/me")"
expect "a state change from another origin gives 403" 403 "$(status -X POST -H 'Origin: https://evil.example' "$url/api/auth/logout")"
redirect=$(curl -s "$url/api/auth/google" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(new URL(JSON.parse(s).auth_url).searchParams.get("redirect_uri"))}catch{console.log("none")}})')
expect "Google sign-in starts with this deploy's callback URL" "$url/api/auth/google/callback" "$redirect"
if "$SCRIPTS/run-task.sh" node scripts/check-db.js; then
  pass "database integration check in a one-off task (run-task.sh check-db)"
else
  fail "database integration check in a one-off task"
fi

# Provisioning through the real queues: a one-off task approves a GPU request, the backend service
# sends the CREATE job, fake-site.mjs answers it, the request becomes On Use; then the REVOKE.
REQUEST_QUEUE_URL=$(stack_output "$STACK_QUEUES" RequestQueueUrl) RESULT_QUEUE_URL=$(stack_output "$STACK_QUEUES" ResultQueueUrl) \
  BACKEND_PUBLIC_KEY=$(stack_output "$STACK_QUEUES" BackendPublicKey) SITE_PRIVATE_KEY=$SITE_PRIVATE_KEY \
  node "$SCRIPTS/fake-site.mjs" 2 900 &
site_pid=$!
if "$SCRIPTS/run-task.sh" node scripts/check-provisioning.js; then
  pass "GPU request set up and revoked through SQS by the backend service (run-task.sh check-provisioning)"
else
  fail "provisioning through SQS"
fi
if wait "$site_pid"; then pass "the fake site opened both signed and encrypted jobs and answered"; else fail "fake site"; fi
site_pid=
