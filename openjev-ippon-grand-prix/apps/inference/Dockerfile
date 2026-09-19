# Build from repository root after obtaining the selected immutable GGUF:
#   python apps/inference/scripts/download_model.py --config configs/config.json --output-dir models
#   docker build --platform linux/arm64 -f apps/inference/Dockerfile -t ai-ippon-inference .
#
# This is intentionally an ARM64-native llama.cpp build.  The corresponding
# OpenJev browser demo uses wllama (llama.cpp compiled to WASM); MicroVMs use
# the same GGUF path without a browser or a GPU.
ARG LLAMA_CPP_REVISION=60081bb2b5b3294165a4d67c5cbeebe74c868014
FROM amazonlinux:2023 AS llama-builder
ARG LLAMA_CPP_REVISION
RUN dnf install -y cmake gcc-c++ git make && dnf clean all
RUN git clone https://github.com/ggml-org/llama.cpp.git /src/llama.cpp \
    && git -C /src/llama.cpp checkout "$LLAMA_CPP_REVISION" \
    && git -C /src/llama.cpp submodule update --init --recursive
RUN cmake -S /src/llama.cpp -B /src/llama.cpp/build \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_CUDA=OFF \
      -DGGML_METAL=OFF \
      -DGGML_NATIVE=ON \
    && cmake --build /src/llama.cpp/build --target llama-server -j"$(nproc)"

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    INFERENCE_CONFIG=/app/configs/config.json \
    INFERENCE_JUDGES_DIR=/app/configs/judges \
    PYTHONPATH=/app/src \
    LLAMA_SERVER_URL=http://127.0.0.1:8081 \
    LLAMA_THREADS=2

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=llama-builder /src/llama.cpp/build/bin/llama-server /usr/local/bin/llama-server
COPY apps/inference/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# The config is the model-selection source of truth.  The GGUF is acquired and
# content-verified before Docker is invoked; image builds never fetch model
# weights over the network.  ``COPY`` deliberately fails if the model has not
# been prepared, and the verifier rejects a wrong/truncated snapshot.
COPY configs/config.json /tmp/inference-config.json
COPY apps/inference/scripts/download_model.py /usr/local/bin/download-model
COPY models/ /opt/models/
RUN python /usr/local/bin/download-model --config /tmp/inference-config.json --output-dir /opt/models --verify-existing

COPY apps/inference/src ./src
COPY apps/inference/entrypoint.sh /usr/local/bin/inference-entrypoint
COPY configs ./configs
RUN chmod 0555 /usr/local/bin/inference-entrypoint

EXPOSE 8080
CMD ["/usr/local/bin/inference-entrypoint"]
