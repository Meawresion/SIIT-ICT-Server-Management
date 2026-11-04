#!/usr/bin/env bash
# Learner Lab: puts the session's AWS keys into /etc/acc-prov-vm/aws.env and restarts the worker
# (the keys expire after a few hours; the worker reads them only when it starts).
# Usage: sudo bash set-aws-creds.sh, then paste the "AWS CLI" block from Learner Lab's
# "AWS Details" ([default] and the three aws_* lines) and press Ctrl+D.
# The keys are never printed or put on a command line.
set -euo pipefail
target=${AWS_ENV_FILE:-/etc/acc-prov-vm/aws.env}
service=${SERVICE:-acc-prov-vm}
[ "$(id -u)" = 0 ] || { echo "Run it with sudo (it writes $target and restarts $service)." >&2; exit 1; }

echo "Paste the AWS CLI block, then Ctrl+D:" >&2
id='' secret='' token=''
while IFS= read -r line; do
  line=${line//$'\r'/}
  value=${line#*=}
  value=${value#"${value%%[![:space:]]*}"}
  case ${line%%=*} in
    aws_access_key_id*) id=$value ;;
    aws_secret_access_key*) secret=$value ;;
    aws_session_token*) token=$value ;;
  esac
done
if [ -z "$id" ] || [ -z "$secret" ] || [ -z "$token" ]; then
  echo "The block needs aws_access_key_id, aws_secret_access_key and aws_session_token; nothing changed." >&2
  exit 1
fi

umask 077
tmp=$(mktemp "$target.XXXXXX")
printf 'AWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nAWS_SESSION_TOKEN=%s\n' "$id" "$secret" "$token" > "$tmp"
chown root:root "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$target"
echo "Wrote $target. Restarting $service." >&2
systemctl restart "$service"
sleep 5
systemctl --no-pager --lines=5 status "$service" || true
