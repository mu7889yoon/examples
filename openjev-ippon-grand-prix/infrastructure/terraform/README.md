# Application Terraform infrastructure

This Terraform root owns the persistent application infrastructure for the POC. It intentionally does **not** own running Lambda MicroVM instances: Controller creates them with `RunMicrovm`, records their IDs in DynamoDB, and terminates them on session end or after the configured 3,600 seconds.

The MicroVM runtime artifact is not a local Terraform input. `../publisher` first creates a private, versioned artifact bucket and CodeBuild publisher. CodeBuild verifies the fixed model input, packages a complete runtime ZIP, and publishes it under a content-addressed key. This root consumes that already-published key.

## Managed resources

- private S3 bucket and CloudFront Origin Access Control for the static frontend
- REST API Gateway routes defined in [`../../docs/api-contract.md`](../../docs/api-contract.md)
- Controller and Streaming Proxy Lambda functions, their minimal execution roles, and CloudWatch log groups
- DynamoDB session table with TTL on `expiresAt`
- a build role and a runtime role for Lambda MicroVMs
- a CloudFormation nested stack containing `AWS::Lambda::MicrovmImage`

The nested CloudFormation stack is required because the AWS provider does not yet model `AWS::Lambda::MicrovmImage` directly. It receives an immutable S3 artifact URI; individual one-hour MicroVMs remain operational state outside Terraform.

## Prerequisites

1. Use an AWS CLI/Terraform AWS provider combination that supports Lambda MicroVMs in `ap-northeast-1`.
2. Complete the publisher workflow in [`../publisher/README.md`](../publisher/README.md). Record the `PUBLISHED_ARTIFACT_BUCKET` and `PUBLISHED_ARTIFACT_KEY` values printed by CodeBuild.
3. Build the frontend and package the two Lambda ZIP artifacts locally:

   ```sh
   (cd ../../apps/frontend && npm ci && npm run build)
   (cd ../../apps/backend && npm ci && npm run package)
   ```

   Terraform uploads the static frontend and these Lambda ZIPs. It does **not** read `models/` or a local `openjev-runtime.zip`.
4. Fetch the immutable managed base-image version before applying. This is deliberately not guessed or hard-coded.

## Apply

Terraform does not embed credentials or an AWS profile. The required POC profile is supplied only by the command invocation.

```sh
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
# Set artifact_bucket_name and microvm_artifact_key from the CodeBuild logs.
# Replace the base image version in terraform.tfvars.
AWS_PROFILE=yuta terraform init
AWS_PROFILE=yuta terraform fmt -check
AWS_PROFILE=yuta terraform validate
AWS_PROFILE=yuta terraform apply -var-file=terraform.tfvars
```

Terraform has no `--profile` option, so its equivalent is `AWS_PROFILE=yuta`. All AWS CLI commands for this project must include `--profile yuta`.

After `apply`, use `terraform output` for the API base URL, CloudFront hostname, immutable artifact key/version, image ARN, and runtime role ARN. A MicroVM artifact change is a separate release: publish a new content-addressed ZIP with CodeBuild, update `microvm_artifact_key`, then apply this root. Vite hashed assets are immutable; `index.html` and the runtime config are deliberately non-cached.

## Security boundary

The frontend never receives a MicroVM endpoint or its auth token. The Streaming Proxy role can only read/update the session record and mint `CreateMicrovmAuthToken` tokens for account-local MicroVMs. Controller can only launch the configured image and pass the dedicated runtime role. The MicroVM build role can read only the selected immutable artifact key. The runtime role is limited to its CloudWatch logs; grant it additional AWS access only when a runtime feature requires it.

The API intentionally has no user authentication because this is a POC. Do not reuse that setting for an internet-facing deployment.
