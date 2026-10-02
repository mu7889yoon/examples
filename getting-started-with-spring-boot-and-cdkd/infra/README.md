# AWSインフラ

AWS CDK v2のTypeScriptコードを、学習用途のデプロイツール`cdkd`で実行します。Spring Bootは`ApplicationLoadBalancedFargateService`で公開し、Aurora PostgreSQL Serverless v2へ接続します。

## 現在のAWS環境

この環境では、先のデプロイで作成したAuroraとVPCを保持して再利用しています。`infra/.env.local`はこのAWSアカウント専用の設定で、Gitには登録されません。別環境で使う場合は`infra/.env.example`を`.env.local`へコピーし、既存Aurora/VPCのIDとSecrets Manager ARNを設定してください。

- 東京リージョン (`ap-northeast-1`)
- Internet-facing ALB (HTTP 80) → ECS Fargate (0.25 vCPU / 512 MiB / 1タスク、ARM64)
- 既存 Aurora PostgreSQL Serverless v2 (16.8、0〜1 ACU)
- 既存VPCのpublic subnetを再利用し、AuroraのSecurity GroupへFargateからの5432番だけを許可
- DB接続情報は既存Secrets Manager secretからECSへ渡す

ALBは認証なしのHTTPでインターネットへ公開されます。ALBとFargateはAuroraの自動停止中も稼働し、課金が続きます。

## デプロイ

Node.js 24以上と、対象AWSアカウントでcdkdが必要とする権限を持つ`yuta`プロファイルのAWS認証情報を用意し、`infra/`で実行します。初回は`.env.example`を`.env.local`にコピーして、実際のリソースIDを設定します。

```bash
npm ci
npm run build
npm test
npm run synth
npm run bootstrap      # アカウントごとに最初の1回だけ
npm run deploy:dry-run
npm run deploy
```

`npm run deploy`は`TodoAppStack`をデプロイし、ECSサービスが安定稼働するまで待ちます。削除時もAuroraはこのスタックが管理していないため残ります。

Auroraを含む新規環境向けの構成は`TodoStack`として残してあります。別アカウントに一式作る場合は、環境変数をクリアして`npm run synth:fresh`または`npm run deploy:fresh`を使います。現在の環境で実行すると、別のAuroraを作成するので注意してください。

## 削除とデータ

```bash
npm run destroy
```

現在の`TodoAppStack`を削除すると、ALB・ECSなどアプリ側のリソースが削除されます。再利用中のAurora/VPCとTodoデータは残ります。Auroraを削除する場合は、別途バックアップと削除対象を確認してから行ってください。
