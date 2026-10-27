#!/usr/bin/env bash
# Stores the Google OAuth client in Secrets Manager (GOOGLE_SECRET_NAME). Run it yourself: the
# client secret is read without echo and never appears on a command line or in the shell history.
. "$(dirname "$0")/lib.sh"

read -rp "Google OAuth client ID: " client_id
read -rsp "Google OAuth client secret: " client_secret
echo
[ -n "$client_id" ] && [ -n "$client_secret" ] || { echo "Both values are required." >&2; exit 1; }

umask 077
file=$(mktemp)
trap 'rm -f "$file"' EXIT
GOOGLE_CLIENT_ID="$client_id" GOOGLE_CLIENT_SECRET="$client_secret" node -e \
  'process.stdout.write(JSON.stringify({ GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET }))' > "$file"
unset client_secret
uri="file://$(command -v cygpath >/dev/null && cygpath -w "$file" || echo "$file")"

if aws secretsmanager describe-secret --secret-id "$GOOGLE_SECRET_NAME" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value --secret-id "$GOOGLE_SECRET_NAME" --secret-string "$uri" --query Name --output text
  echo "Updated. Run deploy.sh app (or force a new deployment) so the tasks read the new value."
else
  aws secretsmanager create-secret --name "$GOOGLE_SECRET_NAME" --description "$PROJECT Google OAuth client" \
    --secret-string "$uri" --query Name --output text
  echo "Created."
fi
