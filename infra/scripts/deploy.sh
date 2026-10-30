#!/usr/bin/env bash
# Deploys stacks in order. Usage: deploy.sh all | <stack>...   (dns cert network platform data secrets queues app edge web)
# First time: dns, then the NS records at the parent domain, then the rest (see infra/README.md).
# The frontend comes from edge (CloudFront + S3) or web (ECS behind the ALB, direct mode).
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

deploy_queues() {
  deploy "$STACK_QUEUES" queues.yaml "Project=$PROJECT" "LambdaRoleArn=$(role_arn)" "KeyGeneration=${MESSAGE_KEY_GENERATION:-1}"
  echo "Backend public key (acc-prov-vm's MSG_PEER_PUBLIC_KEYS): $(stack_output "$STACK_QUEUES" BackendPublicKey)"
}

deploy_secrets() {
  deploy "$STACK_SECRETS" secrets.yaml "Project=$PROJECT"
  echo "Put your values into it with set-secrets.sh (until then: placeholders, no sign-in, no emails)."
}

deploy_app() {
  local tag role google mail prefix_list='' dns_stack='' cert_stack='' provisioning=()
  tag=$(backend_tag)
  role=$(role_arn)
  require_image "$PROJECT-backend" "$tag"
  google=$(stack_output "$STACK_SECRETS" GoogleSecretArn 2>/dev/null) || true
  mail=$(stack_output "$STACK_SECRETS" MailSecretArn 2>/dev/null) || true
  if [ -z "$google" ] || [ "$google" = None ]; then
    echo "The $STACK_SECRETS stack is missing: run deploy.sh secrets, then set-secrets.sh." >&2
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
  if [ "$PROVISIONING" = true ]; then
    for key in SITE_PUBLIC_KEYS GPU_NODES OVPN_PROFILE_URL MANUAL_GPU_URL; do
      if [ -z "${!key:-}" ]; then echo "PROVISIONING=true needs $key in $CONFIG" >&2; exit 1; fi
    done
    provisioning=("QueuesStack=$STACK_QUEUES" "SitePublicKeys=$SITE_PUBLIC_KEYS" "GpuNodes=$GPU_NODES"
      "OvpnProfileUrl=$OVPN_PROFILE_URL" "ManualGpuUrl=$MANUAL_GPU_URL" "MessageJobTtlSeconds=${MSG_JOB_TTL_SEC:-259200}")
  else
    provisioning=("QueuesStack=")
  fi
  deploy "$STACK_APP" app.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "DataStack=$STACK_DATA" "EntryMode=$ENTRY_MODE" \
    "DnsStack=$dns_stack" "CertStack=$cert_stack" \
    "ImageTag=$tag" "ExecutionRoleArn=$role" "TaskRoleArn=$role" "GoogleSecretArn=$google" "MailSecretArn=$mail" \
    "CloudFrontPrefixListId=$prefix_list" "AppHost=$APP_HOST" "OriginHost=$ORIGIN_HOST" \
    "DesiredCount=${BACKEND_DESIRED_COUNT:-1}" \
    "StudentEmailDomain=$STUDENT_EMAIL_DOMAIN" "StudentIdDigits=$STUDENT_ID_DIGITS" \
    "DegreeEmailPrefixes=$DEGREE_EMAIL_PREFIXES" "StaffEmailDomains=$STAFF_EMAIL_DOMAINS" \
    "SessionIdleMinutes=${SESSION_IDLE_MINUTES:-30}" "SessionMaxHours=${SESSION_MAX_HOURS:-12}" \
    "SchedulerIntervalSeconds=${SCHEDULER_INTERVAL_SEC:-300}" "ExpiryReminderDays=${EXPIRY_REMINDER_DAYS:-3}" \
    "SiteTimeZone=${SITE_TIME_ZONE:-Asia/Bangkok}" "${provisioning[@]}"
  echo "Backend: $(stack_output "$STACK_APP" PublicUrl)"
}

deploy_web() {
  local tag
  if [ "$ENTRY_MODE" != direct ]; then
    echo "web needs ENTRY_MODE=direct (with CloudFront, edge serves the frontend from S3)." >&2
    exit 1
  fi
  tag=$(frontend_tag)
  require_image "$PROJECT-frontend" "$tag"
  deploy "$STACK_WEB" web.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "AppStack=$STACK_APP" "ImageTag=$tag" \
    "ExecutionRoleArn=$(role_arn)" "DesiredCount=${FRONTEND_DESIRED_COUNT:-1}"
  echo "Portal: $(stack_output "$STACK_APP" PublicUrl)"
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

[ $# -gt 0 ] || { echo "Usage: $0 all | dns cert network platform data secrets queues app edge web" >&2; exit 1; }
if [ "$1" = all ]; then
  set -- network platform data secrets
  if [ "$PROVISIONING" = true ]; then set -- "$@" queues; fi
  set -- "$@" app
  if [ "$USE_DOMAIN" = true ]; then set -- dns cert "$@"; fi
  if [ "$ENTRY_MODE" = cloudfront ]; then set -- "$@" edge; else set -- "$@" web; fi
fi
for stack in "$@"; do
  case $stack in
    dns|cert|network|platform|data|secrets|queues|app|edge|web) "deploy_$stack" ;;
    *) echo "Unknown stack: $stack" >&2; exit 1 ;;
  esac
done
