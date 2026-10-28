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

# A task that never starts (e.g. a timeout pulling the image from ECR) ran nothing, so it is tried
# once more.
for attempt in 1 2; do
  task_arn=$(awst ecs run-task --cluster "$PROJECT" --launch-type FARGATE --task-definition "$task_definition" \
    --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=ENABLED}" \
    --overrides "$overrides" --query 'tasks[0].taskArn')
  echo "Started ${task_arn##*/}; waiting for it to finish..."
  aws ecs wait tasks-stopped --cluster "$PROJECT" --tasks "$task_arn"
  read -r stop_code exit_code < <(awst ecs describe-tasks --cluster "$PROJECT" --tasks "$task_arn" \
    --query 'tasks[0].[stopCode, containers[0].exitCode]')
  [ "$stop_code" = TaskFailedToStart ] || break
  echo "The task did not start: $(awst ecs describe-tasks --cluster "$PROJECT" --tasks "$task_arn" --query 'tasks[0].stoppedReason')"
done
# MSYS_NO_PATHCONV: Git Bash would turn the log group name /<project>/backend into a Windows path.
MSYS_NO_PATHCONV=1 awst logs get-log-events --log-group-name "/$PROJECT/backend" \
  --log-stream-name "backend/backend/${task_arn##*/}" --start-from-head --query 'events[].message' | tr '\t' '\n' \
  || echo "(couldn't read the task's log)"
echo "Exit code: $exit_code"
[ "$exit_code" = 0 ]
