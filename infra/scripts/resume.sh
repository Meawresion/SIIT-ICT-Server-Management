#!/usr/bin/env bash
# Starts the database (RDS and/or the ECS MySQL, whichever exists), waits until it answers, then
# starts the backend and provisioning services (and the frontend, if any).
. "$(dirname "$0")/lib.sh"

if aws cloudformation describe-stacks --stack-name "$STACK_DATA_RDS" >/dev/null 2>&1; then
  instance=$(stack_output "$STACK_DATA_RDS" DbInstanceId)
  if [ "$(awst rds describe-db-instances --db-instance-identifier "$instance" --query 'DBInstances[0].DBInstanceStatus')" = stopped ]; then
    aws rds start-db-instance --db-instance-identifier "$instance" --query 'DBInstance.[DBInstanceIdentifier,DBInstanceStatus]' --output text
  fi
  echo "(waiting for RDS: a few minutes after a stop)"
  aws rds wait db-instance-available --db-instance-identifier "$instance"
fi
if service_exists mysql; then
  aws ecs update-service --cluster "$PROJECT" --service mysql --desired-count "${DB_DESIRED_COUNT:-1}" \
    --query 'service.[serviceName,desiredCount]' --output text
  aws ecs wait services-stable --cluster "$PROJECT" --services mysql
fi
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
if service_exists grafana; then
  aws ecs update-service --cluster "$PROJECT" --service grafana --desired-count "${GRAFANA_DESIRED_COUNT:-1}" \
    --query 'service.[serviceName,desiredCount]' --output text
  aws ecs wait services-stable --cluster "$PROJECT" --services grafana
fi
if service_exists frontend; then
  aws ecs update-service --cluster "$PROJECT" --service frontend --desired-count "${FRONTEND_DESIRED_COUNT:-1}" \
    --query 'service.[serviceName,desiredCount]' --output text
  aws ecs wait services-stable --cluster "$PROJECT" --services frontend
fi
echo "Running: $(portal_url)"
