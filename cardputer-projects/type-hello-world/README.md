# Cardputer MicroPython Hello World

UIFlow2 MicroPython が動作している Cardputer に `helloworld` を表示する最小例です。

## CLI で転送・実行

Cardputer を USB-C で接続し、ポートを確認してから実行します。

```sh
PORT=/dev/tty.usbmodem101
python3 ../cardputer-cli-debug/scripts/push_micropython.py \
  --port "$PORT" \
  --source helloworld.py
```

スクリプトは `/flash/helloworld.py` に保存した後、REPL 経由で一度実行します。終了後も画面には表示が残ります。
再起動後も手動で実行できるよう、スクリプトは `/flash/helloworld.py` に保存します。

シリアル REPL を確認する場合は次のコマンドを使います。

```sh
uv tool run mpremote connect "$PORT" repl
```

Cardputer-Adv では、電源スイッチを OFF にして USB-C を挿し直すとポートを再認識しやすい場合があります。
