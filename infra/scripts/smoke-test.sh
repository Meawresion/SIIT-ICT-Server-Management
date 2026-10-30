#!/usr/bin/env bash
# Deploys a throwaway copy of the portal (data, secrets, app and web in direct mode on the
# ALB's AWS name; the secrets stack keeps its placeholders: no real Google client, emails off), checks it, then deletes what it deployed and checks
# that nothing is left behind. The stacks are deleted even when a step fails or the run is stopped.
# Provisioning is on, with a throwaway site key: fake-site.mjs plays acc-prov-vm on the real queues.
# The scheduler runs every 30 s, so check-scheduler.js sees it act.
#
# Kept between runs: network, platform (the ECR images), queues (the backend key acc-prov-vm is set
# up with) and logs (the S3 log archive), created here only when they are missing; images already
# in ECR are not uploaded again. The dns and cert stacks are left alone too. Only teardown-all.sh
# deletes them. Don't run this while the real acc-prov-vm is connected to the queues: it would take
# the test jobs, which are sealed for the throwaway site key, and dead-letter them.
#
# Usage: smoke-test.sh [--domain] [--keep | --teardown]
#   --domain: deploy on APP_HOST.ZONE_NAME with the certificate (the dns and cert stacks must exist),
#             so HTTPS and the HTTP -> HTTPS redirect are checked too
#   --keep: leave the test stacks running (delete them later with --teardown)
#   --teardown: only delete the test stacks and check (after a run that was killed hard)
# The private half of the throwaway site key stays in this shell; it is never printed or stored.
read -r SITE_PRIVATE_KEY SITE_PUBLIC_KEYS < <(node --input-type=module -e "
  import { resolve } from 'node:path'; import { pathToFileURL } from 'node:url';
  const { generateKeyBundle } = await import(pathToFileURL(resolve(process.argv[1])));
  const k = generateKeyBundle('smoke-site'); console.log(k.privateBundle, k.publicBundle);" \
  "$(dirname "$0")/../../backend/src/messaging/envelope.js")
USE_DOMAIN=false keep=false teardown_only=false
for arg in "$@"; do
  case $arg in
    --domain) USE_DOMAIN=true ;;
    --keep) keep=true ;;
    --teardown) teardown_only=true ;;
    *) echo "Usage: $0 [--domain] [--keep | --teardown]" >&2; exit 1 ;;
  esac
done
export ENTRY_MODE=direct USE_DOMAIN PROVISIONING=true SITE_PUBLIC_KEYS GPU_NODES=smoke-node \
  OVPN_PROFILE_URL=https://example.com/smoke-ovpn MANUAL_GPU_URL=https://example.com/smoke-manual MANUAL_BIGDATA_URL=https://example.com/smoke-bigdata SCHEDULER_INTERVAL_SEC=30
. "$(dirname "$0")/lib.sh"
SCRIPTS="$(dirname "$0")"
# What this run deletes at the end. Never the kept stacks.
TEST_STACKS=("$STACK_WEB" "$STACK_APP" "$STACK_DATA" "$STACK_SECRETS")
started=$(date +%s)
started_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
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
  leftovers "$STACK_DNS" "$STACK_CERT" "${KEPT_STACKS[@]}" || status=1
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
if [ "$teardown_only" = true ]; then echo "== teardown only"; exit 0; fi

echo "== deploy (ENTRY_MODE=$ENTRY_MODE, USE_DOMAIN=$USE_DOMAIN)"
for stack in "${KEPT_STACKS[@]}"; do
  state=$(awst cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].StackStatus' 2>/dev/null || echo missing)
  echo "   $stack: $state"
done
# Creates the kept stacks when they are missing; otherwise a quick no-op (or an update).
"$SCRIPTS/deploy.sh" network platform logs
"$SCRIPTS/push-images.sh"
"$SCRIPTS/deploy.sh" data secrets queues app web

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
if [[ $url == https://* ]]; then
  host=${url#https://}
  location=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "http://$host/history?tab=1")
  expect "HTTP redirects to HTTPS with the same host, path and query" "301 https://$host/history?tab=1" "${location/:443/}"
fi
# An unknown API path: a JSON 404 whose reference is the X-Request-Id; the path is a marker to find
# this request's access log line in S3 later.
marker="smoke-$(date +%s)-$RANDOM"
not_found=$(curl -s -D - "$url/api/$marker" | tr -d '\r')
ref=$(sed -n 's/^x-request-id: //Ip' <<<"$not_found")
expect "an unknown API path is a JSON 404 with its reference and no framework header" "404 1 0" \
  "$(head -1 <<<"$not_found" | cut -d' ' -f2) $(grep -c "\"reference\":\"$ref\"" <<<"$not_found") $(grep -ci '^x-powered-by' <<<"$not_found")"
expect "a state change from another origin gives 403" 403 "$(status -X POST -H 'Origin: https://evil.example' "$url/api/auth/logout")"
redirect=$(curl -s "$url/api/auth/google" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(new URL(JSON.parse(s).auth_url).searchParams.get("redirect_uri"))}catch{console.log("none")}})')
expect "Google sign-in starts with this deploy's callback URL" "$url/api/auth/google/callback" "$redirect"
# ECS injects every key of the mail secret (the placeholders: SMTP_HOST empty, emails off).
if "$SCRIPTS/run-task.sh" node -e "process.exit(['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_APP_PASSWORD','MAIL_FROM','MAIL_REPLY_TO'].every(k => k in process.env) ? 0 : 1)"; then
  pass "the SMTP settings reach the backend from Secrets Manager (secrets stack)"
else
  fail "SMTP settings from Secrets Manager"
fi
if "$SCRIPTS/run-task.sh" node scripts/check-db.js; then
  pass "database integration check in a one-off task (run-task.sh check-db)"
else
  fail "database integration check in a one-off task"
fi

# Provisioning through the real queues: a one-off task approves a GPU request, the backend service
# sends the CREATE job, fake-site.mjs answers it, the request becomes On Use; then the REVOKE.
# Then the scheduler: another GPU request that ended gets its REVOKE from the service (2 more jobs).
REQUEST_QUEUE_URL=$(stack_output "$STACK_QUEUES" RequestQueueUrl) RESULT_QUEUE_URL=$(stack_output "$STACK_QUEUES" ResultQueueUrl) \
  BACKEND_PUBLIC_KEY=$(stack_output "$STACK_QUEUES" BackendPublicKey) SITE_PRIVATE_KEY=$SITE_PRIVATE_KEY \
  node "$SCRIPTS/fake-site.mjs" 4 900 &
site_pid=$!
if "$SCRIPTS/run-task.sh" node scripts/check-provisioning.js; then
  pass "GPU request set up and revoked through SQS by the backend service (run-task.sh check-provisioning)"
else
  fail "provisioning through SQS"
fi
if "$SCRIPTS/run-task.sh" node scripts/check-scheduler.js; then
  pass "the service's scheduler: expiry REVOKE, reminder, notice by hand, dead letter (run-task.sh check-scheduler)"
else
  fail "scheduler"
fi
if wait "$site_pid"; then pass "the fake site opened all four signed and encrypted jobs and answered"; else fail "fake site"; fi
site_pid=

# The log archive: CloudWatch -> Firehose (about a minute) -> S3. The audit shipper copies events
# older than 2 minutes every 30 s, so give both up to 6 minutes.
in_s3() { # in_s3 <text> [--alb]: polls the archive for a line written during this run
  for _ in $(seq 1 24); do "$SCRIPTS/find-in-logs.sh" "$1" --since "$started_iso" "${@:2}" >/dev/null 2>&1 && return 0; sleep 15; done
  return 1
}
if in_s3 "$marker"; then pass "a request's access log line reached the S3 log archive (find-in-logs.sh)"; else fail "access log line in S3"; fi
if in_s3 '"action":"PROVISIONED"'; then pass "the audit trail reached S3 (audit.event lines from request_event)"; else fail "audit events in S3"; fi
# The ALB writes its access logs every 5 minutes.
if in_s3 "$marker" --alb; then pass "the ALB access logs reached S3"; else fail "ALB access logs in S3"; fi
