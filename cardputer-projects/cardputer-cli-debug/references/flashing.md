# Cardputer CLI 書き込み手順

最終確認日: **2026-09-11**

対象は原則 M5Stack Cardputer（K132 / ESP32-S3FN8）です。v1.1 と Adv は別モデルなので、配布元が指定するボード設定・ファームウェアを優先します。

## 共通: ポート確認とダウンロードモード

### ポートの確認

macOS:

```sh
ls /dev/cu.usbmodem* /dev/cu.SLAB_USBtoUART* 2>/dev/null
python3 -m serial.tools.list_ports -v
```

Linux:

```sh
ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null
python3 -m serial.tools.list_ports -v
```

PlatformIO を使う場合は次でも確認できます。

```sh
pio device list
```

### ダウンロードモード

1. データ通信対応の USB-C ケーブルを接続する。
2. 電源スイッチを `OFF` にする。
3. `G0` を押し続ける。
4. USB-C を接続または再接続する。
5. 数秒後に `G0` を離す。

## UIFlow2 MicroPython 直接プッシュ

UIFlow2 MicroPython が既に動作している Cardputer-Adv などでは、ファームウェアを消去・再書き込みせず、`mpremote` でアプリを `/flash/` に転送できる。これは画面表示や小さなアプリの反復開発に向く。

```sh
python3 -m pip install --user mpremote pyserial
PORT=/dev/tty.usbmodem101

# 接続とファイルシステムを確認
mpremote connect "$PORT" fs ls

# ファイルを保存（既存の main.py や boot.py は上書きしない）
mpremote connect "$PORT" fs cp helloworld.py :/flash/helloworld.py

# ホストから一度だけ実行
mpremote connect "$PORT" run helloworld.py

# REPL で確認・デバッグ
mpremote connect "$PORT" repl
```

UIFlow の App List から選択するアプリにする場合は `/flash/apps/` に配置する。ただしアプリのレイアウトや終了操作は、対象ファームウェアの規約（`run()`、`MatrixKeyboard`、リセットによるランチャー復帰など）に合わせる。

`/flash/main.py` は起動フローを占有するため、ユーザーが明示的に求めない限り作成・上書きしない。Cardputer-Adv のネイティブ USB では DTR/RTS によるハードリセットが効かない構成があるため、転送後の再起動は REPL 経由の `machine.reset()`、または本体操作で行う。

### UIFlow2 で `mpremote` が raw REPL に入れない場合

Cardputer-Adv の UIFlow2 では、`mpremote` が `could not enter raw repl` になることがある。その場合は macOS の `tty.usbmodem*` ポートを使い、同梱スクリプトで paste-mode 転送する。

```sh
PORT=/dev/tty.usbmodem101
python3 -m pip install --user pyserial
python3 cardputer-cli-debug/scripts/push_micropython.py \
  --port "$PORT" \
  --source type-hello-world/helloworld.py
```

スクリプトはデフォルトで `/flash/helloworld.py` だけを書き込み、`boot.py` / `main.py` の上書きを拒否する。`--no-run` を付けると保存だけにできる。

## PlatformIO

`platformio.ini` に Cardputer 環境がある場合、通常は以下で完結します。

```sh
pio run -e m5stack-cardputer
pio run -e m5stack-cardputer -t upload --upload-port "$PORT"
pio device monitor --port "$PORT" --baud 115200
```

公式 Cardputer の PlatformIO 設定は `esp32-s3-devkitc-1`、Arduino framework、`M5Cardputer` ライブラリ、upload speed 1500000 の構成です。プロジェクト側の設定を優先し、異なる設定を無断で上書きしない。

## ESP-IDF

ESP-IDF プロジェクトは、プロジェクトが要求する ESP-IDF バージョンを有効にしてから実行します。M5Stack の公式 `M5Cardputer-UserDemo` は README 上 ESP-IDF v4.4.6 を使用します。

```sh
idf.py set-target esp32s3
idf.py build
idf.py -p "$PORT" flash
idf.py -p "$PORT" monitor
```

## esptool

```sh
python3 -m pip install --user esptool
esptool --chip esp32s3 --port "$PORT" chip-id
esptool --chip esp32s3 --port "$PORT" flash-id
esptool image-info firmware.bin
```

直接書き込みは、配布元またはビルドシステムでオフセットが確定している場合だけ行う。`erase-flash` はファイルシステムを含む全消去なので、了承とバックアップなしに実行しない。

## Arduino CLI

```sh
arduino-cli config add board_manager.additional_urls \
  https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/arduino/package_m5stack_index.json
arduino-cli core update-index
arduino-cli core install m5stack:esp32
arduino-cli lib install M5Cardputer
arduino-cli board list
arduino-cli compile --fqbn m5stack:esp32:M5Cardputer path/to/sketch
arduino-cli upload --fqbn m5stack:esp32:M5Cardputer --port "$PORT" path/to/sketch
```

## 公式資料

- [M5Stack Cardputer](https://docs.m5stack.com/en/core/Cardputer)
- [Cardputer Arduino Quick Start](https://docs.m5stack.com/en/arduino/m5cardputer/program)
- [M5Cardputer](https://github.com/m5stack/M5Cardputer)
- [esptool ESP32-S3 documentation](https://docs.espressif.com/projects/esptool/en/latest/esp32s3/)
