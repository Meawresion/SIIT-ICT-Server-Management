#!/usr/bin/env bash
# Runs a one-off command in a request service task (same image, settings, secrets and database
# user) and prints its log.
# --identity: in an identity service task instead (Google client, the identity database user).
# --provisioning: in a provisioning service task (site queues, keys, scheduler settings, its user).
# --env NAME=VALUE (repeatable): adds a setting to this task only, e.g. a queue URL for a check.
# --db-init: the rds stack's init task (rds-init.sh: schema, service users, the copy); no command.
# Examples:
#   run-task.sh --identity node scripts/set-user-role.js person@siit.tu.ac.th Approver
#   run-task.sh node scripts/check-db.js <marker>
#   run-task.sh --provisioning node scripts/check-grants.js
. "$(dirname "$0")/lib.sh"

stack=$STACK_APP container=backend env=() definition=TaskDefinitionArn log_group='' log_prefix=''
while [ $# -gt 0 ]; do
  case $1 in
    --identity) stack=$STACK_IDENTITY container=identity; shift ;;
    --provisioning) stack=$STACK_PROVISIONING container=provisioning; shift ;;
    --db-init) stack=$STACK_DATA_RDS container=rds-init definition=InitTaskDefinitionArn log_group=mysql log_prefix=db-init; shift ;;
    --env) env+=("$2"); shift 2 ;;
    *) break ;;
  esac
done
[ $# -gt 0 ] || [ "$container" = rds-init ] || { echo "Usage: $0 [--identity|--provisioning|--db-init] [--env NAME=VALUE]... <command> [args...]" >&2; exit 1; }
log_group=${log_group:-$container} log_prefix=${log_prefix:-$container}

task_definition=$(stack_output "$stack" "$definition")
subnets=$(stack_output "$STACK_NETWORK" PublicSubnets)
security_group=$(stack_output "$STACK_PLATFORM" BackendSecurityGroupId)
overrides=$(node -e '
  const [name, env, ...command] = process.argv.slice(1);
  const environment = env ? env.split("\n").map((e) => ({ name: e.slice(0, e.indexOf("=")), value: e.slice(e.indexOf("=") + 1) })) : [];
  console.log(JSON.stringify({ containerOverrides: [{ name, environment, ...(command.length ? { command } : {}) }] }));' -- "$container" "$(printf '%s\n' "${env[@]}" | sed '/^$/d')" "$@")

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
MSYS_NO_PATHCONV=1 awst logs get-log-events --log-group-name "/$PROJECT/$log_group" \
  --log-stream-name "$log_prefix/$container/${task_arn##*/}" --start-from-head --query 'events[].message' | tr '\t' '\n' \
  || echo "(couldn't read the task's log)"
echo "Exit code: $exit_code"
[ "$exit_code" = 0 ]
