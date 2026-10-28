#!/usr/bin/env bash
# Stops the frontend, backend and MySQL tasks between test sessions (the ALB, EFS and CloudFront
# stay). The data stays on EFS. resume.sh starts them again; the next deploy.sh also restores the
# counts.
. "$(dirname "$0")/lib.sh"

services=(backend mysql)
service_exists frontend && services=(frontend "${services[@]}")
for service in "${services[@]}"; do
  aws ecs update-service --cluster "$PROJECT" --service "$service" --desired-count 0 \
    --query 'service.[serviceName,desiredCount]' --output text
done
aws ecs wait services-stable --cluster "$PROJECT" --services "${services[@]}"
echo "Paused."
