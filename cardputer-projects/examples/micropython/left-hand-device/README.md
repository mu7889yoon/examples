# Cardputer BLE Macro Pad

2026-10-02 に接続中の Cardputer から読み出した、UIFlow2 MicroPython の左手デバイス用コードです。

- `main.py`: `/flash/main.py` から取得。`/flash/apps/main.py` にも同一内容がありました。
- `ble_hid_keyboard.py`: `/flash/ble_hid_keyboard.py` から取得。BLE HID キーボードとボンディング情報の保存処理を含みます。

取得時の端末には UIFlow 2.5.2 が動作しており、起動ログには `BLE HID bonding enabled` と表示されました。ただし、`/flash/ble_hid_secrets.dat` はファイル一覧に存在しませんでした。接続情報が保存されない原因は、まだ特定していません。

`/flash/boot.py` は UIFlow2 の起動処理であり、このアプリのコードではないため、ここには含めていません。端末から読み取ったバックアップは `/private/tmp/cardputer-extract/` にあります。
