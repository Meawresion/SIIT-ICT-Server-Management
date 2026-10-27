#!/usr/bin/env bash
# Builds the backend (production stage) and MySQL images and pushes them to ECR.
# Usage: push-images.sh [backend] [mysql]   (default: both). Needs the platform stack.
. "$(dirname "$0")/lib.sh"

registry="$(account_id).dkr.ecr.$AWS_REGION.amazonaws.com"
aws ecr get-login-password | docker_ login --username AWS --password-stdin "$registry"

push() {
  local name=$1 tag=$2 context=$3
  shift 3
  local image="$registry/$PROJECT-$name:$tag"
  if aws ecr describe-images --repository-name "$PROJECT-$name" --image-ids "imageTag=$tag" >/dev/null 2>&1 \
     && [[ $tag != *-dirty ]]; then
    echo "== $image already in ECR"
    return
  fi
  echo "== $image"
  docker_ build -t "$image" "$@" "$(docker_path "$context")"
  docker_ push "$image"
}

[ $# -gt 0 ] || set -- backend mysql
for name in "$@"; do
  case $name in
    backend) push backend "$(backend_tag)" "$REPO_DIR/backend" --target prod ;;
    mysql) push mysql "$(mysql_tag)" "$REPO_DIR/database" ;;
    *) echo "Unknown image: $name" >&2; exit 1 ;;
  esac
done
