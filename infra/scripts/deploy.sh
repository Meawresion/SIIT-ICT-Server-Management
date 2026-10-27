#!/usr/bin/env bash
# Deploys stacks in order. Usage: deploy.sh all | <stack>...   (dns cert network platform data app edge)
# First time: dns, then the NS records at the parent domain, then the rest (see infra/README.md).
. "$(dirname "$0")/lib.sh"

deploy_dns() {
  deploy "$STACK_DNS" dns.yaml "ZoneName=$ZONE_NAME"
  echo "Name servers for $ZONE_NAME (NS records at the parent domain):"
  stack_output "$STACK_DNS" NameServers | tr ',' '\n'
}

deploy_cert() {
  echo "(waits until the certificate is validated through DNS: the NS delegation must be live)"
  deploy "$STACK_CERT" cert.yaml "DnsStack=$STACK_DNS"
}

deploy_network() { deploy "$STACK_NETWORK" network.yaml "Project=$PROJECT"; }

deploy_platform() { deploy "$STACK_PLATFORM" platform.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK"; }

deploy_data() {
  local tag role
  tag=$(mysql_tag)
  role=$(role_arn)
  require_image "$PROJECT-mysql" "$tag"
  deploy "$STACK_DATA" data-ecs.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "ImageTag=$tag" "ExecutionRoleArn=$role" "TaskRoleArn=$role" \
    "DesiredCount=${DB_DESIRED_COUNT:-1}"
}

deploy_app() {
  local tag role google prefix_list='' dns_stack='' cert_stack=''
  tag=$(backend_tag)
  role=$(role_arn)
  require_image "$PROJECT-backend" "$tag"
  # GOOGLE_SECRET_ARN (e.g. smoke-test.sh's placeholder) wins over the named secret.
  google=${GOOGLE_SECRET_ARN:-$(awst secretsmanager describe-secret --secret-id "$GOOGLE_SECRET_NAME" --query ARN 2>/dev/null)} || true
  if [ -z "$google" ]; then
    echo "Secret $GOOGLE_SECRET_NAME is missing: run infra/scripts/set-google-secret.sh first." >&2
    exit 1
  fi
  if [ "$USE_DOMAIN" = true ]; then
    dns_stack=$STACK_DNS
    cert_stack=$STACK_CERT
  fi
  if [ "$ENTRY_MODE" = cloudfront ]; then
    prefix_list=$(awst ec2 describe-managed-prefix-lists \
      --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing \
      --query 'PrefixLists[0].PrefixListId')
  fi
  deploy "$STACK_APP" app.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "DataStack=$STACK_DATA" "EntryMode=$ENTRY_MODE" \
    "DnsStack=$dns_stack" "CertStack=$cert_stack" \
    "ImageTag=$tag" "ExecutionRoleArn=$role" "TaskRoleArn=$role" "GoogleSecretArn=$google" \
    "CloudFrontPrefixListId=$prefix_list" "AppHost=$APP_HOST" "OriginHost=$ORIGIN_HOST" \
    "DesiredCount=${BACKEND_DESIRED_COUNT:-1}" \
    "StudentEmailDomain=$STUDENT_EMAIL_DOMAIN" "StudentIdDigits=$STUDENT_ID_DIGITS" \
    "DegreeEmailPrefixes=$DEGREE_EMAIL_PREFIXES" "StaffEmailDomains=$STAFF_EMAIL_DOMAINS" \
    "SessionIdleMinutes=${SESSION_IDLE_MINUTES:-30}" "SessionMaxHours=${SESSION_MAX_HOURS:-12}"
  echo "Backend: $(stack_output "$STACK_APP" PublicUrl)"
}

deploy_edge() {
  if [ "$ENTRY_MODE" != cloudfront ]; then
    echo "edge needs ENTRY_MODE=cloudfront (this account may not allow CloudFront)." >&2
    exit 1
  fi
  deploy "$STACK_EDGE" edge.yaml "Project=$PROJECT" "DnsStack=$STACK_DNS" "CertStack=$STACK_CERT" \
    "AppStack=$STACK_APP" "AppHost=$APP_HOST"
  echo "Portal: $(stack_output "$STACK_EDGE" AppUrl) (publish the frontend with publish-frontend.sh)"
}

[ $# -gt 0 ] || { echo "Usage: $0 all | dns cert network platform data app edge" >&2; exit 1; }
[ "$1" = all ] && set -- dns cert network platform data app edge
for stack in "$@"; do
  case $stack in
    dns|cert|network|platform|data|app|edge) "deploy_$stack" ;;
    *) echo "Unknown stack: $stack" >&2; exit 1 ;;
  esac
done
