#!/usr/bin/env bash
# Read-only check of the live portal. It only reads (GET) and sends one logout that is refused.
# It creates, changes and deletes nothing. Run in Git Bash:  bash live-check.sh | tee live-check.log
URL=${URL:-https://app.siitrrapp.arbw.dev}
PROJECT=${PROJECT:-des424-126-g01}
PROFILE=${PROFILE:-des424}
fails=0
# Git Bash / MSYS2: keep arguments like /des424-126-g01 as they are (no Windows path conversion).
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL="*"
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }
expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$3', want '$2')"; fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
has_root() { curl -s "$1" | grep -c '<div id="root">'; }

echo "== Part A: the portal from outside ($URL)"
expect "1. frontend answers (/)" 1 "$(has_root "$URL/")"
expect "1. a client-side route gets the app (/requests)" 1 "$(has_root "$URL/requests")"
expect "2. backend answers (/health)" 200 "$(code "$URL/health")"
expect "3. backend reaches its database (/health/ready)" 200 "$(code "$URL/health/ready")"
expect "2. identity service answers /api/users/me (401, not 404)" 401 "$(code "$URL/api/users/me")"
expect "2. request service answers /api/requests/me (401, not 404)" 401 "$(code "$URL/api/requests/me")"
expect "4. no sign-in gives 401 (/api/auth/me)" 401 "$(code "$URL/api/auth/me")"
expect "4. a state change from another origin gives 403" 403 "$(code -X POST -H 'Origin: https://evil.example' "$URL/api/auth/logout")"
nf=$(curl -s -D - "$URL/api/live-check-$RANDOM" | tr -d '\r')
expect "4. unknown API path is 404" 404 "$(head -1 <<<"$nf" | cut -d' ' -f2)"
if grep -q '"reference"' <<<"$nf"; then pass "4. the 404 carries a reference"; else fail "4. the 404 carries a reference"; fi
if grep -qi '^x-powered-by' <<<"$nf"; then fail "4. no framework header"; else pass "4. no framework header"; fi
redirect=$(curl -s "$URL/api/auth/google" | grep -o 'redirect_uri=[^&"]*' | head -1 | sed 's/redirect_uri=//; s/%3A/:/gi; s/%2F/\//gi')
expect "5. Google sign-in uses this site's callback" "$URL/api/auth/google/callback" "$redirect"
host=${URL#https://}
loc=$(curl -s -o /dev/null -D - "http://$host/history" | tr -d '\r' | awk 'NR == 1 { c = $2 } tolower($1) == "location:" { l = $2 } END { print c, l }')
case $loc in 301*https://$host/history*|308*https://$host/history*) pass "HTTP redirects to HTTPS";; *) fail "HTTP redirects to HTTPS (got '$loc')";; esac
g=$(code "$URL/grafana/")
case $g in 200|302) pass "8. Grafana answers ($g)";; *) fail "8. Grafana answers (got $g)";; esac
expect "8. Grafana API refuses without sign-in" 401 "$(code "$URL/grafana/api/dashboards/home")"

if command -v aws >/dev/null && aws sts get-caller-identity --profile "$PROFILE" >/dev/null 2>&1; then
  echo "== Part B: AWS, read only (profile $PROFILE, prefix $PROJECT)"
  a() { aws --profile "$PROFILE" --region us-east-1 "$@"; }
  for s in identity backend provisioning grafana; do
    rc=$(a ecs describe-services --cluster "$PROJECT" --services "$s" --query 'services[0].[runningCount,desiredCount]' --output text 2>/dev/null)
    set -- $rc
    if [ -n "${1:-}" ] && [ "$1" != None ] && [ "$1" = "$2" ] && [ "$1" -gt 0 ]; then pass "ECS service $s runs $1/$2"; else fail "ECS service $s (running/desired: ${rc:-none})"; fi
  done
  n=$(a cloudwatch describe-alarms --alarm-name-prefix "$PROJECT" --query 'length(MetricAlarms)' --output text 2>/dev/null)
  if [ "${n:-0}" -gt 0 ]; then pass "9. $n alarms exist"; else fail "9. alarms exist (found ${n:-0})"; fi
  bad=$(a cloudwatch describe-alarms --alarm-name-prefix "$PROJECT" --state-value ALARM --query 'MetricAlarms[].AlarmName' --output text 2>/dev/null)
  if [ -z "$bad" ]; then pass "9. no alarm is firing"; else echo "NOTE  alarms firing now: $bad"; fi
  lg=$(a logs describe-log-groups --log-group-name-prefix "/$PROJECT" --query 'length(logGroups)' --output text 2>/dev/null)
  if [ "${lg:-0}" -gt 0 ]; then pass "8. $lg CloudWatch log groups"; else fail "8. CloudWatch log groups (found ${lg:-0})"; fi
  for q in requests results; do
    dlq=$(a sqs get-queue-url --queue-name "$PROJECT-provision-$q-dlq" --query QueueUrl --output text 2>/dev/null) || dlq=
    if [ -n "$dlq" ]; then
      m=$(a sqs get-queue-attributes --queue-url "$dlq" --attribute-names ApproximateNumberOfMessages --query 'Attributes.ApproximateNumberOfMessages' --output text)
      echo "INFO  $q dead-letter queue holds $m message(s)"
    fi
  done
else
  echo "== Part B skipped (no AWS credentials for profile $PROFILE)"
fi
echo "$fails check(s) failed."
