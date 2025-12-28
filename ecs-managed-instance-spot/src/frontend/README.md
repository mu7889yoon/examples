# vLLM Spot Inference Frontend

stliteを使用したStreamlitベースのフロントエンドアプリケーション。

## 概要

このフロントエンドは以下の機能を提供します：

- ランダムなプロンプトの自動送信
- vLLM APIからの応答表示
- 履歴の表示
- 開始/停止コントロール

## ファイル構成

```
src/frontend/
├── app.py          # メインアプリケーション
├── index.html      # stlite用HTMLエントリーポイント
├── config.js       # 環境設定
└── README.md       # このファイル
```

## ローカル開発

### 方法1: Streamlitで直接実行

```bash
cd src/frontend
pip install streamlit requests
streamlit run app.py
```

### 方法2: stliteでローカルサーバー

```bash
cd src/frontend
python -m http.server 8080
# ブラウザで http://localhost:8080 を開く
```

## S3デプロイ

### 1. ファイルの準備

以下のファイルをS3バケットにアップロードします：

- `index.html`
- `app.py`
- `config.js`

### 2. 環境設定

`config.js`を編集してAPIエンドポイントを設定：

```javascript
window.API_ENDPOINT = "https://your-alb-dns-name.region.elb.amazonaws.com";
```

または、`index.html`内のsecretsを直接編集：

```javascript
".streamlit/secrets.toml": `
api_endpoint = "https://your-alb-dns-name.region.elb.amazonaws.com"
`
```

### 3. S3バケット設定

- 静的ウェブサイトホスティングを有効化
- インデックスドキュメント: `index.html`
- CloudFront経由でのアクセスを推奨

### 4. CloudFront設定

- オリジン: S3バケット
- Origin Access Control (OAC)を使用
- HTTPS強制
- キャッシュポリシー: CachingOptimized

## 設定項目

| 項目 | デフォルト値 | 説明 |
|------|-------------|------|
| API_ENDPOINT | http://localhost:8000 | vLLM APIのエンドポイント |
| DELAY_SECONDS | 2 | 応答後の待機時間（秒） |
| MAX_TOKENS | 512 | 最大トークン数 |

## プロンプト一覧

アプリケーションには以下のプロンプトが事前定義されています：

1. 日本の首都はどこですか？
2. プログラミングを学ぶコツを教えてください
3. 健康的な朝食のレシピを提案してください
4. AIの未来について簡潔に説明してください
5. 効率的な時間管理の方法を3つ挙げてください
6. 環境問題について一言で説明してください
7. おすすめの本を1冊紹介してください
8. ストレス解消法を教えてください
9. 新しい趣味を始めるならおすすめは？
10. 今日の天気に合う服装を提案してください

## トラブルシューティング

### CORSエラー

ALBまたはvLLMサーバーでCORSを設定してください。

### 接続エラー

1. APIエンドポイントが正しいか確認
2. ALBのセキュリティグループを確認
3. ネットワーク接続を確認

### stliteの読み込みエラー

1. CDNへのアクセスを確認
2. ブラウザのコンソールでエラーを確認
