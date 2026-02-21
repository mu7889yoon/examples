#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "Usage: $0 <protocol> [trial_count] [run_id]"
  echo "Example: $0 dcv-windows 10"
  exit 1
fi

PROTOCOL="$1"
TRIAL_COUNT="${2:-10}"
RUN_ID="${3:-$(date -u +%Y%m%dT%H%M%SZ)}"

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_DIR="${ROOT_DIR}/results/raw/${RUN_ID}/${PROTOCOL}"
MANIFEST_FILE="${RUN_DIR}/manifest.csv"

mkdir -p "${RUN_DIR}"

if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "protocol,trial,recording_start_epoch_ms,recording_path,note" >"${MANIFEST_FILE}"
fi

now_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

csv_escape() {
  local value="$1"
  value="${value//\"/\"\"}"
  printf "\"%s\"" "${value}"
}

echo "Run ID      : ${RUN_ID}"
echo "Protocol    : ${PROTOCOL}"
echo "Trial count : ${TRIAL_COUNT}"
echo "Manifest    : ${MANIFEST_FILE}"
echo

for i in $(seq 1 "${TRIAL_COUNT}"); do
  trial="$(printf '%02d' "${i}")"
  echo "========== Trial ${trial}/${TRIAL_COUNT} =========="
  echo "1) 対象プロトコルでリモート接続を開始してください。"
  read -r -p "2) 録画を開始したら Enter を押してください: " _
  recording_start_epoch_ms="$(now_ms)"
  echo "   recording_start_epoch_ms=${recording_start_epoch_ms}"

  read -r -p "3) 試行を終了して録画を停止後、録画ファイル絶対パスを入力: " recording_path
  if [[ ! -f "${recording_path}" ]]; then
    echo "録画ファイルが見つかりません: ${recording_path}" >&2
    exit 1
  fi

  read -r -p "4) メモ（任意）: " note

  echo "$(csv_escape "${PROTOCOL}"),$(csv_escape "${trial}"),$(csv_escape "${recording_start_epoch_ms}"),$(csv_escape "${recording_path}"),$(csv_escape "${note}")" >>"${MANIFEST_FILE}"
  echo "保存しました。"
  echo
done

echo "計測データを保存しました。"
echo "次のステップ例:"
echo "python3 ${ROOT_DIR}/scripts/local/analyze-latency.py --manifest ${MANIFEST_FILE} --output-dir ${ROOT_DIR}/results/analysis/${RUN_ID} --roi 140,320,1000,120"
