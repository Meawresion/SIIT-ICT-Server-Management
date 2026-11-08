#!/usr/bin/env bash
# Stores acc-prov-vm's public key bundle(s) (npm run keygen at the site: the public line) in the
# site stack's SSM parameter and restarts the provisioning service, which reads it at start.
# Usage: set-site-key.sh <bundle>[,<older bundle>...]   (current first; keep the old one while
# rotating, until the site uses the new key)
. "$(dirname "$0")/lib.sh"

keys=${1:-}
bundle='[a-z0-9][a-z0-9-]{0,39}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}'
if ! [[ $keys =~ ^$bundle(,$bundle)*$ ]]; then
  echo "Usage: $0 <kid>.<ed25519>.<x25519>[,...]  (the public line of acc-prov-vm's npm run keygen)" >&2
  exit 1
fi
name=$(stack_output "$STACK_SITE" SiteKeysParameter 2>/dev/null) || true
if [ -z "$name" ] || [ "$name" = None ]; then
  echo "The $STACK_SITE stack is missing: run deploy.sh site first." >&2
  exit 1
fi
MSYS_NO_PATHCONV=1 aws ssm put-parameter --name "$name" --type String --overwrite --value "$keys" \
  --query Version --output text | sed 's/^/parameter version /'
if service_exists provisioning; then
  aws ecs update-service --cluster "$PROJECT" --service provisioning --force-new-deployment \
    --query 'service.serviceName' --output text | sed 's/$/: restarting with the new key/'
fi
echo "Site key ids: $(tr ',' '\n' <<<"$keys" | cut -d. -f1 | paste -sd, -)"
