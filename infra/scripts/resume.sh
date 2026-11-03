#!/usr/bin/env bash
# Starts MySQL, waits until it is running, then starts the backend and provisioning services (and the
# frontend, if any).
. "$(dirname "$0")/lib.sh"

aws ecs update-service --cluster "$PROJECT" --service mysql --desired-count "${DB_DESIRED_COUNT:-1}" \
  --query 'service.[serviceName,desiredCount]' --output text
aws ecs wait services-stable --cluster "$PROJECT" --services mysql
aws ecs update-service --cluster "$PROJECT" --service backend --desired-count "${BACKEND_DESIRED_COUNT:-1}" \
  --query 'service.[serviceName,desiredCount]' --output text
aws ecs wait services-stable --cluster "$PROJECT" --services backend
if service_exists identity; then
  aws ecs update-service --cluster "$PROJECT" --service identity --desired-count "${IDENTITY_DESIRED_COUNT:-1}" \
    --query 'service.[serviceName,desiredCount]' --output text
  aws ecs wait services-stable --cluster "$PROJECT" --services identity
fi
if service_exists provisioning; then
  aws ecs update-service --cluster "$PROJECT" --service provisioning --desired-count "${PROVISIONING_DESIRED_COUNT:-1}" \
    --query 'service.[serviceName,desiredCount]' --output text
  aws ecs wait services-stable --cluster "$PROJECT" --services provisioning
fi
if service_exists frontend; then
  aws ecs update-service --cluster "$PROJECT" --service frontend --desired-count "${FRONTEND_DESIRED_COUNT:-1}" \
    --query 'service.[serviceName,desiredCount]' --output text
  aws ecs wait services-stable --cluster "$PROJECT" --services frontend
fi
echo "Running: $(portal_url)"
