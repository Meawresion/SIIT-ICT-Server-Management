#!/usr/bin/env bash
# Read-only check of what this account allows, before deploying anything. It creates nothing.
. "$(dirname "$0")/lib.sh"
set +e

failures=0
check() {
  local label=$1
  shift
  if out=$("$@" 2>&1); then
    echo "ok    $label"
  else
    failures=$((failures + 1))
    echo "FAIL  $label: $(tr -d '\r' <<<"$out" | grep -m1 -oE '\(([A-Za-z]+)\)[^:]*|An error occurred.*|Could not.*|Unable.*' || echo "${out:0:160}")"
  fi
}

echo "Profile $AWS_PROFILE, region $AWS_REGION"
check "credentials (sts)" aws sts get-caller-identity
check "IAM (the stacks create their own roles)" aws iam list-roles --max-items 1
check "IAM Roles Anywhere" aws rolesanywhere list-trust-anchors
check "SSM Parameter Store" aws ssm describe-parameters --max-results 1
check "RDS" aws rds describe-db-instances --max-records 20
check "CloudFormation" aws cloudformation list-stacks --max-items 1
check "ECR" aws ecr describe-repositories --max-items 1
check "ECS" aws ecs list-clusters --max-items 1
check "ELB" aws elbv2 describe-load-balancers --page-size 1
check "EFS" aws efs describe-file-systems --max-items 1
check "Secrets Manager" aws secretsmanager list-secrets --max-results 1
check "CloudFront" aws cloudfront list-distributions --max-items 1
check "Route 53" aws route53 list-hosted-zones --max-items 1
check "ACM (us-east-1)" aws acm list-certificates --region us-east-1 --max-items 1
check "SQS" aws sqs list-queues --max-results 1
check "CloudWatch Logs" aws logs describe-log-groups --limit 1
check "CloudFront prefix list" aws ec2 describe-managed-prefix-lists \
  --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing
# Names already taken by someone else in a shared account (should be none).
taken=$(awst cloudformation list-stacks --query "length(StackSummaries[?starts_with(StackName,'$PROJECT-') && StackStatus!='DELETE_COMPLETE'])")
echo "info  stacks named $PROJECT-*: $taken"
echo "$failures check(s) failed."
[ "$failures" = 0 ]
