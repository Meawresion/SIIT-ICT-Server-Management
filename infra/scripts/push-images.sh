#!/usr/bin/env bash
# Builds the images (production stages) and pushes them to ECR. Needs the platform stack.
# Usage: push-images.sh [backend] [mysql] [frontend]
#   default: backend and mysql, plus frontend in direct mode (with CloudFront it goes to S3:
#   publish-frontend.sh).
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

if [ $# -eq 0 ]; then
  set -- backend mysql
  if [ "$ENTRY_MODE" = direct ]; then set -- "$@" frontend; fi
fi
for name in "$@"; do
  case $name in
    backend) push backend "$(backend_tag)" "$REPO_DIR/backend" --target prod ;;
    mysql) push mysql "$(mysql_tag)" "$REPO_DIR/database" ;;
    # Same origin as the API: VITE_API_URL stays empty. A new CONTACT_EMAIL needs a new commit
    # in frontend/ (or a -dirty build), because the tag follows frontend/ only.
    frontend) push frontend "$(frontend_tag)" "$REPO_DIR/frontend" --target prod \
      --build-arg "VITE_CONTACT_EMAIL=${CONTACT_EMAIL:-}" ;;
    *) echo "Unknown image: $name" >&2; exit 1 ;;
  esac
done
