#!/usr/bin/env bash
# Runs a one-off command in a backend task (same image, settings and secrets) and prints its log.
# Examples:
#   run-task.sh node scripts/set-user-role.js person@siit.tu.ac.th Approver
#   run-task.sh node scripts/check-db.js
. "$(dirname "$0")/lib.sh"

[ $# -gt 0 ] || { echo "Usage: $0 <command> [args...]" >&2; exit 1; }

task_definition=$(stack_output "$STACK_APP" TaskDefinitionArn)
subnets=$(stack_output "$STACK_NETWORK" PublicSubnets)
security_group=$(stack_output "$STACK_PLATFORM" BackendSecurityGroupId)
overrides=$(node -e 'console.log(JSON.stringify({ containerOverrides: [{ name: "backend", command: process.argv.slice(1) }] }))' -- "$@")

task_arn=$(awst ecs run-task --cluster "$PROJECT" --launch-type FARGATE --task-definition "$task_definition" \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=ENABLED}" \
  --overrides "$overrides" --query 'tasks[0].taskArn')
echo "Started ${task_arn##*/}; waiting for it to finish..."
aws ecs wait tasks-stopped --cluster "$PROJECT" --tasks "$task_arn"

exit_code=$(awst ecs describe-tasks --cluster "$PROJECT" --tasks "$task_arn" --query 'tasks[0].containers[0].exitCode')
awst logs get-log-events --log-group-name "/$PROJECT/backend" --log-stream-name "backend/backend/${task_arn##*/}" \
  --start-from-head --query 'events[].message' | tr '\t' '\n'
echo "Exit code: $exit_code"
[ "$exit_code" = 0 ]
