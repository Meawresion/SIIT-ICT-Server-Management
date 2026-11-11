#!/usr/bin/env bash
# Deploys stacks in order. Usage: deploy.sh all | <stack>...   (dns cert network platform logs data secrets queues site events app identity provisioning grafana edge web)
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

# CONTAINER_INSIGHTS=enabled turns on per-task metrics (billed; demo days only, D34).
deploy_platform() {
  deploy "$STACK_PLATFORM" platform.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "ContainerInsights=${CONTAINER_INSIGHTS:-disabled}"
}

deploy_logs() {
  deploy "$STACK_LOGS" logs.yaml "Project=$PROJECT" "AppLogDays=${APP_LOG_DAYS:-90}" \
    "AuditLogDays=${AUDIT_LOG_DAYS:-400}" "AlbLogDays=${ALB_LOG_DAYS:-400}" "AlertEmail=${ALERT_EMAIL:-}"
  echo "Logs: CloudWatch Logs /$PROJECT/* (search them with find-in-logs.sh); ALB access logs: s3://$(stack_output "$STACK_LOGS" BucketName)"
  if [ -n "${ALERT_EMAIL:-}" ]; then echo "Alerts go to $ALERT_EMAIL once its confirmation link (from AWS Notifications) is clicked."; fi
}

deploy_data() {
  local tag
  require_logs_stack
  tag=$(mysql_tag)
  require_image "$PROJECT-mysql" "$tag"
  if [ "$DATA_MODE" = rds ]; then deploy_rds "$tag"; return; fi
  deploy "$STACK_DATA" data-ecs.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "ImageTag=$tag" \
    "DesiredCount=${DB_DESIRED_COUNT:-1}" "LogsStack=$STACK_LOGS"
}

# DATA_MODE=rds (D31): RDS Multi-AZ, then rds-init.sh as a one-off task (schema when empty, service
# users; with COPY_FROM_STACK, set by switch-to-rds.sh, the data of that data-ecs stack too).
# On create, DB_RESTORE picks the starting data: latest (default) = the newest final snapshot of a
# deleted rds stack, none = an empty database, or a snapshot name. Updates keep the stack's value
# (not passed), because a changed RestoreSnapshot would replace the instance.
deploy_rds() {
  local copy_from=${COPY_FROM_STACK:-} restore=() snapshot=''
  if ! aws cloudformation describe-stacks --stack-name "$STACK_DATA_RDS" >/dev/null 2>&1; then
    case ${DB_RESTORE:-latest} in
      none) ;;
      latest) snapshot=$(latest_rds_snapshot); [ "$snapshot" != None ] || snapshot='' ;;
      *) snapshot=$DB_RESTORE ;;
    esac
    restore=("RestoreSnapshot=$snapshot")
    if [ -n "$snapshot" ]; then
      echo "(restoring the database from the snapshot $snapshot; DB_RESTORE=none for an empty one)"
    else
      echo "(a new, empty database)"
    fi
    echo "(creating RDS takes 15-25 minutes, longer with Multi-AZ: the standby is built in the second AZ)"
  fi
  deploy "$STACK_DATA_RDS" data-rds.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "LogsStack=$STACK_LOGS" "ImageTag=$1" \
    "InstanceClass=${DB_INSTANCE_CLASS:-db.t3.micro}" "MultiAz=${DB_MULTI_AZ:-true}" \
    "BackupRetentionDays=${DB_BACKUP_DAYS:-7}" "CopyFromStack=$copy_from" "${restore[@]}"
  echo "== preparing the database (rds-init.sh${copy_from:+, copy from $copy_from})"
  "$(dirname "$0")/run-task.sh" --db-init
}

deploy_queues() {
  deploy "$STACK_QUEUES" queues.yaml "Project=$PROJECT" "KeyGeneration=${MESSAGE_KEY_GENERATION:-1}"
  echo "Backend public key: SSM $(stack_output "$STACK_QUEUES" BackendPublicKeyParameter) (acc-prov-vm's MSG_PEER_PUBLIC_KEYS_PARAM)"
}

# acc-prov-vm's access (IAM Roles Anywhere with the project's own CA, site-ca.sh) and its public key
# (SSM, set-site-key.sh). Kept between test runs.
deploy_site() {
  local dir=${SITE_CA_DIR:-$HOME/.siit-site-ca/$PROJECT}
  if [ ! -f "$dir/ca.pem" ]; then echo "No site CA in $dir: run site-ca.sh init first." >&2; exit 1; fi
  if ! aws cloudformation describe-stacks --stack-name "$STACK_QUEUES" >/dev/null 2>&1; then
    echo "The $STACK_QUEUES stack is missing: run deploy.sh queues first." >&2
    exit 1
  fi
  deploy "$STACK_SITE" site.yaml "Project=$PROJECT" "QueuesStack=$STACK_QUEUES" "CaCertificate=$(cat "$dir/ca.pem")"
  echo "For acc-prov-vm (its README, Roles Anywhere):"
  for key in TrustAnchorArn ProfileArn RoleArn; do echo "  $key=$(stack_output "$STACK_SITE" "$key")"; done
  echo "  MSG_PEER_PUBLIC_KEYS_PARAM=$(stack_output "$STACK_QUEUES" BackendPublicKeyParameter)"
  echo "  SQS_REQUEST_QUEUE_URL=$(stack_output "$STACK_QUEUES" RequestQueueUrl)"
  echo "  SQS_RESULT_QUEUE_URL=$(stack_output "$STACK_QUEUES" ResultQueueUrl)"
}

# The provisioning service reads acc-prov-vm's public keys from SITE_PUBLIC_KEYS (text: smoke tests)
# or else from the site stack's SSM parameter (set-site-key.sh). Prints the parameter's name.
site_keys_parameter() {
  local name value
  name=$(stack_output "$STACK_SITE" SiteKeysParameter 2>/dev/null) || true
  if [ -z "$name" ] || [ "$name" = None ]; then
    echo "PROVISIONING=true needs SITE_PUBLIC_KEYS or the $STACK_SITE stack (deploy.sh site, set-site-key.sh)." >&2
    return 1
  fi
  value=$(MSYS_NO_PATHCONV=1 awst ssm get-parameter --name "$name" --query Parameter.Value)
  if [ "$value" = not-set ]; then
    echo "The site's public key isn't set yet: set-site-key.sh <the public line of acc-prov-vm's npm run keygen>." >&2
    return 1
  fi
  echo "$name"
}

deploy_secrets() {
  deploy "$STACK_SECRETS" secrets.yaml "Project=$PROJECT"
  echo "Put your values into it with set-secrets.sh (until then: placeholders, no sign-in, no emails)."
}

# The notification service (D34): the event bus, its queue and the Lambda with the mail secret.
deploy_events() {
  local tag mail
  require_logs_stack
  tag=$(notification_tag)
  require_image "$PROJECT-notification" "$tag"
  mail=$(stack_output "$STACK_SECRETS" MailSecretArn 2>/dev/null) || true
  if [ -z "$mail" ] || [ "$mail" = None ]; then
    echo "The $STACK_SECRETS stack is missing: run deploy.sh secrets, then set-secrets.sh." >&2
    exit 1
  fi
  deploy "$STACK_EVENTS" events.yaml "Project=$PROJECT" "PlatformStack=$STACK_PLATFORM" "LogsStack=$STACK_LOGS" \
    "NotificationImageTag=$tag" "MailSecretArn=$mail" \
    "AllowedRecipientDomains=$STUDENT_EMAIL_DOMAIN,$STAFF_EMAIL_DOMAINS"
}

# The provisioning service (D34): site jobs and results, scheduler, audit shipping.
deploy_provisioning() {
  local tag provisioning=()
  require_logs_stack
  tag=$(backend_tag)
  require_image "$PROJECT-backend" "$tag"
  if [ "$PROVISIONING" = true ]; then
    local keys_parameter=''
    if [ -z "${SITE_PUBLIC_KEYS:-}" ]; then keys_parameter=$(site_keys_parameter) || exit 1; fi
    provisioning=("QueuesStack=$STACK_QUEUES" "SitePublicKeys=${SITE_PUBLIC_KEYS:-}" "SiteKeysParameter=$keys_parameter" "GpuNodes=$GPU_NODES"
      "OvpnProfileUrl=$OVPN_PROFILE_URL" "ManualGpuUrl=$MANUAL_GPU_URL"
      "ManualBigDataUrl=$MANUAL_BIGDATA_URL" "MessageJobTtlSeconds=${MSG_JOB_TTL_SEC:-259200}"
      "SiteHeartbeatMinutes=${SITE_HEARTBEAT_MINUTES:-15}" "QueueWaitMinutes=${SITE_QUEUE_WAIT_MINUTES:-5}")
  else
    provisioning=("QueuesStack=")
  fi
  deploy "$STACK_PROVISIONING" provisioning.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "DataStack=$STACK_DATA" "AppStack=$STACK_APP" "LogsStack=$STACK_LOGS" \
    "EventsStack=$STACK_EVENTS" "ImageTag=$tag" \
    "DesiredCount=${PROVISIONING_DESIRED_COUNT:-1}" \
    "StudentEmailDomain=$STUDENT_EMAIL_DOMAIN" "StudentIdDigits=$STUDENT_ID_DIGITS" \
    "DegreeEmailPrefixes=$DEGREE_EMAIL_PREFIXES" "StaffEmailDomains=$STAFF_EMAIL_DOMAINS" \
    "ApproverEmails=${APPROVER_EMAILS:-}" \
    "SchedulerIntervalSeconds=${SCHEDULER_INTERVAL_SEC:-300}" "ExpiryReminderDays=${EXPIRY_REMINDER_DAYS:-3}" \
    "SiteTimeZone=${SITE_TIME_ZONE:-Asia/Bangkok}" "${provisioning[@]}"
}

# The identity service (D34): sign-in and profiles, behind the app stack's ALB.
deploy_identity() {
  local tag google origin=''
  require_logs_stack
  tag=$(backend_tag)
  require_image "$PROJECT-backend" "$tag"
  google=$(stack_output "$STACK_SECRETS" GoogleSecretArn 2>/dev/null) || true
  if [ -z "$google" ] || [ "$google" = None ]; then
    echo "The $STACK_SECRETS stack is missing: run deploy.sh secrets, then set-secrets.sh." >&2
    exit 1
  fi
  if [ "$ENTRY_MODE" = cloudfront ]; then origin=$(stack_output "$STACK_APP" OriginVerifySecretArn); fi
  deploy "$STACK_IDENTITY" identity.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "DataStack=$STACK_DATA" "AppStack=$STACK_APP" "LogsStack=$STACK_LOGS" \
    "ImageTag=$tag" "GoogleSecretArn=$google" \
    "OriginVerifySecretArn=$origin" "DesiredCount=${IDENTITY_DESIRED_COUNT:-1}" \
    "StudentEmailDomain=$STUDENT_EMAIL_DOMAIN" "StudentIdDigits=$STUDENT_ID_DIGITS" \
    "DegreeEmailPrefixes=$DEGREE_EMAIL_PREFIXES" "StaffEmailDomains=$STAFF_EMAIL_DOMAINS" \
    "ApproverEmails=${APPROVER_EMAILS:-}" \
    "SessionIdleMinutes=${SESSION_IDLE_MINUTES:-30}" "SessionMaxHours=${SESSION_MAX_HOURS:-12}"
  [ -n "${APPROVER_EMAILS:-}" ] || echo "Note: APPROVER_EMAILS is empty, so the approvers are whoever set-user-role.js made one."
}

deploy_app() {
  local tag prefix_list='' dns_stack='' cert_stack='' provisioning=()
  require_logs_stack
  tag=$(backend_tag)
  require_image "$PROJECT-backend" "$tag"
  if ! aws cloudformation describe-stacks --stack-name "$STACK_EVENTS" >/dev/null 2>&1; then
    echo "The $STACK_EVENTS stack is missing: run deploy.sh events first." >&2
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
    for key in GPU_NODES OVPN_PROFILE_URL MANUAL_GPU_URL MANUAL_BIGDATA_URL; do
      if [ -z "${!key:-}" ]; then echo "PROVISIONING=true needs $key in $CONFIG" >&2; exit 1; fi
    done
    provisioning=("QueuesStack=$STACK_QUEUES" "GpuNodes=$GPU_NODES" "OvpnProfileUrl=$OVPN_PROFILE_URL"
      "ManualGpuUrl=$MANUAL_GPU_URL" "ManualBigDataUrl=$MANUAL_BIGDATA_URL")
  else
    provisioning=("QueuesStack=")
  fi
  deploy "$STACK_APP" app.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "DataStack=$STACK_DATA" "EntryMode=$ENTRY_MODE" \
    "DnsStack=$dns_stack" "CertStack=$cert_stack" \
    "ImageTag=$tag" "EventsStack=$STACK_EVENTS" \
    "CloudFrontPrefixListId=$prefix_list" "AppHost=$APP_HOST" "OriginHost=$ORIGIN_HOST" \
    "DesiredCount=${BACKEND_DESIRED_COUNT:-1}" \
    "StudentEmailDomain=$STUDENT_EMAIL_DOMAIN" "StudentIdDigits=$STUDENT_ID_DIGITS" \
    "DegreeEmailPrefixes=$DEGREE_EMAIL_PREFIXES" "StaffEmailDomains=$STAFF_EMAIL_DOMAINS" \
    "ApproverEmails=${APPROVER_EMAILS:-}" \
    "SessionIdleMinutes=${SESSION_IDLE_MINUTES:-30}" "SessionMaxHours=${SESSION_MAX_HOURS:-12}" \
    "SchedulerIntervalSeconds=${SCHEDULER_INTERVAL_SEC:-300}" "ExpiryReminderDays=${EXPIRY_REMINDER_DAYS:-3}" \
    "SiteTimeZone=${SITE_TIME_ZONE:-Asia/Bangkok}" "LogsStack=$STACK_LOGS" "${provisioning[@]}"
  echo "Backend: $(stack_output "$STACK_APP" PublicUrl)"
}

# Grafana's sign-in rule (JMESPath, role_attribute_path) from GRAFANA_ALLOWED_EMAILS: only these
# exact addresses get Viewer, anyone else gets no role and is refused (no whole domains). Empty
# list = empty rule = Google sign-in off (admin only).
grafana_sign_in_rule() {
  local entry rule='' entries address='^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]+$'
  IFS=',' read -ra entries <<< "${GRAFANA_ALLOWED_EMAILS:-}"
  for entry in "${entries[@]}"; do
    entry=$(printf '%s' "$entry" | tr -d ' \r' | tr 'A-Z' 'a-z')
    [ -n "$entry" ] || continue
    if ! [[ $entry =~ $address ]]; then
      echo "GRAFANA_ALLOWED_EMAILS: '$entry' is not a full email address (whole domains aren't allowed)." >&2
      return 1
    fi
    rule="${rule:+$rule || }email == '$entry'"
  done
  [ -z "$rule" ] || echo "($rule) && 'Viewer'"
}

# Grafana (D34, NFR-8.3): dashboards at /grafana/ on the app stack's ALB.
deploy_grafana() {
  local tag google origin='' rule
  rule=$(grafana_sign_in_rule) || exit 1
  require_logs_stack
  tag=$(grafana_tag)
  require_image "$PROJECT-grafana" "$tag"
  google=$(stack_output "$STACK_SECRETS" GoogleSecretArn 2>/dev/null) || true
  if [ -z "$google" ] || [ "$google" = None ]; then
    echo "The $STACK_SECRETS stack is missing: run deploy.sh secrets, then set-secrets.sh." >&2
    exit 1
  fi
  if [ "$ENTRY_MODE" = cloudfront ]; then origin=$(stack_output "$STACK_APP" OriginVerifySecretArn); fi
  deploy "$STACK_GRAFANA" grafana.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "AppStack=$STACK_APP" "LogsStack=$STACK_LOGS" "ImageTag=$tag" \
    "GoogleSecretArn=$google" \
    "OriginVerifySecretArn=$origin" "SignInRule=$rule" \
    "DesiredCount=${GRAFANA_DESIRED_COUNT:-1}" "Memory=${GRAFANA_MEMORY:-1024}"
  echo "Grafana: $(stack_output "$STACK_APP" PublicUrl)/grafana/ (Google sign-in: ${GRAFANA_ALLOWED_EMAILS:-off, admin only})"
}

deploy_web() {
  local tag
  if [ "$ENTRY_MODE" != direct ]; then
    echo "web needs ENTRY_MODE=direct (with CloudFront, edge serves the frontend from S3)." >&2
    exit 1
  fi
  require_logs_stack
  tag=$(frontend_tag)
  require_image "$PROJECT-frontend" "$tag"
  deploy "$STACK_WEB" web.yaml "Project=$PROJECT" "NetworkStack=$STACK_NETWORK" \
    "PlatformStack=$STACK_PLATFORM" "AppStack=$STACK_APP" "ImageTag=$tag" \
    "DesiredCount=${FRONTEND_DESIRED_COUNT:-1}" "LogsStack=$STACK_LOGS"
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

[ $# -gt 0 ] || { echo "Usage: $0 all | dns cert network platform logs data secrets queues site events app identity provisioning grafana edge web" >&2; exit 1; }
if [ "$1" = all ]; then
  set -- network platform logs data secrets
  if [ "$PROVISIONING" = true ]; then set -- "$@" queues site; fi
  set -- "$@" events app identity provisioning grafana
  if [ "$USE_DOMAIN" = true ]; then set -- dns cert "$@"; fi
  if [ "$ENTRY_MODE" = cloudfront ]; then set -- "$@" edge; else set -- "$@" web; fi
fi
for stack in "$@"; do
  case $stack in
    dns|cert|network|platform|logs|data|secrets|queues|site|events|app|identity|provisioning|grafana|edge|web) "deploy_$stack" ;;
    *) echo "Unknown stack: $stack" >&2; exit 1 ;;
  esac
done
