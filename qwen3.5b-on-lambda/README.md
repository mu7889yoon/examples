# qwen3.5b-on-lambda

Lambda 上で `llama-cpp-python` + FastAPI を使い、Qwen3.5 系モデルをストリーミング応答するサンプルです。

## ディレクトリ構成

- `iac/qwen3.5-on-lambda-cdk`: CDK スタック（S3 / CodeBuild / Lambda / Function URL）
- `src/app`: Lambda アプリ本体（FastAPI + SSE）
- `src/client`: IAM SigV4 署名で Function URL を叩く CLI クライアント

## 前提

- AWS CLI v2
- デプロイ権限のあるプロファイル（例: `yuta`）
- Docker（Layer bundling で使用）
- Node.js / npm
- Python 3.13+（クライアント実行時）

## 使い方

### 1. インフラをデプロイ

```bash
cd iac/qwen3.5-on-lambda-cdk
npx cdk deploy
```

CloudFormation Output の `FunctionUrl` を控えてください。

モデルを指定できます。（Qwen3.5系なら動くと思いますが、9B 4ビット量子化あたりが限界な気がする）


#### Qwen 3.5 4B Q4_K_Mの場合

```bash
npx cdk deploy \
  --parameters ModelKey=Qwen3.5-4B-Q4_K_M.gguf \
  --parameters ModelUrl='https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf?download=true'
```

### 2. クライアントで会話

```bash
cd src/client
uv sync
export CHAT_API_BASE='https://<your-function-id>.lambda-url.<aws-region>.on.aws'
uv run main.py
```
