# AI大喜利システム

複数のAI JudgeがOpenJev（SemIf）またはOpenRouter上のTypeSafe Jevを使い、大喜利の回答を評価するPoCです。

- `apps/frontend`: S3 + CloudFrontで配信するWeb UI
- `apps/backend`: Session Controller と SSE Streaming Proxy
- `apps/inference`: OpenJevを実行するLambda MicroVM runtime
- `infrastructure/publisher`: モデルを検証・パッケージして private S3 へ発行する CodeBuild 基盤
- `infrastructure/terraform`: 発行済み artifact を参照するアプリケーション基盤。実行中のMicroVMはTerraform state外

OpenJevは `b9cb32537e78be65f19abfcb1de8fc504b627d84` に固定して利用します。モデル重みはリポジトリに保存しません。Qwen3-0.6B の GGUF は固定revision・サイズ・SHA-256を CodeBuild 上で検証し、MicroVM用の artifact ZIP に同梱して private S3 へ内容ハッシュ付きのキーで発行します。

AWS操作は必ず `--profile yuta --region ap-northeast-1` を指定します。Terraform に `--profile` オプションはないため、Terraform 実行時は `AWS_PROFILE=yuta` を使います。

## OpenRouter経路への切替

既定値は既存MicroVMのままです。Secrets ManagerへOpenRouter APIキーを登録した後、`infrastructure/terraform/terraform.tfvars` の `judging_provider` を `openrouter` に変更して apply すると、同じAPI/SSE契約のまま `typesafe/jev-1.13` を利用できます。キーはTerraform変数やリポジトリへ保存しません。切替中もMicroVM資産は残るため、問題発生時は `microvm` に戻せます。

## 初回デプロイ

1. `infrastructure/publisher` を先に apply し、artifact bucket と CodeBuild publisher を作成します。private GitHub repository を使う場合は、先に AWS アカウントで CodeBuild の GitHub 接続を認可してください。
2. CodeBuild を明示的なコミットまたは tag で開始します。CodeBuild はモデルをダウンロード・検証し、`microvm/published/<model-revision>/<zip-sha256>/openjev-runtime.zip` へ create-only で発行します。
3. build log に出る `PUBLISHED_ARTIFACT_BUCKET` と `PUBLISHED_ARTIFACT_KEY` を `infrastructure/terraform/terraform.tfvars` に設定します。
4. フロントエンドと backend Lambda ZIP をローカルで作成し、アプリケーション Terraform を apply します。

```sh
# 1. Publisher infrastructure
cd infrastructure/publisher
cp terraform.tfvars.example terraform.tfvars
# Set publisher_source_location to the repository HTTPS URL. If this project is
# a subdirectory in that repository, set publisher_source_directory as well.
AWS_PROFILE=yuta terraform init
AWS_PROFILE=yuta terraform apply -var-file=terraform.tfvars

# 2. Publish a verified MicroVM release for a reviewed commit or tag.
aws codebuild start-build \
  --project-name "$(AWS_PROFILE=yuta terraform output -raw publisher_project_name)" \
  --source-version "<commit-or-tag>" \
  --profile yuta \
  --region ap-northeast-1

# 3. Local assets still managed by application Terraform
cd ../..
(cd apps/frontend && npm ci && npm run build)
(cd apps/backend && npm ci && npm run package)

# 4. Application infrastructure, configured with the published bucket/key
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars
AWS_PROFILE=yuta terraform init
AWS_PROFILE=yuta terraform apply -var-file=terraform.tfvars
```

The application deployment uploads Vite `dist/` and the two Lambda ZIPs. It does not download, package, or upload a model; it only references the published immutable MicroVM ZIP. After apply, open `cloudfront_domain_name` to reach the API through the static UI.
