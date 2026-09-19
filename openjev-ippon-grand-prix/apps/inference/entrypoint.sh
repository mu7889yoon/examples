#!/bin/sh
set -eu

cleanup() {
  kill "$llama_pid" 2>/dev/null || true
}

if [ -z "${LLAMA_MODEL_PATH:-}" ]; then
  LLAMA_MODEL_PATH="$(python -c 'import json, os; print("/opt/models/" + json.load(open(os.environ["INFERENCE_CONFIG"], encoding="utf-8"))["model"]["ggufFile"])')"
  # Build-time verification protects the artifact; verify once more before
  # loading so a damaged local image/layer never serves a result.
  /usr/local/bin/download-model --config "$INFERENCE_CONFIG" --output-dir /opt/models --verify-existing
fi
export LLAMA_MODEL_PATH

llama-server \
  --model "$LLAMA_MODEL_PATH" \
  --host 127.0.0.1 \
  --port 8081 \
  --ctx-size 4096 \
  --threads "$LLAMA_THREADS" \
  --parallel 1 \
  --no-webui &
llama_pid=$!
trap cleanup EXIT INT TERM

# A failed GGUF load must fail the image before MicroVM Ready/Validate hooks;
# never let FastAPI report a false healthy runtime while llama.cpp is loading.
attempt=0
until curl --fail --silent --show-error "$LLAMA_SERVER_URL/health" >/dev/null; do
  if ! kill -0 "$llama_pid" 2>/dev/null; then
    wait "$llama_pid"
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 180 ]; then
    echo "llama-server did not become healthy within 180 seconds" >&2
    exit 1
  fi
  sleep 1
done

python -m uvicorn ippon_inference.app:create_app --factory --host 0.0.0.0 --port "$PORT" &
app_pid=$!
wait "$app_pid"
