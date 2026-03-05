# Geo Stream CDK

SORACOM相当の位置情報（5秒間隔）を AWS で受信し、DynamoDB + AppSync でリアルタイム配信するインフラです。

## 作成される主なリソース

- AWS IoT Core Topic Rule (`geo/+`)
- Lambda
  - `IngestLocationFn` (IoTメッセージ保存)
  - `ApiHandlerFn` (AppSync Query/Mutation)
  - `StreamPublisherFn` (DynamoDB Stream -> AppSync Mutation)
- DynamoDB
  - `current_locations`
  - `recent_locations` (TTL: 30日)
- Kinesis Data Firehose -> S3 (長期履歴保存)
- AppSync GraphQL API (Cognito + IAM)
- Cognito User Pool / App Client / Hosted UI Domain
- CloudWatch Alarms (Lambda errors / DynamoDB throttle / Firehose delivery)

## デプロイ

```bash
cd /Users/ny/Documents/examples/geo-stream/iac/geo-stream-cdk
npm install
npm run build
npx cdk deploy
```

既定リージョンは `ap-northeast-1` です。別リージョンの場合は `CDK_DEFAULT_REGION` を指定してください。

## フロント設定値の取得

`cdk deploy` の出力を `src/frontend/config.js` に反映してください。

- `GraphqlApiUrl` -> `graphqlEndpoint`
- `UserPoolId` -> `userPoolId`
- `UserPoolClientId` -> `userPoolClientId`
- `UserPoolDomainUrl` -> `cognitoDomain`

## 送信トピック

- `geo/{deviceId}`

サンプル JSON:

```json
{
  "deviceId": "sim-001",
  "lat": 35.681236,
  "lng": 139.767125,
  "speed": 0,
  "heading": 0,
  "accuracy": 10,
  "capturedAt": "2026-02-17T08:00:00Z"
}
```
