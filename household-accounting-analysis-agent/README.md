# Household Accounting Analysis Agent

家計簿データを分析するAIエージェントシステム

## システム構成図

### アプリケーション構成

```mermaid
flowchart TB
    subgraph Client["クライアント"]
        Browser["ブラウザ"]
    end

    subgraph AWS["AWS Cloud"]
        subgraph Frontend["frontend"]
            CloudFront["CloudFront<br/>(HTTPS)"]
            FrontendBucket["S3<br/>(Frontend Bucket)"]
        end

        subgraph Backend["backend"]
            APIGW["API Gateway"]
            Lambda["Lambda"]
            AgentCore["AgentCore <br>Runtime"]
        end

        subgraph AI["Bedrock"]
            Bedrock["Amazon Bedrock"]
        end

        subgraph Data
            DataBucket["S3<br/>(Data Bucket)"]
            Parquet["Parquet Files<br/>(transactions/)"]
        end
    end

    Browser -->|"HTTPS"| CloudFront
    CloudFront -->|"/*"| FrontendBucket
    CloudFront -->|"/invocations"| APIGW
    APIGW --> Lambda
    Lambda -->|"InvokeAgentRuntime"| AgentCore
    AgentCore -->|"InvokeModel"| Bedrock
    AgentCore -->|"DuckDB Query"| DataBucket
    DataBucket --- Parquet
```

### CSV → Parquet 変換フロー

```mermaid
flowchart TB
    subgraph Local["ローカル環境"]
        CSV["CSVファイル<br/>(data/YYYYMM.csv)"]
    end

    subgraph AWS["AWS Cloud"]
        subgraph S3["Amazon S3"]
            SourceBucket["Source Bucket"]
            ScriptsBucket["Scripts Bucket"]
            DataBucket["Data Bucket"]
        end

        subgraph Glue["AWS Glue"]
            GlueJob["Glue ETL Job"]
        end
    end

    subgraph CDK["CDK Deploy"]
        Deploy["cdk deploy"]
    end

    CSV -->|"BucketDeployment"| Deploy
    Deploy -->|"アップロード"| SourceBucket
    Deploy -->|"スクリプトアップロード"| ScriptsBucket

    SourceBucket -->|"1. CSV読み込み"| GlueJob
    ScriptsBucket -->|"ETLスクリプト参照"| GlueJob
    GlueJob -->|"2. Parquet書き出し<br/>(year/month パーティション)"| DataBucket
```

### ETL処理詳細

```mermaid
flowchart LR
    subgraph Input["入力"]
        CSV["CSV"]
    end

    subgraph Transform["変換処理 (Spark)"]
        Parse["CSVパース"]
        Clean["データクレンジング"]
        Schema["スキーマ変換"]
    end

    subgraph Output["出力"]
        Parquet["Parquet<br/>/transactions/<br/>year=YYYY/month=MM/"]
    end

    CSV --> Parse --> Clean --> Schema --> Parquet
```

### データスキーマ

| 入力 (CSV) | 出力 (Parquet) | 型 |
|-----------|---------------|-----|
| 日付 (MM/DD(曜日)) | date | DATE |
| 内容 | description | STRING |
| 金額（円） | amount | INT |
| 保有金融機関 | financial_institution | STRING |
| 大項目 | major_category | STRING |
| 中項目 | minor_category | STRING |
| メモ | memo | STRING |
| - | year | INT (パーティション) |
| - | month | INT (パーティション) |

## Glue Job 実行方法

```bash
# 単一ファイルの処理
aws glue start-job-run \
  --job-name household-accounting-csv-to-parquet \
  --arguments '{"--SOURCE_KEY":"202501.csv"}'
```
