# Strands Decider 2B on Lambda

Strands Decider 2B を arm64 の AWS Lambda（10,240 MB）で動かす Terraform サンプルです。入力したテキストについて質問し、判定結果を JSON で受け取れます。

[qwen3.5b-on-lambda](../qwen3.5b-on-lambda) を参考に、CodeBuild と IAM 認証付き Function URL を使います。公式 Lambda 実装の Dockerfile で Qwen3.5 2B の重みと LoRA を結合し、Q8_0 の GGUF と判定ヘッドをコンテナに格納します。推論には llama.cpp と `HiddenStateEngine` を使います。[公式の Lambda デプロイガイド](https://strandsagents.com/docs/labs/strands-decider/deployment/lambda/)

比較のベースラインには公式 Dockerfile とハンドラをそのまま使います。公式の CPU 構成の既定値に合わせて、arm64、10,240 MB、タイムアウト 900 秒、テキスト専用の Q8_0、SnapStart 無効、1 リクエストあたり最大 24,576 トークンで計測します。ビルドでは公式コードと Hugging Face のモデルリビジョンを固定します。オンデマンド起動時に、公式ハンドラが並列でファイルを先読みし、バックグラウンドでモデルをロードしてウォームアップします。

## デプロイ

Terraform 1.6 以降、AWS CLI v2、Bash、AWS のデプロイ権限が必要です。リージョンの既定値は東京（`ap-northeast-1`）です。変更するときは最初の apply の前に `TF_VAR_aws_region` を設定してください。

```bash
cd strands-decider-2b-on-lambda/iac/terraform
# 名前付きプロファイルを使う場合は AWS_PROFILE を設定
terraform init
terraform apply
bash build-image.sh
terraform apply
```

最初の `apply` で ECR と CodeBuild を作ります。`build-image.sh` が ARM ビルドを開始し、CodeBuild 内でコンテナを 10 GiB のメモリ制限下で実行して、判定が1件返ることを確認します。成功すると ECR にイメージを登録し、スクリプトがそのダイジェストを `image.auto.tfvars` に保存します。2回目の `apply` で、そのイメージを使う Lambda と Function URL を作ります。以降の `apply` 用に `image.auto.tfvars` を手元に残してください。再ビルドする場合は `bash build-image.sh` と `terraform apply` を実行します。

## コールドスタートとイメージサイズを記録する

新規デプロイ直後の**最初の呼び出し**を計測します。下の疎通確認より先に `iac/terraform` で実行してください。Python 3 と `lambda:GetFunction`、`lambda:InvokeFunction`、`ecr:DescribeImages` の権限が必要です。

```bash
python3 measure.py "$(terraform output -raw aws_region)" \
  "$(terraform output -raw function_name)"
```

実行するたびに `measurements.jsonl` に1行追加します。日時（UTC）、リージョン、アーキテクチャ、メモリ、モデル、イメージダイジェスト、Lambda のリクエスト ID と `REPORT` 行も一緒に残します。

| 記録項目 | 測っているもの |
| --- | --- |
| `ecr_image_size_bytes` | デプロイ済みダイジェストの ECR 上での圧縮サイズ（バイト） |
| `invoke_wall_ms` | 呼び出し側で AWS CLI の実行開始から推論結果を受け取るまでの実時間（ミリ秒）。通信と CLI の起動を含む |
| `lambda_init_ms` | Lambda の `REPORT` に出る `Init Duration`（ミリ秒） |
| `model_ready_seconds` | 公式ハンドラがモデルの先読み・ロード・ウォームアップを終えるまでの時間（秒）。ログ末尾に該当行があれば記録 |

`Init Duration` が取得できたサンプルは `cold_start_confirmed: true` になります。ブログで最適化前後のコールドスタートを比べるときは、その行の `invoke_wall_ms` を使います。公式ハンドラはバックグラウンドでモデルをロードし、推論前に完了を待ちます。`lambda_init_ms` と `model_ready_seconds` の計測区間は重なることがあります。[Lambda の REPORT 項目](https://docs.aws.amazon.com/lambda/latest/dg/python-logging.html) · [ECR のサイズ項目](https://docs.aws.amazon.com/cli/latest/reference/ecr/describe-images.html)

## 判定を1件試す

```bash
region=$(terraform output -raw aws_region)
function_name=$(terraform output -raw function_name)

aws lambda invoke \
  --region "$region" \
  --function-name "$function_name" \
  --cli-read-timeout 910 \
  --payload fileb://../../request.json \
  response.json

cat response.json
```

成功すると `answers.is_urgent.noul` に 0〜1 の値が入ります。呼び出す IAM ユーザーまたはロールには `lambda:InvokeFunction` が必要です。`aws lambda invoke` の結果に `FunctionError` がある場合は、`response.json` と CloudWatch Logs の `/aws/lambda/strands-decider-2b-on-lambda` を確認してください。CloudWatch Logs の `REPORT` 行で実際の `Max Memory Used` を確認できます。

HTTP からは IAM 認証付きの `POST /v1/systemone` を呼べます。同一アカウントの呼び出し元には対象の関数への `lambda:InvokeFunctionUrl` と `lambda:InvokeFunction` が必要です。[Function URL の認証と権限](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)

```bash
# awscurl をインストールしてから実行
awscurl --service lambda --region "$region" -X POST \
  -H 'content-type: application/json' \
  -d "$(cat ../../request.json)" \
  "$(terraform output -raw function_url)v1/systemone"
```

## 削除

`terraform destroy` で Lambda、CodeBuild、ロググループ、ECR リポジトリとそのイメージを削除します。
