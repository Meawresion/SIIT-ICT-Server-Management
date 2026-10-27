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
overrides=$(declare -p ENTRY_MODE USE_DOMAIN GOOGLE_SECRET_ARN 2>/dev/null || true)
set -a
# shellcheck source=/dev/null
. "$CONFIG"
set +a
eval "$overrides"
for key in AWS_PROFILE AWS_REGION PROJECT ZONE_NAME APP_HOST ORIGIN_HOST ROLE_NAME GOOGLE_SECRET_NAME DOCKER; do
  if [ -z "${!key:-}" ]; then echo "Missing $key in $CONFIG" >&2; exit 1; fi
done
export AWS_DEFAULT_REGION="$AWS_REGION"
# cloudfront: the target design. direct: the ALB is the public entry (accounts without CloudFront).
ENTRY_MODE=${ENTRY_MODE:-cloudfront}
# false: no hosted zone or certificate; the ALB answers on its AWS name over HTTP (smoke tests).
USE_DOMAIN=${USE_DOMAIN:-true}

STACK_DNS="$PROJECT-dns"
STACK_CERT="$PROJECT-cert"
STACK_NETWORK="$PROJECT-network"
STACK_PLATFORM="$PROJECT-platform"
STACK_DATA="$PROJECT-data"
STACK_APP="$PROJECT-app"
STACK_EDGE="$PROJECT-edge"

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
mysql_tag() { image_tag database/Dockerfile database/init.sql; }

require_image() {
  if ! aws ecr describe-images --repository-name "$1" --image-ids "imageTag=$2" >/dev/null 2>&1; then
    echo "Image $1:$2 isn't in ECR yet: run infra/scripts/push-images.sh first." >&2
    exit 1
  fi
}

# Docker may run in WSL (DOCKER="wsl.exe -d <distro> -- docker"): it then needs WSL paths.
docker_path() {
  if [[ $DOCKER == wsl.exe* ]]; then
    local distro
    distro=$(sed -E 's/.*-d ([^ ]+).*/\1/' <<<"$DOCKER")
    MSYS_NO_PATHCONV=1 wsl.exe -d "$distro" -- wslpath -a "$(cygpath -m "$1")" | tr -d '\r'
  else
    echo "$1"
  fi
}
docker_() { MSYS_NO_PATHCONV=1 $DOCKER "$@"; }
