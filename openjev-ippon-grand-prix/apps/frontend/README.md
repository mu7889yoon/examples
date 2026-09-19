# OpenJev Ippon Grand Prix — Frontend

Vite + React + TypeScript の静的フロントエンドです。会場開始後にセッションの起動状態をポーリングし、審査 API の `fetch()` ストリーミングレスポンスから SSE イベントを逐次表示します。

## 起動

```sh
npm install
npm run dev
```

API の接続先は `VITE_API_BASE_URL` で変更できます。未指定の場合は同一オリジンの相対パスを使用します。

```sh
VITE_API_BASE_URL=https://api.example.com npm run dev
```

Terraform配信では `openjev-runtime-config.js` を同じS3 originに生成し、API GatewayのURLを実行時に設定します。そのため、本番用の `dist/` はURLを埋め込まずにビルドできます。

## 想定 API

* `POST /sessions` → `{ sessionId, status, judgeCount, requiredLaughCount, startedAt, expiresAt }`
* `GET /sessions/:sessionId` → セッション状態（`RUNNING` になるまで1.5秒間隔でポーリング）
* `DELETE /sessions/:sessionId` → 会場終了
* `POST /sessions/:sessionId/judge` → `{ topic, answer }` を送信し `text/event-stream` を返す

SSEイベントは仕様書どおり `start`、`judge`、`ippon`、`complete` を処理します。`start`イベントの `judgeCount` で表示上限を更新できるため、Judge数をフロントエンドに固定していません。

## 確認

```sh
npm run test
npm run build
```

`infrastructure/terraform` は既定でこの `dist/` をS3へアップロードします。Terraform applyの前に必ず実行してください。
