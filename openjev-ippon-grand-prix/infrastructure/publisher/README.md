# MicroVM artifact publisher

This Terraform root creates the private, versioned S3 bucket and CodeBuild project that publish the verified MicroVM build context. It deliberately has separate state from `../terraform`: create the publisher first, publish an immutable artifact, then deploy the application using that artifact key.

## Bootstrap

1. Authorize CodeBuild to access the repository in the AWS account. For a private GitHub repository, complete the CodeBuild GitHub authorization before applying this root.
2. Copy the example variables, set the HTTPS repository URL, and set `publisher_source_directory` when this project is a subdirectory of that repository:

   ```sh
   cd infrastructure/publisher
   cp terraform.tfvars.example terraform.tfvars
   AWS_PROFILE=yuta terraform init
   AWS_PROFILE=yuta terraform fmt -check
   AWS_PROFILE=yuta terraform validate
   AWS_PROFILE=yuta terraform apply -var-file=terraform.tfvars
   ```

3. Record `artifact_bucket_name` and `publisher_project_name` from `terraform output`.

## Publish a release

Start the CodeBuild project against an explicit immutable Git commit, tag, or reviewed branch. CodeBuild downloads the model selected by `configs/config.json`, verifies its byte count and SHA-256, packages `openjev-runtime.zip`, and publishes it under a digest-addressed key:

```sh
aws codebuild start-build \
  --project-name "$(AWS_PROFILE=yuta terraform output -raw publisher_project_name)" \
  --source-version "<commit-or-tag>" \
  --profile yuta \
  --region ap-northeast-1
```

The build logs print `PUBLISHED_ARTIFACT_BUCKET`, `PUBLISHED_ARTIFACT_KEY`, `PUBLISHED_ARTIFACT_VERSION_ID`, and `PUBLISHED_ARTIFACT_SHA256`. The artifact and adjacent `.manifest.json` are create-only; a content digest is part of their key. Pass the bucket and key to `../terraform/terraform.tfvars` for the application deployment.

The publisher role can write only under `microvm/published/` and has no permission for Lambda, CloudFormation, DynamoDB, or IAM operations beyond its own execution role.
