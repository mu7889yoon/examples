# EC2 Nested Virtualization (AL2023 + KVM + GNU Hurd)

このスタックは、`us-east-1` の `c8i.large` で nested virtualization を有効化し、AL2023 上で GNU Hurd を試せる状態まで自動セットアップします。

## このスタックで構築されるもの

- `c8i.large` の EC2 インスタンス (AL2023)
- インスタンス起動 API で `CpuOptions.NestedVirtualization=enabled`
- `qemu-kvm` / `libvirt` の導入
- GNU Hurd ISO のダウンロードと qcow2 ディスク作成 (`/opt/gnu-hurd/`)
- Session Manager 前提の運用 (Security Group の inbound は開けない)

## デプロイ

```bash
npm install
npm run build
npx cdk deploy
```

## 初回起動後の状態

UserData で以下が実行されます。

- `/usr/local/bin/check-kvm.sh` を配置
- `/usr/local/bin/prepare-gnu-hurd.sh` を配置して実行
- `/usr/local/bin/run-gnu-hurd.sh` を配置

そのため、Session Manager で入った時点で GNU Hurd の ISO とディスクが準備済みの想定です。

## マネコンから Session Manager で確認

1. EC2 コンソールから対象インスタンスを選択  
2. `接続` -> `Session Manager` -> `接続`

接続後:

```bash
sudo /usr/local/bin/check-kvm.sh
ls -lh /opt/gnu-hurd
```

## GNU Hurd インストーラ起動

```bash
sudo /usr/local/bin/run-gnu-hurd.sh
```

ISO URL を固定したい場合:

```bash
sudo /usr/local/bin/run-gnu-hurd.sh <GNU_HURD_ISO_URL>
```

## VNC が必要な場合 (SG を開けない)

`run-gnu-hurd.sh` は `127.0.0.1:5901` で VNC を待ち受けます。  
SG の穴あけは不要で、SSM ポートフォワードでローカルへ転送できます。

```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["5901"],"localPortNumber":["5901"]}'
```

その後、ローカルの VNC クライアントで `localhost:5901` に接続します。

## 補足

- Debian 側の配布レイアウト変更時は ISO の自動解決に失敗する場合があります。
- その場合は `run-gnu-hurd.sh <ISO_URL>` または `prepare-gnu-hurd.sh <ISO_URL>` を使ってください。
