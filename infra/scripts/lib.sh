#!/usr/bin/env bash
# Shared settings and helpers for the infra scripts. Settings come from infra/config.env.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"
TEMPLATES="$INFRA_DIR/cloudformation"
CONFIG="${CONFIG:-$INFRA_DIR/config.env}"

if [ ! -f "$CONFIG" ]; then
  echo "Missing $CONFIG: copy infra/config.example.env and fill it in." >&2
  exit 1
fi
# Values set in the environment (ENTRY_MODE=direct deploy.sh app) win over config.env.
overrides=$(declare -p ENTRY_MODE USE_DOMAIN PROVISIONING SITE_PUBLIC_KEYS GPU_NODES OVPN_PROFILE_URL MANUAL_GPU_URL MANUAL_BIGDATA_URL SCHEDULER_INTERVAL_SEC 2>/dev/null || true)
set -a
# shellcheck source=/dev/null
. "$CONFIG"
set +a
eval "$overrides"
# The secrets in config.env stay shell variables of this script: they are not passed on to the
# programs it runs (aws, docker, node). set-secrets.sh hands them to one node process.
SECRET_KEYS=(GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_APP_PASSWORD MAIL_FROM MAIL_REPLY_TO)
export -n "${SECRET_KEYS[@]}" 2>/dev/null || true
for key in AWS_PROFILE AWS_REGION PROJECT ZONE_NAME APP_HOST ORIGIN_HOST ROLE_NAME DOCKER; do
  if [ -z "${!key:-}" ]; then echo "Missing $key in $CONFIG" >&2; exit 1; fi
done
export AWS_DEFAULT_REGION="$AWS_REGION"
# A config.env written for Git Bash (DOCKER="wsl.exe -d <distro> -- docker") also works from a WSL
# shell, where Docker runs right here.
if [[ $DOCKER == wsl.exe* ]] && ! command -v cygpath >/dev/null && grep -qi microsoft /proc/version 2>/dev/null; then
  DOCKER=docker
fi
# cloudfront: the target design. direct: the ALB is the public entry (accounts without CloudFront).
ENTRY_MODE=${ENTRY_MODE:-cloudfront}
# false: no hosted zone or certificate; the ALB answers on its AWS name over HTTP (smoke tests).
USE_DOMAIN=${USE_DOMAIN:-true}
# true: the queues stack and automatic provisioning of GPU requests through acc-prov-vm.
PROVISIONING=${PROVISIONING:-false}

STACK_DNS="$PROJECT-dns"
STACK_CERT="$PROJECT-cert"
STACK_NETWORK="$PROJECT-network"
STACK_PLATFORM="$PROJECT-platform"
STACK_DATA="$PROJECT-data"
STACK_APP="$PROJECT-app"
STACK_EDGE="$PROJECT-edge"
STACK_WEB="$PROJECT-web"
STACK_QUEUES="$PROJECT-queues"
STACK_SECRETS="$PROJECT-secrets"

# aws with text output and without the Windows carriage returns
awst() { aws --output text "$@" | tr -d '\r'; }

account_id() { awst sts get-caller-identity --query Account; }
role_arn() { echo "arn:aws:iam::$(account_id):role/$ROLE_NAME"; }

stack_output() {
  awst cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue"
}

# deploy <stack> <template> [Key=Value ...]
deploy() {
  local stack=$1 template=$2
  shift 2
  local params=()
  if [ $# -gt 0 ]; then params=(--parameter-overrides "$@"); fi
  echo "== $stack ($template)"
  aws cloudformation deploy --stack-name "$stack" --template-file "$TEMPLATES/$template" \
    --no-fail-on-empty-changeset "${params[@]}"
}

# Image tags follow the last commit that changed the image's sources, so a deploy only replaces
# the tasks whose image changed. Uncommitted changes get a -dirty tag.
image_tag() {
  local tag
  tag=$(git -C "$REPO_DIR" log -1 --format=%h -- "$@")
  [ -n "$(git -C "$REPO_DIR" status --porcelain -- "$@")" ] && tag="$tag-dirty"
  echo "$tag"
}
backend_tag() { image_tag backend; }
mysql_tag() { image_tag database/Dockerfile database/init.sql database/privileges.sh; }
frontend_tag() { image_tag frontend; }

# The portal's address: CloudFront (edge stack) or the ALB itself (direct mode).
portal_url() {
  if [ "$ENTRY_MODE" = cloudfront ]; then stack_output "$STACK_EDGE" AppUrl; else stack_output "$STACK_APP" PublicUrl; fi
}

service_exists() {
  [ "$(awst ecs describe-services --cluster "$PROJECT" --services "$1" --query "services[?status=='ACTIVE'] | length(@)" 2>/dev/null)" = 1 ]
}

require_image() {
  if ! aws ecr describe-images --repository-name "$1" --image-ids "imageTag=$2" >/dev/null 2>&1; then
    echo "Image $1:$2 isn't in ECR yet: run infra/scripts/push-images.sh first." >&2
    exit 1
  fi
}

# From Git Bash, Docker may run in WSL (DOCKER="wsl.exe -d <distro> -- docker"): it then needs WSL
# paths. Run from WSL or Linux itself (no cygpath), a path is already one.
docker_path() {
  if [[ $DOCKER == wsl.exe* ]] && command -v cygpath >/dev/null; then
    local distro
    distro=$(sed -E 's/.*-d ([^ ]+).*/\1/' <<<"$DOCKER")
    MSYS_NO_PATHCONV=1 wsl.exe -d "$distro" -- wslpath -a "$(cygpath -m "$1")" | tr -d '\r'
  else
    echo "$1"
  fi
}
docker_() { MSYS_NO_PATHCONV=1 $DOCKER "$@"; }

# Kept between test runs (they run nothing; platform holds the ECR images, so a run only uploads
# what changed). Only teardown-all.sh deletes them.
KEPT_STACKS=("$STACK_NETWORK" "$STACK_PLATFORM")

delete_one() {
  local stack=$1 bucket
  aws cloudformation describe-stacks --stack-name "$stack" >/dev/null 2>&1 || return 0
  if [ "$stack" = "$STACK_EDGE" ]; then
    bucket=$(stack_output "$stack" BucketName 2>/dev/null || true)
    [ -n "$bucket" ] && aws s3 rm "s3://$bucket" --recursive --quiet
  fi
  echo "== deleting $stack"
  aws cloudformation delete-stack --stack-name "$stack"
  if aws cloudformation wait stack-delete-complete --stack-name "$stack"; then
    echo "== $stack deleted"
  else
    echo "!! $stack did not delete cleanly; check the console" >&2
    return 1
  fi
}

# delete_stacks <stack>...: stops every ECS task at once, then deletes the given stacks in waves:
# a stack goes only after the stacks that import from it, and the stacks of one wave go in parallel.
delete_stacks() {
  local wanted=" $* " wave stack failed=0 pids p service
  for service in frontend backend mysql; do
    if service_exists "$service"; then
      aws ecs update-service --cluster "$PROJECT" --service "$service" --desired-count 0 >/dev/null || true
    fi
  done
  for wave in "$STACK_EDGE $STACK_WEB" "$STACK_APP" "$STACK_QUEUES $STACK_DATA $STACK_SECRETS" \
    "$STACK_PLATFORM $STACK_CERT" "$STACK_NETWORK $STACK_DNS"; do
    pids=()
    for stack in $wave; do
      [[ $wanted == *" $stack "* ]] || continue
      delete_one "$stack" &
      pids+=($!)
    done
    for p in "${pids[@]}"; do wait "$p" || failed=1; done
  done
  return "$failed"
}

# leftovers [<stack allowed to stay>...]: lists anything of this project still in the account,
# except the given stacks and what they hold (network: the VPC; platform: ECR and the cluster).
leftovers() {
  local found=0 allowed=" $* "
  check() { # check <label> <aws args...>: anything listed, or a failed query, counts as left behind
    local label=$1 out
    shift
    if ! out=$(MSYS_NO_PATHCONV=1 aws --output text "$@" 2>&1 | tr -d '\r'); then
      echo "LEFT? $label: the check failed: $out"
      found=1
    elif [ -n "$out" ] && [ "$out" != None ]; then
      echo "LEFT  $label: $out"
      found=1
    fi
  }
  local skip
  skip=$(printf "'%s'," "$@")
  check "stacks" cloudformation list-stacks \
    --query "StackSummaries[?starts_with(StackName,'$PROJECT-') && !contains([${skip%,}], StackName) && StackStatus!='DELETE_COMPLETE'].[StackName,StackStatus]"
  if [[ $allowed != *" $STACK_PLATFORM "* ]]; then
    check "ECR repositories" ecr describe-repositories --query "repositories[?starts_with(repositoryName,'$PROJECT-')].repositoryName"
    check "ECS clusters" ecs list-clusters --query "clusterArns[?ends_with(@,'/$PROJECT')]"
  else
    check "ECS services" ecs list-services --cluster "$PROJECT" --query 'serviceArns'
    check "ECS tasks" ecs list-tasks --cluster "$PROJECT" --query 'taskArns'
  fi
  if [[ $allowed != *" $STACK_NETWORK "* ]]; then
    check "VPCs" ec2 describe-vpcs --filters "Name=tag:Name,Values=$PROJECT-vpc" --query 'Vpcs[].VpcId'
  fi
  check "load balancers" elbv2 describe-load-balancers --query 'LoadBalancers[].LoadBalancerName'
  check "EFS file systems" efs describe-file-systems --query "FileSystems[?Name=='$PROJECT-mysql-data'].FileSystemId"
  check "log groups" logs describe-log-groups --log-group-name-prefix "/$PROJECT/" --query 'logGroups[].logGroupName'
  check "SQS queues" sqs list-queues --queue-name-prefix "$PROJECT-" --query 'QueueUrls'
  check "Lambda functions" lambda list-functions --query "Functions[?starts_with(FunctionName,'$PROJECT-')].FunctionName"
  check "secrets (incl. pending deletion)" secretsmanager list-secrets --include-planned-deletion \
    --query "SecretList[?starts_with(Description,'$PROJECT ')].[Name,DeletedDate]"
  if [ "$found" = 0 ]; then echo "Nothing left behind${1:+ (kept: $*)}."; else echo "Something is left behind (above)."; return 1; fi
}

# What the kept stacks hold, for the end of a test run.
show_kept() {
  local repo
  for repo in backend mysql frontend; do
    echo "  ECR $PROJECT-$repo: $(awst ecr describe-images --repository-name "$PROJECT-$repo" \
      --query 'imageDetails[].[imageTags[0], imageSizeInBytes]' 2>/dev/null |
      awk '{ printf "%s%s (%.0f MB)", (NR > 1 ? ", " : ""), $1, $2 / 1048576 } END { if (!NR) printf "none" }')"
  done
}
