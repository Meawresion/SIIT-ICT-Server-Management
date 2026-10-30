#!/usr/bin/env bash
# Deletes every stack of the project, including the ones kept between test runs (network,
# platform with the ECR images), in the same fast order as the smoke test, then checks that nothing
# is left. The dns stack stays unless --dns is given (a new zone needs new NS records).
# Usage: teardown-all.sh [--dns] [--yes]
. "$(dirname "$0")/lib.sh"

with_dns=false
ask=true
for arg in "$@"; do
  case $arg in
    --dns) with_dns=true ;;
    --yes) ask=false ;;
    *) echo "Usage: $0 [--dns] [--yes]" >&2; exit 1 ;;
  esac
done

stacks=("$STACK_EDGE" "$STACK_WEB" "$STACK_APP" "$STACK_QUEUES" "$STACK_DATA" "$STACK_SECRETS" "$STACK_PLATFORM" "$STACK_CERT" "$STACK_NETWORK")
kept=("$STACK_DNS")
if [ "$with_dns" = true ]; then stacks+=("$STACK_DNS"); kept=(); fi

existing=()
for stack in "${stacks[@]}"; do
  aws cloudformation describe-stacks --stack-name "$stack" >/dev/null 2>&1 && existing+=("$stack")
done
if [ ${#existing[@]} -eq 0 ]; then
  echo "No stacks to delete."
else
  echo "Deletes: ${existing[*]}"
  echo "This includes the database and the ECR images (the next deploy uploads them again)."
  if [ "$ask" = true ]; then
    read -rp "Type 'delete all' to continue: " answer
    [ "$answer" = "delete all" ] || { echo "Stopped." >&2; exit 1; }
  fi
  delete_stacks "${existing[@]}" || echo "!! some stacks did not delete cleanly (above)" >&2
fi
sleep 60 # a late Lambda log line could recreate the queues stack's log group
leftovers "${kept[@]}"
