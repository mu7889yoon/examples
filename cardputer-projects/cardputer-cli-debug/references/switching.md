# Cardputer-Adv ファームウェア切り替え

最終確認日: **2026-09-11**

Cardputer-Adv では、M5Stack 公式の `Cardputer-Adv User Demo` と `UIFlow2.0 Cardputer-Adv` は別ファームウェアである。User Demo は出荷時の標準デモ／ランチャー、UIFlow2 は MicroPython 実行環境として扱う。通常のアプリ更新だけなら切り替えず、UIFlow2 の `/flash/` へ `mpremote` で転送する。

## 切り替え前の注意

- 対象が Cardputer-Adv（ESP32-S3、8MB）であることを確認する。標準 Cardputer 用のイメージを使わない。
- ファームウェア切り替えはアプリ更新とは異なり、フラッシュ上の起動環境を置き換える。UIFlow2 の `/flash/` にあるファイルがそのまま利用できる保証はないため、必要なファイルを先にホストへ退避する。
- `boot.py` や `main.py` が必要な場合は、復元後に再配置する。`main.py` を残したまま UIFlow2 に戻すと、起動直後にユーザーコードが実行されることがある。
- 書き込み中は USB ケーブルを抜かない。`erase-flash` は通常不要で、全消去が必要な理由とバックアップを確認できた場合だけ使う。

## User Demo → UIFlow2

UIFlow2 へ切り替えるときは、M5Burner の公式 `UIFlow2.0 Cardputer-Adv` を使うのが安全である。M5Burner で対象ファームウェアを選び、ポートを指定して書き込む。CLI で行う場合は、M5Burner のマニフェストから対象バイナリを選び、配布元が示すオフセットを確認してから `esptool` で書き込む。

```sh
CARDPUTER_PORT=/dev/cu.usbmodem101

# ROM bootloader に入っていることを確認
uv tool run esptool --chip esp32s3 --port "$CARDPUTER_PORT" \
  --before no-reset --after no-reset chip-id

# UIFlow2 の公式イメージを M5Burner で取得後、image-info で確認
uv tool run esptool image-info uiflow2-cardputer-adv.bin

# オフセットは配布元／イメージ形式に合わせる。merged image なら 0x0。
uv tool run esptool --chip esp32s3 --port "$CARDPUTER_PORT" \
  --baud 460800 --before no-reset --after watchdog-reset \
  write-flash --flash-size 8MB 0x0 uiflow2-cardputer-adv.bin
```

UIFlow2 が起動した後のアプリ更新は、ファームウェアを再書き込みせず、次の手順を使う。

```sh
CARDPUTER_PORT=/dev/tty.usbmodem101
mpremote connect "$CARDPUTER_PORT" fs cp app.py :/flash/app.py
mpremote connect "$CARDPUTER_PORT" run app.py
```

## UIFlow2 → 公式 User Demo

Cardputer-Adv の公式復元イメージは M5Burner の `Cardputer-Adv User Demo`。現在確認できる公式版は `v0.3`。公式マニフェスト API と CDN から取得できる。

```sh
CARDPUTER_PORT=/dev/cu.usbmodem101
FACTORY_BIN=/tmp/cardputer-adv-user-demo-v0.3.bin

curl -fsSL \
  https://m5burner-cdn.m5stack.com/firmware/4ed4ab3a388a74e805971f37d6adcc9f.bin \
  -o "$FACTORY_BIN"

# 取得した公式イメージの検査
shasum -a 256 "$FACTORY_BIN"
uv tool run esptool image-info "$FACTORY_BIN"

# ROM bootloader に入れてから実行。User Demo の merged image は 0x0。
uv tool run esptool --chip esp32s3 --port "$CARDPUTER_PORT" \
  --baud 460800 --before no-reset --after watchdog-reset \
  write-flash --flash-size 8MB 0x0 "$FACTORY_BIN"
```

版を固定せず、公式マニフェストから候補を確認する場合:

```sh
curl -fsSL https://m5burner-api.m5stack.com/api/firmware \
  | jq '.[] | select(.name == "Cardputer-Adv User Demo")'
```

`file` の値は CDN 上のファイル名であり、バージョン番号ではない。書き込み前に `name`、`version`、`published` を確認し、取得後に `image-info` で ESP32-S3・8MB・イメージ形式を検査する。

## 書き込み後の確認

1. `Hash of data verified.` が出ることを確認する。
2. 自動リセット後、数秒待って USB デバイスが再列挙されることを確認する。
3. User Demo へ戻した場合は、M5Stack の標準 User Demo／ランチャー画面が表示されることを本体で確認する。
4. UIFlow2 へ戻した場合は、`mpremote fs ls` と REPL 接続を確認し、必要なら `machine.reset()` を実行する。

## 公式資料

- [Cardputer-Adv 工場出荷状態への復元](https://docs.m5stack.com/en/guide/restore_factory/cardputer_adv)
- [M5Cardputer-UserDemo](https://github.com/m5stack/M5Cardputer-UserDemo)
- [M5Burner ファームウェア API](https://m5burner-api.m5stack.com/api/firmware)
