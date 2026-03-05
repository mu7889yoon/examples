# Location Simulator

実端末なしで、初期座標からランダムに少しずつズラしながら IoT Core へ送信する shell スクリプトです。

## 前提

- AWS CLI v2
- 送信先AWSアカウントに `iot:DescribeEndpoint` と `iot:Publish` 権限

## 実行

```bash
cd /Users/ny/Documents/examples/geo-stream/src/simulator
./send-fixed.sh
```

## オプション環境変数

```bash
DEVICE_ID=sim-001
LAT=35.681236
LNG=139.767125
INTERVAL_SEC=5
JITTER_METERS=120
AWS_REGION=ap-northeast-1
AWS_PROFILE=default
```

例:

```bash
AWS_PROFILE=default DEVICE_ID=truck-01 LAT=35.68 LNG=139.76 INTERVAL_SEC=5 JITTER_METERS=250 ./send-fixed.sh
```

停止は `Ctrl+C`。
