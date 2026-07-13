# learn-about-mtls

CloudFront + S3 で viewer mTLS を試す CDK サンプルです。

`npm run deploy` でローカルに検証用 CA / クライアント証明書を生成し、CA bundle を S3 にアップロードして CloudFront Trust Store に登録します。
クライアント秘密鍵は `.mtls-client/` 配下にだけ作成し、AWS や Git には置きません。

## Deploy

前提:

- AWS CLI の `yuta` profile で対象アカウントにアクセスできること
- 対象リージョンで CDK bootstrap 済みであること
- Node.js / npm / OpenSSL が使えること

```bash
git clone git@github-mu7889yoon:mu7889yoon/examples.git
cd examples/learn-about-mtls
npm ci
npm run deploy
```

`npm run deploy` は内部で以下を実行します。

```bash
npm run certs
cdk deploy --profile yuta --require-approval never
```

`npx cdk synth --profile yuta` が通れば TypeScript の確認として十分なので、別途 `npm run build` は不要です。

## Verify

デプロイが完了すると、CloudFormation Outputs に CloudFront の URL と確認用 curl が表示されます。

```text
CloudFrontDomainName = xxxxxxxxxxxxxx.cloudfront.net
CurlWithClientCertificate = curl -vk --cert .mtls-client/client.crt --key .mtls-client/client.key https://xxxxxxxxxxxxxx.cloudfront.net/
CurlWithoutClientCertificate = curl -vk https://xxxxxxxxxxxxxx.cloudfront.net/
```

クライアント証明書なしでは失敗します。

```bash
curl -vk https://<CloudFrontDomainName>/
```

クライアント証明書ありでは成功します。

```bash
curl -vk \
  --cert .mtls-client/client.crt \
  --key .mtls-client/client.key \
  https://<CloudFrontDomainName>/
```

以下が返れば OK です。

```text
You are able to access it.
```

## Destroy

```bash
npm run destroy
```
