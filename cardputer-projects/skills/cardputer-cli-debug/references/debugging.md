# Cardputer CLI デバッグ手順

最終確認日: **2026-09-11**

## 診断の順番

1. ポートが接続前後で変化するか確認する。
2. Cardputer をダウンロードモードにして `esptool ... chip-id` を実行する。
3. `flash-id` でフラッシュ容量・モードを確認する。
4. 最小の display サンプルを書き込む。
5. 115200 baud で ROM / アプリ起動ログを取得する。
6. 問題がアプリ固有か、書き込み・ハードウェア固有かを比較する。

## エラー別の切り分け

### ポートが見えない

- USB-C ケーブルがデータ通信対応か確認する。
- 電源スイッチとダウンロードモード操作をやり直す。
- macOS / Linux は `serial.tools.list_ports`、PlatformIO は `pio device list` で確認する。
- 別の USB ポート、ハブを介さない接続、別ケーブルを試す。

### `Failed to connect` / `No serial data received`

- 正しいポートを指定する。
- 端末、IDE、別の monitor を閉じてポートを解放する。
- 電源を `OFF`、`G0` 押下、USB 接続、`G0` 解放の順序を守る。
- baud を 115200 または 460800 に下げて再試行する。
- Grove や外付け回路を外して標準状態で試す。

### 書き込みは成功するが起動しない

- `.bin` の種類、書き込みオフセット、bootloader、partition table の組み合わせを確認する。
- `esptool image-info` で対象チップを確認する。
- フラッシュモードを勝手に `qio` / `dio` へ変更しない。

### MicroPython の直接実行・転送

UIFlow2 MicroPython のアプリ更新で問題が出た場合は、ファームウェアを消去する前に次を確認する。

```sh
mpremote connect "$PORT" fs ls
mpremote connect "$PORT" exec "import sys; print(sys.implementation)"
mpremote connect "$PORT" run helloworld.py
```

- `no device found` / `failed to access`: ポートの再列挙、他のシリアルモニタによる占有、USB-C ケーブルを確認する。
- `could not enter raw repl`: 本体で実行中のアプリを `Ctrl-C` で止め、再接続する。Cardputer-Adv は電源スイッチ OFF → USB-C 再接続で復旧しやすい。
- `ImportError: no module named M5` / `hardware`: UIFlow2 用ファームウェアではない可能性がある。標準 MicroPython と UIFlow2 MicroPython の API を混同しない。
- `Traceback` が出る: traceback の先頭から、API 名、ファイル配置、画面初期化、機種差分の順に切り分ける。
- ファイル転送後に起動時の表示が変わらない: `/flash/main.py` を上書きしていない限り、転送だけでは自動起動しない。`mpremote run` で実行するか、App List が読む `/flash/apps/` 配下に配置する。

`boot.py` や `main.py` の上書き、NVS の boot option 変更、全消去は起動フローや既存アプリを壊す可能性があるため、対象と復旧手順を確認してから行う。

## シリアル出力が文字化けする

- monitor の baud を 115200 に合わせる。
- 書き込み速度とアプリのシリアル出力速度は別物として扱う。
- USB Serial/JTAG と USB CDC のどちらをアプリが使う設定か確認する。

## 取得しておく証拠

```sh
esptool version
esptool --chip esp32s3 --port "$PORT" chip-id
esptool --chip esp32s3 --port "$PORT" flash-id
pio --version
idf.py --version
```

実行コマンド、エラー全文、実機型番、OS、ケーブル、外部接続の有無を記録する。認証情報・Wi-Fi パスワード・トークンは除外する。

## 破壊的操作の扱い

`erase-flash` はフラッシュ全体を消去する。明確な目的とバックアップがある場合だけ実行し、書き込みエラーの初手にはしない。
