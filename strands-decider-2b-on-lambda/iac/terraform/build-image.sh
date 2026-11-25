#!/usr/bin/env bash
set -euo pipefail

region=$(terraform output -raw aws_region)
project=$(terraform output -raw build_project_name)
repository=$(terraform output -raw repository_name)

build_id=$(aws codebuild start-build --region "$region" --project-name "$project" \
  --query 'build.id' --output text)
printf 'CodeBuild: %s\n' "$build_id" >&2

while true; do
  status=$(aws codebuild batch-get-builds --region "$region" --ids "$build_id" \
    --query 'builds[0].buildStatus' --output text)
  case "$status" in
    SUCCEEDED) break ;;
    IN_PROGRESS) sleep 15 ;;
    *)
      printf 'CodeBuild status: %s. See /aws/codebuild/%s in CloudWatch Logs.\n' "$status" "$project" >&2
      exit 1
      ;;
  esac
done

digest=$(aws ecr describe-images --region "$region" --repository-name "$repository" \
  --image-ids "imageTag=${build_id##*:}" --query 'imageDetails[0].imageDigest' --output text)
if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  printf 'ECR did not return an image digest for %s.\n' "$build_id" >&2
  exit 1
fi
printf 'image_digest = "%s"\n' "$digest" > image.auto.tfvars
printf 'ECR digest: %s\n' "$digest"
