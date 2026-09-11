# M5Stack Cardputer 開発ノート

最終確認日: **2026-09-11**
対象: **M5Stack Cardputer / SKU K132（初代、M5StampS3 搭載）**

## 1. Cardputer とは

Cardputer は、ESP32-S3FN8 を搭載したカードサイズの開発用コンピューターです。56 キーのキーボード、240×135 px の TFT、Wi-Fi、Bluetooth、microSD、マイク、スピーカー、赤外線、Grove 拡張端子を一体化しています。

本リポジトリでは、標準 Cardputer を基準にします。次の製品は仕様が異なるため、同じ値やピン番号をそのまま使わないでください。

| 製品 | コア | 位置づけ |
| --- | --- | --- |
| Cardputer（K132） | M5StampS3 | 本ドキュメントの対象 |
| Cardputer v1.1（K132-V11） | Stamp-S3A | 改良版。アンテナ、ボタン、電源制御などが異なる |
| Cardputer-Adv（K132-Adv） | Stamp-S3A | 音声・拡張機能を強化した別モデル |

## 2. 主な仕様

| 項目 | 仕様 |
| --- | --- |
| SoC | ESP32-S3FN8、Xtensa LX7 デュアルコア、240 MHz |
| Flash | 8 MB |
| USB | USB OTG、USB Serial/JTAG |
| 無線 | 2.4 GHz Wi-Fi、Bluetooth 5.0 / BLE |
| 画面 | ST7789V2、1.14 inch、240×135 px |
| キーボード | 56 キー（4×14） |
| ストレージ | microSD |
| マイク | SPM1423 デジタル MEMS マイク |
| スピーカー | NS4168、I2S、8 Ω / 1 W |
| バッテリー | 本体 120 mAh + ベース 1400 mAh |
| 拡張 | HY2.0-4P Grove、I2C センサー向け |
| 赤外線 | 送信距離の公式目安: 0° で 410 cm、45° で 170 cm、90° で 66 cm |
| 外形 | 84.0×54.0×19.7 mm |
| 重量 | 92.3 g |
| 動作温度 | 0〜40 °C |

数値は M5Stack 公式ページの現行記載に基づきます。ロットや製品改版により差異があり得るため、購入品のラベル・回路図も確認してください。

## 3. GPIO / PinMap

### 3.1 画面と RGB LED

| ESP32-S3 GPIO | 用途 |
| --- | --- |
| GPIO33 | LCD RST |
| GPIO34 | LCD RS/DC |
| GPIO35 | LCD DAT / MOSI |
| GPIO36 | LCD SCK |
| GPIO37 | LCD CS |
| GPIO38 | LCD バックライト |

### 3.2 microSD

| ESP32-S3 GPIO | 用途 |
| --- | --- |
| GPIO12 | CS |
| GPIO14 | MOSI |
| GPIO40 | CLK |
| GPIO39 | MISO |

### 3.3 マイク、スピーカー、赤外線

| GPIO | 用途 |
| --- | --- |
| GPIO46 | SPM1423 MIC DAT |
| GPIO43 | SPM1423 MIC CLK / スピーカー LRCLK |
| GPIO41 | スピーカー BCLK |
| GPIO42 | スピーカー SDATA |
| GPIO44 | IR TX |

### 3.4 キーボードとバッテリー検出

キーボードは 74HC138 を使ったマトリクス構成で、GPIO `3, 4, 5, 6, 7, 8, 9, 11, 13, 15` を使用します。バッテリー検出は GPIO10 の ADC です。キーボードのスキャン処理は `M5Cardputer` ライブラリに任せ、アプリケーションから GPIO を直接操作しないでください。

### 3.5 Grove HY2.0-4P

| 線色 | 信号 |
| --- | --- |
| 黒 | GND |
| 赤 | 5V |
| 黄 | GPIO2 |
| 白 | GPIO1 |

Grove の赤線は 5V です。接続するセンサーの電源電圧および I/O レベルを必ず確認し、ESP32-S3 の GPIO に 5V を入力しないでください。

## 4. 開発環境

### Arduino IDE

公式の基本手順は次のとおりです。

1. Arduino IDE をインストールする。
2. M5Stack の Board Manager を追加し、`M5Cardputer` ボードを選択する。
3. Library Manager から `M5Cardputer` と依存ライブラリをインストールする。
4. `M5Cardputer` の `Basic -> display` を開いてコンパイル・書き込みする。

関連ライブラリ:

- [`M5Cardputer`](https://github.com/m5stack/M5Cardputer) — Cardputer 向け基本ライブラリ
- [`M5Unified`](https://github.com/m5stack/M5Unified) — M5Stack シリーズ共通 API
- [`M5GFX`](https://github.com/m5stack/M5GFX) — 描画ライブラリ

### PlatformIO

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

### ESP-IDF

ハードウェア評価用の公式 UserDemo があります。公式リポジトリの README では ESP-IDF v4.4.6 と `idf.py build` が案内されています。

- [`M5Cardputer-UserDemo`](https://github.com/m5stack/M5Cardputer-UserDemo)
- `CardputerADV` を使う場合は、同リポジトリの `CardputerADV` ブランチを使用する

CLI での書き込み・シリアル監視・トラブルシュートは、再利用可能な `~/.codex/skills/cardputer-cli-debug/SKILL.md` にまとめています。

### UiFlow2

コードを書かずにブロックで試す場合は、M5Stack の UiFlow2 Quick Start が利用できます。

- [Cardputer UiFlow2 Quick Start](https://docs.m5stack.com/en/uiflow2/cardputer/program)

## 5. 初回書き込み

1. USB-C データケーブルで接続する。充電専用ケーブルは使わない。
2. 本体上側の電源スイッチを `OFF` にする。
3. 側面の `G0` ボタンを押し続ける。
4. USB-C を接続し、数秒後に `G0` を離す。
5. Arduino IDE または PlatformIO でポートを選択して書き込む。

充電時は電源スイッチを `ON` にします。書き込みモードに入らない場合は、ケーブル、ポート、スイッチ位置、`G0` の押下タイミングを順番に確認してください。

## 6. CLI での書き込みとデバッグ

プロジェクトの種類に応じて次を使い分けます。

```sh
# PlatformIO
pio device list
pio run -e m5stack-cardputer -t upload --upload-port "$PORT"
pio device monitor --port "$PORT" --baud 115200

# ESP-IDF
idf.py -p "$PORT" flash monitor

# 既成バイナリの接続確認・検査
esptool --chip esp32s3 --port "$PORT" chip-id
esptool --chip esp32s3 --port "$PORT" flash-id
esptool image-info firmware.bin
```

既成 `.bin` を `esptool` で直接書く場合は、bootloader / partition table / app の種類とフラッシュオフセットを配布元またはビルドシステムで確認してから実行します。オフセットを推測したり、初手で `erase-flash` を実行したりしないでください。詳細な切り分けは `~/.codex/skills/cardputer-cli-debug/` のスキルを参照してください。

## 7. 最小サンプルの考え方

Arduino では `M5Cardputer` のサンプルを出発点にするのが安全です。描画だけを確認する場合の概念例は次のとおりです。ライブラリの API は更新される可能性があるため、最終的にはインストール済みライブラリの `examples` を優先してください。

```cpp
#include <M5Cardputer.h>

void setup() {
  auto cfg = M5.config();
  M5Cardputer.begin(cfg, true);
  M5Cardputer.Display.setTextSize(2);
  M5Cardputer.Display.println("Hello, Cardputer!");
}

void loop() {
  M5Cardputer.update();
}
```

キーボード入力、microSD、マイク、スピーカー、IR を追加する場合は、対応する公式サンプルを一つずつ動作確認してから組み合わせます。特にキー入力と画面描画を同時に扱う場合は、毎ループで `update()` を呼び出してください。

## 8. 公式資料一覧

### 最優先

- [Cardputer 公式製品ドキュメント](https://docs.m5stack.com/en/core/Cardputer)
- [Cardputer Arduino Quick Start](https://docs.m5stack.com/en/arduino/m5cardputer/program)
- [M5Cardputer Arduino ライブラリ](https://github.com/m5stack/M5Cardputer)
- [M5Cardputer UserDemo（ESP-IDF）](https://github.com/m5stack/M5Cardputer-UserDemo)
- [M5Stack のハードウェア資料](https://github.com/m5stack/M5_Hardware/tree/master/Products/K132_Cardputer)

### 回路・部品

- [Cardputer 回路図 PDF](https://m5stack-doc.oss-cn-shenzhen.aliyuncs.com/481/Sch_M5Cardputer.pdf)
- [Cardputer Base 回路図 PDF](https://m5stack-doc.oss-cn-shenzhen.aliyuncs.com/481/Sch_M5cardputer_Base.pdf)
- [M5StampS3 回路図 PDF](https://m5stack-doc.oss-cn-shenzhen.aliyuncs.com/522/Sch_M5StampS3_v0.2.pdf)
- [M5StampS3 公式ドキュメント](https://docs.m5stack.com/en/core/StampS3)
- [SPM1423 データシート](https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/docs/datasheet/core/SPM1423HM4H-B_datasheet_en.pdf)
- [NS4168 データシート](https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/docs/datasheet/core/NS4168_CN_datasheet.pdf)
- [ST7789V2 データシート](https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/docs/datasheet/unit/lcd/ST7789V2_SPEC_V1.0.pdf)

### 参考実装

- [M5Unified](https://github.com/m5stack/M5Unified)
- [Zephyr — M5Stack Cardputer shield](https://docs.zephyrproject.org/latest/boards/shields/m5stack_cardputer/doc/index.html)
- [CircuitPython — M5Stack CardPuter](https://circuitpython.org/board/m5stack_cardputer)
- [Awesome M5Stack Cardputer（コミュニティ一覧）](https://github.com/terremoth/awesome-m5stack-cardputer)

## 9. 確認済み事項と未確認事項

### 確認済み

- 公式仕様ページ、公式 Arduino Quick Start、公式 Arduino ライブラリ、公式 UserDemo を参照した。
- 標準 Cardputer の主要 GPIO と開発環境を記録した。
- 初代、v1.1、Adv を別モデルとして区別した。

### 未確認

- 手元の実機が K132 / K132-V11 / K132-Adv のどれか。
- 実機での USB ポート名、書き込み、画面、キーボード、microSD、音声の動作。
- このリポジトリで採用する最終的な開発環境とライブラリのバージョン。

実機検証を始めるときは、まず `README.md` の Arduino 手順で表示サンプルを書き込み、使用機種・Arduino ボードパッケージ・ライブラリバージョン・結果を記録してください。
