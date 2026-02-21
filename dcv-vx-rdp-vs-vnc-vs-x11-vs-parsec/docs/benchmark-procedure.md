# 画面転送レイテンシ比較手順（ap-northeast-1 / AL2023）

## 前提
- リージョンは `ap-northeast-1` 固定。
- Linuxホストは `Amazon Linux 2023` 固定。
- Windows/Linuxホストのインスタンスタイプは最小GPUの `g4dn.xlarge` 固定。
- 比較は群内比較を主結果として扱う。
  - Windows群: DCV / RDP / VNC / Parsec
  - Linux群: DCV / VNC / X11 Forwarding / waypipe
- 計測クライアントはローカル macOS。
- Parsec は個人アカウント前提のため、最終ログイン/ペアリングは手動。

## デプロイ
```bash
npm run build
npx cdk synth
npx cdk deploy -c allowedClientCidr=<YOUR_PUBLIC_IP>/32
```

`cdk synth` は `allowedClientCidr` 未指定でも実行可能です（デフォルト `203.0.113.10/32`）。
未指定時は、まず `MY_IP` 環境変数、次に `checkip.amazonaws.com` で自動検出を試みます。
実デプロイ時は必ず自分のグローバルIP `/32` を指定してください。

## 接続先確認
CloudFormation Outputs の値を利用する。
- `DcvEndpointWindows`
- `RdpEndpoint`
- `VncEndpointWindows`
- `DcvEndpointLinux`
- `VncEndpointLinux`
- `SshEndpointLinux`
- `WaypipeSshEndpointLinux`
- `WaypipeCommandHint`
- `ParsecHostNote`

## サーバ側の表示
ブートストラップで、各ホストに `SERVER_EPOCH_MS` を表示するオーバーレイが設定される。
- Windows: ログオン時タスク `LatencyOverlayAtLogon`
- Linux(AL2023): `latency-overlay.service`

## ローカル計測（手動）
1. 方式ごとに計測マニフェストを作る。
```bash
./scripts/local/run-manual-benchmark-macos.sh dcv-windows 10
./scripts/local/run-manual-benchmark-macos.sh rdp 10
./scripts/local/run-manual-benchmark-macos.sh vnc-windows 10
./scripts/local/run-manual-benchmark-macos.sh parsec 10
./scripts/local/run-manual-benchmark-macos.sh dcv-linux 10
./scripts/local/run-manual-benchmark-macos.sh vnc-linux 10
./scripts/local/run-manual-benchmark-macos.sh x11-forwarding 10
./scripts/local/run-manual-benchmark-macos.sh waypipe 10
```
2. 各試行でローカル録画を保存し、スクリプトに絶対パスを入力する。
3. 解析を実行する。
```bash
python3 ./scripts/local/analyze-latency.py \
  --manifest ./results/raw/<RUN_ID>/<PROTOCOL>/manifest.csv \
  --output-dir ./results/analysis/<RUN_ID>/<PROTOCOL> \
  --roi 140,320,1000,120
```

## 解析出力
- `latency-samples.csv`: フレーム単位の推定遅延
- `latency-summary.csv`: 試行単位の集計（count / median / p95 / stddev / min / max）

## 比較時の注意
- 群間（Windows群 vs Linux群）の絶対比較は参考値として扱う。
- 同じローカル端末、同じ録画設定（fps/解像度）で全試行を実施する。
- `allowedClientCidr` 以外は接続不可のため、IP変動時は再デプロイまたはSG更新が必要。
- `waypipe` のクライアントはLinux前提。macOSで実施する場合はローカルLinux VM/コンテナに `waypipe` を入れて接続する。
- `waypipe` の起動例: `waypipe ssh ec2-user@<LinuxHostPublicIp> /opt/run-waypipe-latency.sh`
