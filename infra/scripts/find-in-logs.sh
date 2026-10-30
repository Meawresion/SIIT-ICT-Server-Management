#!/usr/bin/env bash
# Searches the S3 log archive (logs stack) for a text, e.g. the reference from an error page.
# Usage: find-in-logs.sh <text> [--date YYYY-MM-DD]... [--since <ISO time>] [--alb]
#   Days are UTC; without --date: today and yesterday. Prints "time  log group  log line" for every
#   container log line that contains the text (with --alb: matching ALB access log lines instead).
#   --since: only lines at or after that time. Exit code 1 when nothing matched.
. "$(dirname "$0")/lib.sh"

text= dates=() since= alb=false
while [ $# -gt 0 ]; do
  case $1 in
    --date) dates+=("$2"); shift 2 ;;
    --since) since=$2; shift 2 ;;
    --alb) alb=true; shift ;;
    -*) echo "Unknown option $1" >&2; exit 2 ;;
    *) text=$1; shift ;;
  esac
done
[ -n "$text" ] || { echo "Usage: $0 <text> [--date YYYY-MM-DD]... [--since <ISO time>] [--alb]" >&2; exit 2; }
if [ ${#dates[@]} -eq 0 ]; then dates=("$(date -u +%F)" "$(date -u -d yesterday +%F 2>/dev/null || date -u -v-1d +%F)"); fi

bucket=$(stack_output "$STACK_LOGS" BucketName 2>/dev/null) || true
[ -n "$bucket" ] && [ "$bucket" != None ] || { echo "No $STACK_LOGS stack: deploy.sh logs" >&2; exit 1; }

found=0
for d in "${dates[@]}"; do
  if [ "$alb" = true ]; then
    prefix="alb/AWSLogs/$(account_id)/elasticloadbalancing/$AWS_REGION/${d//-//}/"
  else
    prefix="app/${d//-//}/"
  fi
  keys=$(awst s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix" --query 'Contents[].Key')
  [ -n "$keys" ] && [ "$keys" != None ] || continue
  for key in $keys; do
    # Container logs: one JSON object per CloudWatch batch per line; ALB logs: plain text lines.
    if out=$(aws s3 cp "s3://$bucket/$key" - --quiet | gunzip -c | node -e '
      const [text, since, alb] = process.argv.slice(1);
      const min = since ? Date.parse(since) : 0;
      let data = "", hits = 0;
      process.stdin.on("data", (c) => { data += c; }).on("end", () => {
        for (const line of data.split("\n")) {
          if (alb === "true") {
            if (line.includes(text) && Date.parse(line.split(" ")[1]) >= min) { console.log(line); hits++; }
            continue;
          }
          // The message is JSON-encoded inside the batch line, so match it after parsing.
          let batch;
          try { batch = JSON.parse(line); } catch { continue; }
          for (const e of batch.logEvents ?? []) {
            if (e.message.includes(text) && e.timestamp >= min) {
              console.log(`${new Date(e.timestamp).toISOString()}  ${batch.logGroup}  ${e.message}`);
              hits++;
            }
          }
        }
        process.exit(hits ? 0 : 1);
      });' "$text" "$since" "$alb"); then
      echo "$out"
      found=1
    fi
  done
done
[ "$found" = 1 ] || { echo "Nothing found for \"$text\" on ${dates[*]} (s3://$bucket)." >&2; exit 1; }
