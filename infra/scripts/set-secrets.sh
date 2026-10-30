#!/usr/bin/env bash
# Copies the secrets in your config.env (Google OAuth client, SMTP settings) into the secrets
# stack's Secrets Manager secrets, then restarts the backend so it reads them. The values go from
# this shell to one node process and a private temporary file (deleted at the end), never onto a
# command line, into a log or a stack parameter, and are never printed.
# Usage: set-secrets.sh [google] [mail]      (both by default; deploy.sh secrets first)
. "$(dirname "$0")/lib.sh"

GOOGLE_KEYS=(GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET)
MAIL_KEYS=(SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_APP_PASSWORD MAIL_FROM MAIL_REPLY_TO)
[ $# -gt 0 ] || set -- google mail
for what in "$@"; do
  case $what in google|mail) ;; *) echo "Usage: $0 [google] [mail]" >&2; exit 1 ;; esac
done

# Git Bash paths (/e/...) as Windows programs (node, aws) read them.
native_path() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

umask 077
file=$(mktemp)
trap 'rm -f "$file"' EXIT
uri="file://$(native_path "$file")"

# to_json <check> <key>...: the keys as one JSON object in $file. The values reach node through
# its environment only; check is google or mail (the backend's own mail settings check).
to_json() {
  local check=$1
  shift
  (
    export "$@" STUDENT_EMAIL_DOMAIN STUDENT_ID_DIGITS DEGREE_EMAIL_PREFIXES STAFF_EMAIL_DOMAINS
    node --input-type=module -e '
      import { pathToFileURL } from "node:url";
      const [check, mailModule, ...keys] = process.argv.slice(1);
      const value = Object.fromEntries(keys.map((k) => [k, process.env[k] ?? ""]));
      try {
        if (check === "google") {
          if (!value.GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com") || !value.GOOGLE_CLIENT_SECRET) {
            throw new Error("GOOGLE_CLIENT_ID (…apps.googleusercontent.com) and GOOGLE_CLIENT_SECRET are required in config.env");
          }
        } else {
          const { loadMailConfig } = await import(pathToFileURL(mailModule));
          if (!loadMailConfig(process.env)) console.error("SMTP_HOST is empty: status emails stay off (only logged).");
        }
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(value));
    ' "$check" "$(native_path "$REPO_DIR/backend/src/config/mail.js")" "$@"
  ) > "$file"
}

changed=false
for what in "$@"; do
  arn=$(stack_output "$STACK_SECRETS" "$([ "$what" = google ] && echo GoogleSecretArn || echo MailSecretArn)" 2>/dev/null || true)
  if [ -z "$arn" ] || [ "$arn" = None ]; then
    echo "The $STACK_SECRETS stack is missing: run deploy.sh secrets first." >&2
    exit 1
  fi
  if [ "$what" = google ]; then to_json google "${GOOGLE_KEYS[@]}"; else to_json mail "${MAIL_KEYS[@]}"; fi
  aws secretsmanager put-secret-value --secret-id "$arn" --secret-string "$uri" --query Name --output text
  : > "$file"
  changed=true
done

# A task reads its secrets when it starts.
if [ "$changed" = true ] && service_exists backend; then
  aws ecs update-service --cluster "$PROJECT" --service backend --force-new-deployment --query 'service.serviceName' --output text >/dev/null
  echo "The backend restarts with the new values (a minute or two)."
fi
