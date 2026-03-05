#!/usr/bin/env bash
set -euo pipefail

DEVICE_ID="${DEVICE_ID:-sim-001}"
LAT="${LAT:-35.681236}"
LNG="${LNG:-139.767125}"
INTERVAL_SEC="${INTERVAL_SEC:-5}"
JITTER_METERS="${JITTER_METERS:-120}"
AWS_REGION="${AWS_REGION:-ap-northeast-1}"
AWS_PROFILE="${AWS_PROFILE:-}"
TOPIC="geo/${DEVICE_ID}"
CURRENT_LAT="${LAT}"
CURRENT_LNG="${LNG}"

AWS_OPTS=(--region "${AWS_REGION}")
if [[ -n "${AWS_PROFILE}" ]]; then
  AWS_OPTS+=(--profile "${AWS_PROFILE}")
fi

ENDPOINT="$(aws "${AWS_OPTS[@]}" iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text)"

echo "Starting simulator"
echo "  endpoint: ${ENDPOINT}"
echo "  topic: ${TOPIC}"
echo "  interval: ${INTERVAL_SEC}s"
echo "  jitter: ${JITTER_METERS}m/step"

generate_payload() {
  local captured_at="$1"
  local lat="$2"
  local lng="$3"
  cat <<JSON
{
  "deviceId": "${DEVICE_ID}",
  "lat": ${lat},
  "lng": ${lng},
  "speed": 0,
  "heading": 0,
  "accuracy": 10,
  "capturedAt": "${captured_at}"
}
JSON
}

random_walk_step() {
  python3 - "$1" "$2" "$3" <<'PY'
import math
import random
import sys

lat = float(sys.argv[1])
lng = float(sys.argv[2])
jitter_m = float(sys.argv[3])

lat_delta_deg = jitter_m / 111320.0
lng_divisor = 111320.0 * max(math.cos(math.radians(lat)), 0.01)
lng_delta_deg = jitter_m / lng_divisor

next_lat = lat + random.uniform(-lat_delta_deg, lat_delta_deg)
next_lng = lng + random.uniform(-lng_delta_deg, lng_delta_deg)

print(f"{next_lat:.6f} {next_lng:.6f}")
PY
}

while true; do
  read -r CURRENT_LAT CURRENT_LNG <<<"$(random_walk_step "${CURRENT_LAT}" "${CURRENT_LNG}" "${JITTER_METERS}")"
  CAPTURED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  PAYLOAD="$(generate_payload "${CAPTURED_AT}" "${CURRENT_LAT}" "${CURRENT_LNG}")"

  aws "${AWS_OPTS[@]}" iot-data publish \
    --endpoint-url "https://${ENDPOINT}" \
    --topic "${TOPIC}" \
    --cli-binary-format raw-in-base64-out \
    --payload "${PAYLOAD}"

  echo "[$(date +"%Y-%m-%d %H:%M:%S")] published device=${DEVICE_ID} lat=${CURRENT_LAT} lng=${CURRENT_LNG}"
  sleep "${INTERVAL_SEC}"
done
