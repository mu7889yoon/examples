# AI大喜利 API・イベント契約

この文書は、Frontend、Controller / Proxy、MicroVMまたはOpenRouterのJudge Provider間で共有する契約です。

## Public API

| Method | Path | Response |
| --- | --- | --- |
| `POST` | `/sessions` | `201` と Session |
| `GET` | `/sessions/{sessionId}` | Session |
| `DELETE` | `/sessions/{sessionId}` | `202` と Session |
| `POST` | `/sessions/{sessionId}/judge` | `text/event-stream` |

Session の状態は `STARTING`、`RUNNING`、`TERMINATING`、`ENDED`、`FAILED` とする。判定の受付は `RUNNING` かつ期限前だけとする。同一 Session の実行中判定には `409 BUSY` を返す。

`POST /sessions/{sessionId}/judge` の入力は次のJSONである。

```json
{"topic":"こんなAWSは嫌だ。どんなAWS？","answer":"AZが全部同じ建物"}
```

## Judge stream

イベントの順序は `start`、0個以上の `judge`、0または1個の `ippon`、`complete` とする。Judgeの完了順は保証しない。`ippon` の後も残りのJudgeを評価する。

```text
event: start
data: {"judgeCount":20,"requiredLaughCount":10,"ipponThresholdRatio":0.5}

event: judge
data: {"id":"judge-001","probability":0.81,"laughed":true,"completedCount":1,"laughCount":1,"judgeCount":20}

event: ippon
data: {"laughCount":10,"requiredLaughCount":10,"judgeCount":20}

event: complete
data: {"laughCount":14,"judgeCount":20,"score":13.48,"ippon":true}
```

`score` は全Judgeの `P(笑う)` の合計とする。`requiredLaughCount` は `ceil(judgeCount * ipponThresholdRatio)` で算出する。

## Provider

`JUDGING_PROVIDER=microvm` の場合は、以下のMicroVM経路を使います。`JUDGING_PROVIDER=openrouter` の場合は、ProxyがOpenRouter Decisions APIへ20個のNoul質問を1リクエストで送り、同じSSEイベントへ変換します。どちらもブラウザへ認証情報やプロバイダーの内部情報を返しません。

## MicroVM Inference Runtime

Inference Runtime の公開先は MicroVM 専用HTTPS endpointだけとする。ブラウザへ endpoint URL と MicroVM auth token は返さない。Proxyが `CreateMicrovmAuthToken` で短命トークンを取得して中継する。

Runtimeは通常のアプリAPIとして `/health` と `/judge` を提供する。さらにLambda MicroVMsのライフサイクルhookを同一プロセスで受け付ける。

```text
POST /aws/lambda-microvms/runtime/v1/ready
POST /aws/lambda-microvms/runtime/v1/validate
POST /aws/lambda-microvms/runtime/v1/run
POST /aws/lambda-microvms/runtime/v1/suspend
POST /aws/lambda-microvms/runtime/v1/resume
POST /aws/lambda-microvms/runtime/v1/terminate
```

`/run` は会場固有の初期化を終えてから `200` を返す。`/terminate` は受付中の処理を安全に終了する。
