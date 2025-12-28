# vLLM Backend Container for Qwen/Qwen3-4B Inference
# Based on official vLLM OpenAI-compatible server image

FROM vllm/vllm-openai:latest

# Environment variables for model configuration
# These can be overridden at runtime via ECS task definition or docker run
ENV MODEL_NAME="Qwen/Qwen3-4B"
ENV PORT="8000"
ENV HOST="0.0.0.0"
ENV MAX_MODEL_LEN="4096"
ENV GPU_MEMORY_UTILIZATION="0.9"

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose the API port
EXPOSE 8000

# Health check for ECS/ALB
# Start period is long to allow model loading time
HEALTHCHECK --interval=30s --timeout=10s --start-period=180s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Start vLLM server using entrypoint script
# Environment variables are used for configuration flexibility
ENTRYPOINT ["/entrypoint.sh"]
