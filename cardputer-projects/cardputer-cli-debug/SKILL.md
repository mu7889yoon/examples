---
name: cardputer-cli-debug
description: "M5Stack Cardputer の CLI 書き込み、MicroPython 直接プッシュ、シリアル監視、esptool・PlatformIO・ESP-IDF の切り分けを支援する。"
metadata:
  short-description: "Cardputer の CLI 書き込みとデバッグ"
---

# Cardputer CLI 書き込み・デバッグ

M5Stack Cardputer のファームウェアを CLI でビルド・書き込み、または UIFlow2 MicroPython のファイルを USB 経由で直接プッシュし、シリアルログや実行エラーを切り分けるときに使う。標準 Cardputer（K132）を基準にするが、Cardputer v1.1（K132-V11）と Cardputer-Adv（K132-Adv）は別機種として扱う。

## 最初に確認すること

1. 実機の型番と対象ファームウェアを確認する。型番が不明なまま GPIO、フラッシュレイアウト、別モデルのバイナリを流用しない。
2. データ通信対応の USB-C ケーブルを使い、他のシリアルモニタを閉じる。
3. Cardputer は電源スイッチを `OFF` にし、`G0` を押しながら USB 接続してダウンロードモードに入れる。充電時は `ON` にする。
4. ポートを特定し、まず `esptool` の読み取り系コマンドで ESP32-S3 と通信できることを確認する。

UIFlow2 MicroPython がすでに動作している場合、アプリの更新はファームウェアの再フラッシュではなく、`mpremote` で `/flash/` または `/flash/apps/` にファイルを転送する経路を優先する。

## 経路の選択

- `platformio.ini` があるプロジェクト: [PlatformIO 手順](references/flashing.md#platformio) を読む。
- `CMakeLists.txt` と ESP-IDF 構成があるプロジェクト: [ESP-IDF 手順](references/flashing.md#esp-idf) を読む。
- 既成 `.bin` を直接書き込む、フラッシュを検査・退避する: [esptool 手順](references/flashing.md#esptool) を読む。
- Arduino スケッチを CLI だけでコンパイル・アップロードする: [Arduino CLI 手順](references/flashing.md#arduino-cli) を読む。
- UIFlow2 MicroPython のスクリプトを直接転送・実行する: [MicroPython 直接プッシュ手順](references/flashing.md#uiflow2-micropython-直接プッシュ) を読む。

フラッシュアドレスは推測しない。ESP-IDF は `idf.py flash`、PlatformIO は `pio run -t upload` に任せ、`esptool` へ直接渡す場合はビルドシステムが生成した書き込み引数または配布元の指示を根拠にする。

## デバッグの基本

- ポート認識、ROM bootloader への接続、フラッシュ ID、アプリ起動ログの順で確認する。
- 通信失敗はポート占有、ダウンロードモード、ケーブル、速度、電源、接続中の外部デバイスの順に切り分ける。
- 書き込み成功後に起動しない場合は、バイナリの種類、書き込みオフセット、パーティション、フラッシュモードを確認する。
- アプリのクラッシュは 115200 baud のログを保存し、PlatformIO の `esp32_exception_decoder` または ESP-IDF の monitor で解析する。
- MicroPython は `mpremote run` の traceback、`M5` / `hardware` モジュールの有無、対象ファイルの配置、UIFlow の起動方式を順に確認する。
- `erase-flash` はデータを消去するため、必要性と対象を確認してから実行する。通常の再書き込みでは使わない。

詳細な診断表は [debugging.md](references/debugging.md)、CLI の使い分けとコマンド例は [flashing.md](references/flashing.md) を読む。

## 報告に残す情報

問題解決時は、実機モデル、OS、ツールのバージョン、ポート名、実行コマンド、エラー全文、ダウンロードモードでの接続可否、最後に成功した手順を記録する。Wi-Fi パスワードやトークンはログやソースへ含めない。
