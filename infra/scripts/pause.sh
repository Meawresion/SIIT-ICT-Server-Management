#!/usr/bin/env bash
# Stops the frontend, Grafana, identity, backend, provisioning and MySQL tasks between test sessions (the ALB, EFS and CloudFront
# stay). The data stays on EFS. On RDS (rds stack) it stops the instance too: the data and backups
# stay, storage is still billed, and AWS starts it again by itself after 7 days. resume.sh starts
# them again; the next deploy.sh also restores the counts (not a stopped RDS instance: resume.sh).
. "$(dirname "$0")/lib.sh"

services=(backend)
service_exists mysql && services+=(mysql)
service_exists provisioning && services=(provisioning "${services[@]}")
service_exists identity && services=(identity "${services[@]}")
service_exists frontend && services=(frontend "${services[@]}")
service_exists grafana && services=(grafana "${services[@]}")
for service in "${services[@]}"; do
  aws ecs update-service --cluster "$PROJECT" --service "$service" --desired-count 0 \
    --query 'service.[serviceName,desiredCount]' --output text
done
aws ecs wait services-stable --cluster "$PROJECT" --services "${services[@]}"
if aws cloudformation describe-stacks --stack-name "$STACK_DATA_RDS" >/dev/null 2>&1; then
  instance=$(stack_output "$STACK_DATA_RDS" DbInstanceId)
  if [ "$(awst rds describe-db-instances --db-instance-identifier "$instance" --query 'DBInstances[0].DBInstanceStatus')" = available ]; then
    aws rds stop-db-instance --db-instance-identifier "$instance" --query 'DBInstance.[DBInstanceIdentifier,DBInstanceStatus]' --output text
  fi
fi
echo "Paused."
