# Controller / Streaming Proxy

`src/controller.ts` exports two Lambda entrypoints:

- `handler`: API Gateway REST API (Lambda proxy/v1) handler. It buffers SSE for runtimes that do not enable Lambda response streaming.
- `streamingHandler`: response-streaming handler when the Lambda runtime exposes `awslambda.streamifyResponse`. Configure API Gateway/Lambda response streaming and use this entrypoint to relay chunks as they arrive.

The public API never returns the MicroVM endpoint or `X-aws-proxy-auth` token. The proxy obtains a short-lived token for each judge request, adds it to the upstream request, and forwards only the MicroVM's SSE body.

## Environment

`SESSION_TABLE_NAME`, `MICROVM_IMAGE_IDENTIFIER` (required), `MICROVM_IMAGE_VERSION`, `MICROVM_RUNTIME_ROLE_ARN`, `MICROVM_PORT` (default `8080`), `SESSION_DURATION_SECONDS` (default `3600`), `MICROVM_TOKEN_EXPIRATION_MINUTES` (default `60`), and `MODEL_NAME` (default `Qwen3-0.6B`).

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
