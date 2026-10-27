#!/usr/bin/env bash
# Starts MySQL, waits until it is running, then starts the backend.
. "$(dirname "$0")/lib.sh"

aws ecs update-service --cluster "$PROJECT" --service mysql --desired-count "${DB_DESIRED_COUNT:-1}" \
  --query 'service.[serviceName,desiredCount]' --output text
aws ecs wait services-stable --cluster "$PROJECT" --services mysql
aws ecs update-service --cluster "$PROJECT" --service backend --desired-count "${BACKEND_DESIRED_COUNT:-1}" \
  --query 'service.[serviceName,desiredCount]' --output text
aws ecs wait services-stable --cluster "$PROJECT" --services backend
echo "Running: $(stack_output "$STACK_EDGE" AppUrl)"
