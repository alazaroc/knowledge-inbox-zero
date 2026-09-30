#!/usr/bin/env bash
# End-to-end deployment for {{PROJECT_NAME}}.
#
# Usage (default environment: test):
#   ./scripts/deploy.sh                  # deploy everything (infra + frontend)
#   ./scripts/deploy.sh backend          # backend only (CDK)
#   ./scripts/deploy.sh frontend         # frontend only (build + S3 sync + invalidation)
#   ENV=prod ./scripts/deploy.sh         # prod environment
#
# Incremental deploy: skips the component whose code hasn't changed since the last
# successful deploy (fingerprint in .deploy-hashes/). Force with FORCE_DEPLOY=true.
#
# Prerequisites:
#   - AWS CLI configured (profile with permissions).
#   - CDK bootstrap run in the account/region (cdk bootstrap aws://ACCOUNT/REGION).
#   - AWS_PROFILE and AWS_REGION exported, or CDK_DEFAULT_*.

set -euo pipefail

ENV=${ENV:-test}
TARGET=${1:-all}
FORCE_DEPLOY=${FORCE_DEPLOY:-false}
PROJECT={{PROJECT_NAME}}
HASH_DIR=".deploy-hashes"

echo "→ Environment: $ENV"
echo "→ Target:      $TARGET"
echo "→ Force:       $FORCE_DEPLOY"

mkdir -p "$HASH_DIR"

# Deterministic fingerprint of the given version-controlled paths (+ optional extra context).
# Only considers git-tracked files, so node_modules/dist/cdk.out are excluded.
fingerprint() {
  local extra="$1"
  shift
  {
    printf '%s\n' "$extra"
    git ls-files -z -- "$@" | xargs -0 shasum
  } | shasum | awk '{print $1}'
}

# Should "$1" be (re)deployed? Compares its fingerprint "$2" with the stored one (unless FORCE_DEPLOY).
changed() {
  [ "$FORCE_DEPLOY" = "true" ] && return 0
  [ "$(cat "$HASH_DIR/$1" 2>/dev/null || true)" != "$2" ]
}

# Stores the fingerprint "$2" of "$1" after a successful deploy.
mark() {
  printf '%s' "$2" >"$HASH_DIR/$1"
}

deploy_backend() {
  local fp
  fp=$(fingerprint "$ENV" infra/cdk backend shared package-lock.json)
  if ! changed "backend-$ENV" "$fp"; then
    echo "▶ Backend unchanged — skipping (set FORCE_DEPLOY=true to force)"
    return
  fi

  echo "▶ Build shared"
  npm run build -w shared

  echo "▶ CDK deploy (storage + auth + api + frontend stacks)"
  (cd infra/cdk && npx cdk deploy --all --require-approval never -c env="$ENV")

  mark "backend-$ENV" "$fp"
}

deploy_frontend() {
  echo "▶ Resolving endpoints from SSM"
  local USER_POOL_ID USER_POOL_CLIENT_ID API_URL BUCKET DIST_ID fp

  USER_POOL_ID=$(aws ssm get-parameter --name "/${PROJECT}/${ENV}/user-pool-id" --query Parameter.Value --output text)
  USER_POOL_CLIENT_ID=$(aws ssm get-parameter --name "/${PROJECT}/${ENV}/user-pool-client-id" --query Parameter.Value --output text)
  API_URL=$(aws ssm get-parameter --name "/${PROJECT}/${ENV}/api-url" --query Parameter.Value --output text)
  BUCKET=$(aws cloudformation describe-stacks --stack-name "${PROJECT}-frontend-${ENV}" \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" --output text)
  DIST_ID=$(aws cloudformation describe-stacks --stack-name "${PROJECT}-frontend-${ENV}" \
    --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)

  # Endpoints are baked into the build → if they change (e.g. a new API URL), redeploy.
  fp=$(fingerprint "${API_URL}|${USER_POOL_ID}|${USER_POOL_CLIENT_ID}" frontend shared package-lock.json)
  if ! changed "frontend-$ENV" "$fp"; then
    echo "▶ Frontend unchanged — skipping (set FORCE_DEPLOY=true to force)"
    return
  fi

  echo "▶ Build frontend with env vars"
  VITE_USER_POOL_ID="$USER_POOL_ID" \
    VITE_USER_POOL_CLIENT_ID="$USER_POOL_CLIENT_ID" \
    VITE_API_URL="$API_URL" \
    npm run build -w frontend

  echo "▶ Sync to s3://$BUCKET"
  aws s3 sync frontend/dist "s3://$BUCKET" --delete

  echo "▶ Invalidating CloudFront $DIST_ID"
  aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' >/dev/null

  mark "frontend-$ENV" "$fp"
}

case "$TARGET" in
  all)
    deploy_backend
    deploy_frontend
    ;;
  backend)
    deploy_backend
    ;;
  frontend)
    deploy_frontend
    ;;
  *)
    echo "Unrecognized target: $TARGET (use: all | backend | frontend)"
    exit 1
    ;;
esac

echo "✔ Deployment complete."
