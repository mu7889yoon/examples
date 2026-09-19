# Controller / Streaming Proxy

`src/controller.ts` exports two Lambda entrypoints:

- `handler`: API Gateway REST API (Lambda proxy/v1) handler. It buffers SSE for runtimes that do not enable Lambda response streaming.
- `streamingHandler`: response-streaming handler when the Lambda runtime exposes `awslambda.streamifyResponse`. Configure API Gateway/Lambda response streaming and use this entrypoint to relay chunks as they arrive.

The public API never returns the MicroVM endpoint or `X-aws-proxy-auth` token. The proxy obtains a short-lived token for each judge request, adds it to the upstream request, and forwards only the MicroVM's SSE body.

## Environment

MicroVM経路では `SESSION_TABLE_NAME`, `MICROVM_IMAGE_IDENTIFIER`, `MICROVM_IMAGE_VERSION`, `MICROVM_RUNTIME_ROLE_ARN`, `MICROVM_PORT` (default `8080`), `SESSION_DURATION_SECONDS` (default `3600`), `MICROVM_TOKEN_EXPIRATION_MINUTES` (default `60`), and `MODEL_NAME` (default `Qwen3-0.6B`) を使います。

`JUDGING_PROVIDER` は `microvm`（既定）または `openrouter` を選べます。OpenRouter経路では `OPENROUTER_MODEL`（既定 `typesafe/jev-1.13`）と `OPENROUTER_API_KEY_SECRET_ARN` をStreaming Proxyへ渡します。APIキーはSecrets Managerから実行時に読み込み、Lambda環境変数へ平文で置きません。`JUDGE_REVEAL_MIN_DELAY_MS` / `JUDGE_REVEAL_MAX_DELAY_MS`（既定200〜3000ms）で判定結果の表示間隔を調整できます。

The AWS adapter uses `@aws-sdk/client-lambda-microvms` (`RunMicrovm`, `GetMicrovm`, `TerminateMicrovm`, `CreateMicrovmAuthToken`) and the repository uses DynamoDB conditional expressions for the session creation and judge lock.

```sh
npm install
npm run build
npm test
```

## Terraform向け成果物

Terraform apply の前に、リポジトリルートの `artifacts/` へ2つのLambda ZIPを生成します。
`package` は本番依存だけをZIPに含めるため、Lambdaの展開サイズを不要に増やしません。

```sh
cd apps/backend
npm ci
npm run package
```

生成先は次のとおりです。`infrastructure/terraform` の既定値と一致しています。

* `../../artifacts/controller.zip`
* `../../artifacts/streaming-proxy.zip`
