#!/usr/bin/env bash
# Switches an account between Approver and Student, e.g. to show both sides in a demo. The person
# signs in with Google once first; the change counts from their next click (about a minute for the
# one-off task to run).
# Usage: set-role.sh <email> Approver|Student
# Roles by hand only work while APPROVER_EMAILS is empty on the services: with the list set, the
# list decides and would undo this. For a demo: empty APPROVER_EMAILS in config.env, run
# deploy.sh app identity provisioning, swap roles with this script; afterwards put the list back
# and deploy again.
. "$(dirname "$0")/lib.sh"

[ $# -eq 2 ] || { echo "Usage: $0 <email> Approver|Student" >&2; exit 1; }
case $2 in
  Approver|Student) ;;
  *) echo "The role must be Approver or Student." >&2; exit 1 ;;
esac

# What the running identity service has, not config.env (which may not be deployed yet).
task_definition=$(stack_output "$STACK_IDENTITY" TaskDefinitionArn)
approvers=$(awst ecs describe-task-definition --task-definition "$task_definition" \
  --query "taskDefinition.containerDefinitions[0].environment[?name=='APPROVER_EMAILS'].value | [0]")
if [ -n "$approvers" ] && [ "$approvers" != None ]; then
  echo "The services run with APPROVER_EMAILS set, so the list decides who is an approver and" >&2
  echo "this change would be undone. Empty APPROVER_EMAILS in config.env, run" >&2
  echo "deploy.sh app identity provisioning, then run this again." >&2
  exit 1
fi

exec "$(dirname "$0")/run-task.sh" --identity node scripts/set-user-role.js "$1" "$2"
