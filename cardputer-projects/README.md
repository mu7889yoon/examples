# Cardputer Projects

M5Stack Cardputer を使った実験・サンプル用のプロジェクトです。

このリポジトリでは、特に記載がない限り M5Stack Cardputer（SKU `K132`、M5StampS3 搭載）を対象にします。`Cardputer v1.1` や `Cardputer-Adv` は GPIO や搭載部品が異なるため、別機種として扱います。

## まず読む資料

- [Cardputer-Adv のアイデア](IDEA.md) — 次に作りたい機能のメモ
- [Cardputer 開発ノート](docs/cardputer.md) — 仕様、ピンマップ、開発環境、書き込み手順、公式資料
- [Cardputer CLI スキル](skills/cardputer-cli-debug/SKILL.md) — CLI 書き込み、シリアル監視、デバッグ手順
- [AGENTS.md](AGENTS.md) — このリポジトリで作業する際のルール
- [M5Stack 公式 Cardputer ドキュメント](https://docs.m5stack.com/en/core/Cardputer)

## ディレクトリ構成

- [`docs/`](docs/cardputer.md) — ハードウェア仕様と開発ノート
- [`examples/micropython/hello-world/`](examples/micropython/hello-world/README.md) — UIFlow2 MicroPython の画面表示サンプル
- [`examples/micropython/left-hand-device/`](examples/micropython/left-hand-device/README.md) — 実機から回収した BLE 左手デバイス
- [`examples/arduino/left_hand_device/`](examples/arduino/left_hand_device/README.md) — Arduino 版の BLE 左手デバイスとモード切り替え
- [`skills/cardputer-cli-debug/`](skills/cardputer-cli-debug/SKILL.md) — CLI 操作とデバッグの手順・補助スクリプト

## Arduino で最初のプログラムを書き込む

1. Arduino IDE と M5Stack の Board Manager をインストールする。
2. ボードとして `M5Cardputer` を選択する。
3. Library Manager から `M5Cardputer` をインストールする。
4. Cardputer の電源スイッチを `OFF` にする。
5. 側面の `G0` を押したまま、USB-C データケーブルを接続する。
6. ポートを選び、`M5Cardputer` の `Basic -> display` を書き込む。

公式手順の詳細は [Cardputer Arduino Quick Start](https://docs.m5stack.com/en/arduino/m5cardputer/program) を参照してください。充電時は電源スイッチを `ON` にします。

CLI で書き込む場合は、プロジェクトの種類に応じて PlatformIO の `pio run -t upload`、ESP-IDF の `idf.py flash`、既成バイナリの `esptool` を使い分けます。詳細は [Cardputer 開発ノート](docs/cardputer.md) と [Cardputer CLI スキル](skills/cardputer-cli-debug/SKILL.md) を参照してください。

## PlatformIO

公式ドキュメントに掲載されている最小構成は次のとおりです。

```ini
[env:m5stack-cardputer]
platform = espressif32@6.7.0
board = esp32-s3-devkitc-1
framework = arduino
upload_speed = 1500000
build_flags =
  -DESP32S3
  -DCORE_DEBUG_LEVEL=5
  -DARDUINO_USB_CDC_ON_BOOT=1
  -DARDUINO_USB_MODE=1
lib_deps =
  M5Cardputer=https://github.com/m5stack/M5Cardputer
```

## リポジトリの状態

Arduino 版の [BLE 左手デバイス](examples/arduino/left_hand_device/README.md) を追加しました。実機から回収した [MicroPython 版](examples/micropython/left-hand-device/README.md) も保管しています。実機での書き込み・動作確認結果は、確認した機種とファームウェアの組み合わせを添えて追記してください。

## ライセンス

このリポジトリ固有のライセンスは未定義です。外部ライブラリやサンプルを取り込む場合は、元リポジトリのライセンスと著作権表示を確認してください。
