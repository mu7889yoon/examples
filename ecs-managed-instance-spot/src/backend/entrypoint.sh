#!/bin/bash
# vLLM Server Entrypoint Script
# Uses environment variables for configuration

set -e

# Default values (can be overridden by environment variables)
MODEL_NAME="${MODEL_NAME:-Qwen/Qwen3-4B}"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
MAX_MODEL_LEN="${MAX_MODEL_LEN:-4096}"
GPU_MEMORY_UTILIZATION="${GPU_MEMORY_UTILIZATION:-0.9}"

echo "Starting vLLM server with configuration:"
echo "  Model: ${MODEL_NAME}"
echo "  Port: ${PORT}"
echo "  Host: ${HOST}"
echo "  Max Model Length: ${MAX_MODEL_LEN}"
echo "  GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION}"

exec python -m vllm.entrypoints.openai.api_server \
    --model "${MODEL_NAME}" \
    --port "${PORT}" \
    --host "${HOST}" \
    --max-model-len "${MAX_MODEL_LEN}" \
    --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}"
