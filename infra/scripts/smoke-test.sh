#!/usr/bin/env bash
# Deploys a throwaway copy of the backend (network, platform, data, app in direct mode on the ALB's
# AWS name, with a placeholder Google client), checks it, then deletes every stack it created and
# checks that nothing is left behind. The stacks are deleted even when a step fails.
# Usage: smoke-test.sh [--keep]   (--keep: leave the stacks running; delete them with destroy.sh)
export ENTRY_MODE=direct USE_DOMAIN=false
. "$(dirname "$0")/lib.sh"
SCRIPTS="$(dirname "$0")"
STACK_TEST_GOOGLE="$PROJECT-test-google"
keep=false
[ "${1:-}" = --keep ] && keep=true

failures=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; failures=$((failures + 1)); }
expect() { # expect <label> <wanted> <got>
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$3', want '$2')"; fi
}

delete_stack() {
  if aws cloudformation describe-stacks --stack-name "$1" >/dev/null 2>&1; then
    echo "== deleting $1"
    aws cloudformation delete-stack --stack-name "$1"
    aws cloudformation wait stack-delete-complete --stack-name "$1" || echo "!! $1 did not delete cleanly; check the console"
  fi
}

leftovers() {
  local found=0
  # check <label> <aws args...>: anything listed, or a failed query, counts as left behind.
  check() {
    local label=$1 out
    shift
    if ! out=$(MSYS_NO_PATHCONV=1 aws --output text "$@" 2>&1 | tr -d '\r'); then
      echo "LEFT? $label: the check failed: $out"
      found=1
    elif [ -n "$out" ] && [ "$out" != None ]; then
      echo "LEFT  $label: $out"
      found=1
    fi
  }
  check "stacks" cloudformation list-stacks \
    --query "StackSummaries[?starts_with(StackName,'$PROJECT-') && StackStatus!='DELETE_COMPLETE'].[StackName,StackStatus]"
  check "ECR repositories" ecr describe-repositories --query "repositories[?starts_with(repositoryName,'$PROJECT-')].repositoryName"
  check "ECS clusters" ecs list-clusters --query "clusterArns[?ends_with(@,'/$PROJECT')]"
  check "VPCs" ec2 describe-vpcs --filters "Name=tag:Name,Values=$PROJECT-vpc" --query 'Vpcs[].VpcId'
  check "load balancers" elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerName'
  check "EFS file systems" efs describe-file-systems --query "FileSystems[?Name=='$PROJECT-mysql-data'].FileSystemId"
  check "log groups" logs describe-log-groups --log-group-name-prefix "/$PROJECT/" --query 'logGroups[].logGroupName'
  check "secrets (incl. pending deletion)" secretsmanager list-secrets --include-planned-deletion \
    --query "SecretList[?starts_with(Description,'$PROJECT ')].[Name,DeletedDate]"
  if [ "$found" = 0 ]; then echo "Nothing left behind."; else echo "Something is left behind (above)."; return 1; fi
}

teardown() {
  local status=$?
  if [ "$keep" = true ]; then
    echo "Kept the stacks (--keep). Delete them with: destroy.sh app data platform network; and the $STACK_TEST_GOOGLE stack"
    exit "$status"
  fi
  echo "== teardown"
  for stack in "$STACK_APP" "$STACK_DATA" "$STACK_TEST_GOOGLE" "$STACK_PLATFORM" "$STACK_NETWORK"; do
    delete_stack "$stack"
  done
  leftovers || status=1
  [ "$failures" = 0 ] || status=1
  if [ "$failures" = 0 ] && [ "$status" != 0 ]; then echo "A deploy step failed (see above)."; fi
  echo "$failures check(s) failed."
  exit "$status"
}
trap teardown EXIT

echo "== deploy (ENTRY_MODE=$ENTRY_MODE, USE_DOMAIN=$USE_DOMAIN)"
"$SCRIPTS/deploy.sh" network platform
"$SCRIPTS/push-images.sh"
deploy "$STACK_TEST_GOOGLE" test-google.yaml "Project=$PROJECT"
GOOGLE_SECRET_ARN=$(stack_output "$STACK_TEST_GOOGLE" SecretArn)
export GOOGLE_SECRET_ARN
"$SCRIPTS/deploy.sh" data app

url=$(stack_output "$STACK_APP" PublicUrl)
echo "== checks against $url"
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
wait_for_200() { # the ALB registers the task, and MySQL may still be running init.sql on EFS
  for _ in $(seq 1 40); do [ "$(status "$1")" = 200 ] && return; sleep 15; done
}
wait_for_200 "$url/health"
wait_for_200 "$url/health/ready"
expect "backend answers through the ALB (/health)" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$url/health")"
expect "backend reaches MySQL through the internal NLB as the app user (/health/ready)" \
  200 "$(curl -s -o /dev/null -w '%{http_code}' "$url/health/ready")"
expect "no sign-in token gives 401 (/api/auth/me)" 401 "$(curl -s -o /dev/null -w '%{http_code}' "$url/api/auth/me")"
expect "a state change from another origin gives 403" \
  403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Origin: https://evil.example' "$url/api/auth/logout")"
redirect=$(curl -s "$url/api/auth/google" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(new URL(JSON.parse(s).auth_url).searchParams.get("redirect_uri"))}catch{console.log("none")}})')
expect "Google sign-in starts with this deploy's callback URL" "$url/api/auth/google/callback" "$redirect"
if "$SCRIPTS/run-task.sh" node scripts/check-db.js; then
  pass "database integration check in a one-off task (run-task.sh check-db)"
else
  fail "database integration check in a one-off task"
fi
