#!/usr/bin/env bash
# Moves the portal's database from the ECS MySQL (data stack) to RDS (rds stack) with its data.
# Set DATA_MODE=rds in config.env first. Steps:
#  1. creates the rds stack: RDS Multi-AZ, the schema, the service users (15-25 minutes; the portal
#     keeps running on the ECS MySQL meanwhile);
#  2. stops the services that write (backend, identity, provisioning): the portal is down from here;
#  3. copies the data into RDS in one transaction and compares the row counts (rds-init.sh; only
#     into an RDS database without accounts);
#  4. deploys app, identity and provisioning on RDS: they start again (about 5 minutes down in all);
#  5. removes the copy settings from the rds stack, so it no longer depends on the data stack.
# If step 3 fails, the services start again on the ECS MySQL and nothing has changed for them.
# The data stack (and its EFS data) stays until you delete it yourself, after checking the portal:
#   aws cloudformation delete-stack --stack-name <project>-data
# Until then the way back is DATA_MODE=ecs and deploy.sh app identity provisioning (changes made
# on RDS in the meantime stay on RDS).
. "$(dirname "$0")/lib.sh"
SCRIPTS="$(dirname "$0")"

if [ "$DATA_MODE" != rds ]; then
  echo "Set DATA_MODE=rds in $CONFIG first (the deploys after the switch must use RDS too)." >&2
  exit 1
fi
if ! aws cloudformation describe-stacks --stack-name "$STACK_DATA_ECS" >/dev/null 2>&1; then
  echo "There is no $STACK_DATA_ECS stack, so there is nothing to copy: deploy.sh data creates an empty RDS database." >&2
  exit 1
fi
# The copy reads from the ECS MySQL, so it must run.
if [ "$(awst ecs describe-services --cluster "$PROJECT" --services mysql --query 'services[0].runningCount')" = 0 ]; then
  echo "The ECS MySQL isn't running: start it with resume.sh first." >&2
  exit 1
fi

writers=()
for service in backend identity provisioning; do service_exists "$service" && writers+=("$service"); done

echo "== 1/5 RDS (the portal still runs on the ECS MySQL)"
# A new RDS database, not a restored snapshot: the copy goes only into an empty one.
DB_RESTORE=none "$SCRIPTS/deploy.sh" data

echo "== 2/5 stopping ${writers[*]} (the portal is down until step 4)"
for service in "${writers[@]}"; do
  aws ecs update-service --cluster "$PROJECT" --service "$service" --desired-count 0 \
    --query 'service.[serviceName,desiredCount]' --output text
done
[ ${#writers[@]} -eq 0 ] || aws ecs wait services-stable --cluster "$PROJECT" --services "${writers[@]}"

echo "== 3/5 copying the data into RDS"
if ! COPY_FROM_STACK=$STACK_DATA_ECS "$SCRIPTS/deploy.sh" data; then
  echo "!! The copy failed (above). Starting ${writers[*]} again on the ECS MySQL." >&2
  for service in "${writers[@]}"; do
    count_var="$(tr 'a-z' 'A-Z' <<<"$service")_DESIRED_COUNT"
    aws ecs update-service --cluster "$PROJECT" --service "$service" --desired-count "${!count_var:-1}" \
      --query 'service.[serviceName,desiredCount]' --output text
  done
  echo "Nothing changed for the portal. Fix the cause; switch-to-rds.sh copies only into an empty RDS" >&2
  echo "database, so delete the $STACK_DATA_RDS stack before trying again if the copy got that far." >&2
  exit 1
fi

echo "== 4/5 the services on RDS"
"$SCRIPTS/deploy.sh" app identity provisioning

echo "== 5/5 removing the copy settings"
"$SCRIPTS/deploy.sh" data

echo "Done: the portal runs on RDS ($(stack_output "$STACK_DATA_RDS" DbHost))."
echo "Check it, then delete the old database: aws cloudformation delete-stack --stack-name $STACK_DATA_ECS"
