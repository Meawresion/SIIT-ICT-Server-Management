#!/usr/bin/env bash
# Deletes stacks, newest first. Usage: destroy.sh <stack>...   e.g. destroy.sh edge app
# For a long break, delete edge and app; keep dns and cert (name servers, certificate), network,
# platform (images) and data (the database). Deleting data deletes the database for good.
. "$(dirname "$0")/lib.sh"

order=(edge app data platform network cert dns)
[ $# -gt 0 ] || { echo "Usage: $0 <stack>...   (${order[*]})" >&2; exit 1; }
for stack in "$@"; do
  [[ " ${order[*]} " == *" $stack "* ]] || { echo "Unknown stack: $stack" >&2; exit 1; }
done

confirm() {
  read -rp "$1 Type '$2' to continue: " answer
  [ "$answer" = "$2" ] || { echo "Stopped." >&2; exit 1; }
}

for stack in "${order[@]}"; do
  [[ " $* " == *" $stack "* ]] || continue
  name="$PROJECT-$stack"
  case $stack in
    data) confirm "This deletes the database and its passwords." "delete data" ;;
    dns) confirm "New name servers will need new NS records at the parent domain." "delete dns" ;;
    edge)
      bucket=$(stack_output "$name" BucketName 2>/dev/null || true)
      [ -n "$bucket" ] && aws s3 rm "s3://$bucket" --recursive --quiet
      ;;
  esac
  echo "== deleting $name"
  aws cloudformation delete-stack --stack-name "$name"
  aws cloudformation wait stack-delete-complete --stack-name "$name"
done
