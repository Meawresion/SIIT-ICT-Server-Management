#!/usr/bin/env bash
# Finds a text in the logs, e.g. the reference from an error page.
# Usage: find-in-logs.sh <text> [--since <time>] [--until <time>] [--group <name>]... [--alb [--date YYYY-MM-DD]...]
#   Default: a CloudWatch Logs Insights query over the service and audit log groups (logs stack),
#   from --since (default: 2 days ago) to --until (default: now). Times are anything `date -d`
#   reads, e.g. 2026-11-03T10:00Z or "3 hours ago". --group backend|identity|provisioning|notification|frontend|mysql|audit limits
#   the search (repeatable). Prints "time  log group  log line" for every matching line, oldest first.
#   --alb: searches the ALB access log files in S3 instead (UTC days; default today and yesterday).
#   Exit code 1 when nothing matched.
. "$(dirname "$0")/lib.sh"
export MSYS_NO_PATHCONV=1

text= since= until= alb=false groups=() dates=()
while [ $# -gt 0 ]; do
  case $1 in
    --since) since=$2; shift 2 ;;
    --until) until=$2; shift 2 ;;
    --group) groups+=("/$PROJECT/$2"); shift 2 ;;
    --date) dates+=("$2"); shift 2 ;;
    --alb) alb=true; shift ;;
    -*) echo "Unknown option $1" >&2; exit 2 ;;
    *) text=$1; shift ;;
  esac
done
[ -n "$text" ] || { echo "Usage: $0 <text> [--since <time>] [--until <time>] [--group <name>]... [--alb [--date YYYY-MM-DD]...]" >&2; exit 2; }
aws cloudformation describe-stacks --stack-name "$STACK_LOGS" >/dev/null 2>&1 || { echo "No $STACK_LOGS stack: deploy.sh logs" >&2; exit 1; }

if [ "$alb" = true ]; then
  bucket=$(stack_output "$STACK_LOGS" BucketName)
  if [ ${#dates[@]} -eq 0 ]; then dates=("$(date -u +%F)" "$(date -u -d yesterday +%F)"); fi
  min=0
  [ -n "$since" ] && min=$(date -u -d "$since" +%s)000
  found=0
  for d in "${dates[@]}"; do
    prefix="alb/AWSLogs/$(account_id)/elasticloadbalancing/$AWS_REGION/${d//-//}/"
    keys=$(awst s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix" --query 'Contents[].Key')
    [ -n "$keys" ] && [ "$keys" != None ] || continue
    for key in $keys; do
      # Plain text lines; the second field is the request time.
      if out=$(aws s3 cp "s3://$bucket/$key" - --quiet | gunzip -c | node -e '
        const [text, min] = process.argv.slice(1);
        let data = "", hits = 0;
        process.stdin.on("data", (c) => { data += c; }).on("end", () => {
          for (const line of data.split("\n")) {
            if (line.includes(text) && Date.parse(line.split(" ")[1]) >= Number(min)) { console.log(line); hits++; }
          }
          process.exit(hits ? 0 : 1);
        });' "$text" "$min"); then
        echo "$out"
        found=1
      fi
    done
  done
  [ "$found" = 1 ] || { echo "Nothing found for \"$text\" in the ALB logs on ${dates[*]} (s3://$bucket)." >&2; exit 1; }
  exit 0
fi

if [ ${#groups[@]} -eq 0 ]; then
  for output in BackendLogGroup IdentityLogGroup ProvisioningLogGroup NotificationLogGroup FrontendLogGroup MysqlLogGroup AuditLogGroup; do groups+=("$(stack_output "$STACK_LOGS" "$output")"); done
fi
start=$(date -u -d "${since:-2 days ago}" +%s)
end=$(date -u -d "${until:-now}" +%s)
# The text as a Logs Insights regex with every special character escaped (a quoted string can't
# hold a double quote, and the text often has some, e.g. "action":"PROVISIONED").
pattern=$(printf '%s' "$text" | sed 's/[][\.*^$+?(){}|/]/\\&/g')
query_id=$(awst logs start-query --log-group-names "${groups[@]}" --start-time "$start" --end-time "$end" \
  --query-string "fields @timestamp, @log, @message | filter @message like /$pattern/ | sort @timestamp asc | limit 1000" \
  --query queryId)
for _ in $(seq 1 60); do
  status=$(awst logs get-query-results --query-id "$query_id" --query status)
  case $status in
    Complete) break ;;
    Failed|Cancelled|Timeout) echo "The Logs Insights query ended: $status" >&2; exit 1 ;;
  esac
  sleep 2
done
[ "$status" = Complete ] || { echo "The Logs Insights query did not finish in 2 minutes" >&2; exit 1; }
# One row per line: @timestamp, @log (account:group), @message.
out=$(aws logs get-query-results --query-id "$query_id" --output json | node -e '
  let data = "";
  process.stdin.on("data", (c) => { data += c; }).on("end", () => {
    const rows = JSON.parse(data).results ?? [];
    for (const row of rows) {
      const f = Object.fromEntries(row.map((c) => [c.field, c.value]));
      console.log(`${f["@timestamp"]}  ${(f["@log"] ?? "").replace(/^\d+:/, "")}  ${f["@message"]}`);
    }
  });')
[ -n "$out" ] || { echo "Nothing found for \"$text\" in ${groups[*]} from $(date -u -d "@$start" +%FT%TZ) to $(date -u -d "@$end" +%FT%TZ)." >&2; exit 1; }
echo "$out"
