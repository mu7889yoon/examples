FROM public.ecr.aws/sam/build-python3.12:latest

# Install system dependencies
RUN dnf install -y \
    gcc-c++ \
    make \
    cmake \
    openblas-devel \
    git \
    gcc-gfortran

WORKDIR /build

# CMAKE_ARGS:
# - GGML_BLAS=ON: Enable BLAS for accelerated matrix operations
# - GGML_BLAS_VENDOR=OpenBLAS: Use OpenBLAS
# - GGML_NATIVE=OFF: Disable CPU-native optimizations for Lambda compatibility
# - GGML_LTO=ON: Enable Link Time Optimization
# - GGML_AVX2=ON: Enable AVX2 (supported by Lambda)
# - GGML_AVX512=OFF: Disable AVX512 (not supported by Lambda)
ENV CMAKE_ARGS="-DGGML_BLAS=ON -DGGML_BLAS_VENDOR=OpenBLAS -DGGML_NATIVE=OFF -DGGML_LTO=ON -DGGML_AVX2=ON -DGGML_AVX512=OFF -DLLAMA_BUILD_TOOLS=OFF"
ENV LLAMA_BLAS=1
ENV LLAMA_OPENBLAS=1
ENV LLAMA_METAL=0
ENV LLAMA_CUDA=0

# Install build dependencies
RUN pip install scikit-build-core numpy

# Build llama-cpp-python from JamePeng fork (v0.3.30, supports Qwen3.5 architecture)
# Official PyPI v0.3.16 (Aug 2025) bundles old llama.cpp without Qwen3.5 support
RUN mkdir -p /opt/python/ && \
    git clone --recurse-submodules https://github.com/JamePeng/llama-cpp-python.git && \
    pip install ./llama-cpp-python --no-build-isolation -t /opt/python/ && \
    pip install fastapi uvicorn boto3 -t /opt/python/ && \
    mkdir -p /opt/lib && \
    cp /usr/lib64/libopenblas.so.0 /opt/lib/ && \
    cp /usr/lib64/libgfortran.so.5 /opt/lib/ && \
    (cp /usr/lib64/libquadmath.so.0 /opt/lib/ 2>/dev/null || true) && \
    cp /usr/lib64/libgomp.so.1 /opt/lib/
