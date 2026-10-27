#!/usr/bin/env bash
# Builds the frontend for the same origin as the API (CloudFront) and uploads it to S3.
. "$(dirname "$0")/lib.sh"

bucket=$(stack_output "$STACK_EDGE" BucketName)
distribution=$(stack_output "$STACK_EDGE" DistributionId)
dist="$REPO_DIR/frontend/dist"

# Empty VITE_API_URL: the browser calls /api/... on the page's own origin. Values set here win over
# the root .env, which Vite also reads.
(cd "$REPO_DIR/frontend" && VITE_API_URL= VITE_CONTACT_EMAIL="${CONTACT_EMAIL:-}" npm run build)

# File names under assets/ change with their content, so they can be cached for good. Old ones
# stay, so a tab opened before the upload keeps working.
aws s3 sync "$dist/assets" "s3://$bucket/assets" --cache-control "public,max-age=31536000,immutable"
aws s3 sync "$dist" "s3://$bucket" --exclude "assets/*" --cache-control "no-cache" --delete
aws cloudfront create-invalidation --distribution-id "$distribution" --paths "/" "/index.html" \
  --query Invalidation.Id --output text
echo "Published to $(stack_output "$STACK_EDGE" AppUrl)"
