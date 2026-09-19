# Inference Runtime

Lambda MicroVM向けの一時的な大喜利判定Runtimeです。OpenJev (SemIf) の
`direct-options-v1` promptと選択肢logit readoutを利用します。実行器は
OpenJev browser demoと同じ llama.cpp 系で、ARM64 CPU native `llama-server` が
`笑う` / `笑わない` に対応する A/B の選択肢logprobから条件付き確率を取得します。

## 設定

`configs/config.json` の `model` は、モデルを差し替えるための唯一の入口です。
`source` と `revision` はHugging Faceの40文字commitを指定します。初期値は
Qwen3.5-4B の Q4_K_M GGUF です。`expectedBytes` と `sha256` は、そのcommitの
GGUF LFS objectの固定値です。`optionTokenIds` はそのGGUF tokenizerにおける A/B のtoken
IDで、Image build時に `/detokenize` で検証します。モデルを変える場合はGGUF名、
固定revision、サイズ、SHA-256、A/B token IDを一緒に更新してください。

モデル重みはgitへ置きません。事前ダウンロードした固定GGUFを `models/` に置き、
サイズとSHA-256を検証してMicroVM artifact ZIPへ同梱します。Docker buildは外部
ネットワークからモデルを取得せず、`COPY models/ /opt/models/` 後に同じ検証を行い
ます。通常は `LLAMA_MODEL_PATH` を設定せず、同梱済みモデルだけを使用します。
Runtimeはloopbackの `llama-server` だけに接続します。

## モデル取得・Artifact作成

リポジトリルートで実行します。モデルは約3.01 GiBあり、`models/` と生成ZIPは
`.gitignore` 済みです。

```sh
# 固定revisionから取得し、expectedBytesとsha256を検証する
python3 apps/inference/scripts/download_model.py \
  --config configs/config.json --output-dir models

# Docker build中にモデル取得は行わない。COPY後に再検証する。
docker build --platform linux/arm64 -f apps/inference/Dockerfile \
  -t ai-ippon-inference .

# AWS MicroVM Image builderに渡す、root Dockerfile入りのZIPを作成する
apps/inference/scripts/package_artifact.sh artifacts/openjev-runtime.zip
```

`package_artifact.sh` は、存在するモデルを改めて検証してから、runtime source、
configs、モデル、`artifact-manifest.json` を1つのZIPにまとめます。途中で失敗した
ダウンロードは `.part` のまま削除され、Artifactは作成されません。

## HTTP

- `GET /health` はプロセス状態を返します。
- `POST /judge` は `{ "topic": "...", "answer": "..." }` を受け取り、SSEを返します。
- `/aws/lambda-microvms/runtime/v1/{ready,validate,run,suspend,resume,terminate}` は
  Lambda MicroVM lifecycle hookです。

`/run` でモデルをロードしてから成功を返します。一つのRuntimeは一件の判定だけを
同時に実行し、競合時は `409 BUSY` を返します。

## ローカルのモデルなしテスト

```sh
cd apps/inference
PYTHONPATH=src python -m unittest discover -s tests -v
```

テストはfake scorerを注入するため、GPU、Transformers、モデル重みを必要としません。
