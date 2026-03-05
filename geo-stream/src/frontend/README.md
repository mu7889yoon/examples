# Frontend Viewer

MapLibre + AppSync で現在位置を地図表示します。

## セットアップ

1. `config.template.js` を `config.js` にコピー済みなので、値をCDK出力で更新
2. ローカルサーバ起動

```bash
cd /Users/ny/Documents/examples/geo-stream/src/frontend
python3 -m http.server 8080
```

3. ブラウザで `http://localhost:8080/` を開く
4. `Login` で Cognito Hosted UI に遷移し、認証後に地図へ戻る

## 表示挙動

- 初回: `listCurrentLocations` を取得
- 通常: AppSync Subscription で更新反映
- 失敗時: 5秒ポーリングへ自動フォールバック
