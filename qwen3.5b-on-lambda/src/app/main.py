import os
import json
import ctypes
import boto3
import llama_cpp
import logging
import multiprocessing
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variables to persist across invocations
llm = None
model_fd = None


def create_memfd():
    """Create anonymous in-memory file and return file descriptor."""
    libc = ctypes.CDLL("libc.so.6", use_errno=True)
    memfd_create = libc.memfd_create
    memfd_create.argtypes = [ctypes.c_char_p, ctypes.c_uint]
    memfd_create.restype = ctypes.c_int

    # Close fd if a new process is exec'd.
    MFD_CLOEXEC = 1
    fd = memfd_create(b"model", MFD_CLOEXEC)
    if fd < 0:
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err))
    return fd


def download_part_to_memfd(s3, bucket, key, fd, start, end):
    """Download S3 object range and write to in-memory file."""
    resp = s3.get_object(Bucket=bucket, Key=key, Range=f"bytes={start}-{end}")
    with resp["Body"] as body:
        data = body.read()
    os.pwrite(fd, data, start)


def download_model_to_memfd(bucket, key):
    """Download model from S3 directly into memfd and return fd path."""
    s3 = boto3.client("s3")
    meta = s3.head_object(Bucket=bucket, Key=key)
    file_size = meta["ContentLength"]
    chunk_size_mb = int(os.getenv("MODEL_DOWNLOAD_CHUNK_MB", "64"))
    chunk_size = chunk_size_mb * 1024 * 1024
    max_workers = int(os.getenv("MODEL_DOWNLOAD_WORKERS", str(multiprocessing.cpu_count())))

    logger.info(
        "Preparing memfd for s3://%s/%s (%0.2fMB)",
        bucket,
        key,
        file_size / 1024 / 1024,
    )
    fd = create_memfd()
    try:
        os.ftruncate(fd, file_size)

        parts = []
        for start in range(0, file_size, chunk_size):
            end = min(start + chunk_size - 1, file_size - 1)
            parts.append((start, end))

        worker_count = max(1, min(max_workers, len(parts)))
        logger.info(
            "Downloading model in %d parts (%dMB each), workers=%d",
            len(parts),
            chunk_size_mb,
            worker_count,
        )
        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = [
                executor.submit(
                    download_part_to_memfd,
                    s3,
                    bucket,
                    key,
                    fd,
                    start,
                    end,
                )
                for start, end in parts
            ]
            for future in as_completed(futures):
                future.result()
    except Exception:
        os.close(fd)
        raise

    return fd, f"/proc/self/fd/{fd}"


def init_model():
    """Initialize the LLM model during Lambda cold start."""
    global llm, model_fd

    bucket = os.environ['MODEL_BUCKET']
    key = os.environ['MODEL_KEY']

    logger.info("Starting model download into memfd...")
    model_fd, model_path = download_model_to_memfd(bucket, key)
    logger.info("Model mapped at %s", model_path)

    logger.info("Initializing LLM...")
    llm = llama_cpp.Llama(
        model_path=model_path,
        n_ctx=32768,
        n_batch=2048,
        n_ubatch=512,
        n_threads=multiprocessing.cpu_count(),
        flash_attn=True,
        verbose=True,
    )
    logger.info("LLM initialization complete")

    # Prime the model
    prompt = "<|im_start|>user\nHi<|im_end|>\n<|im_start|>assistant\n"
    llm.create_completion(prompt=prompt, max_tokens=4, temperature=0.1)
    logger.info("LLM is primed")


# Initialize during cold start
init_model()

# Create FastAPI application
app = FastAPI()

@app.get("/healthz")
def healthz():
    return {"status": "ok"}

class Message(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    model: Optional[str] = os.environ.get('MODEL_KEY', 'Qwen3.5-4B-Q4_K_M.gguf')
    messages: list[Message]
    max_tokens: Optional[int] = 4096
    temperature: Optional[float] = 0.7
    top_k: Optional[int] = 40
    top_p: Optional[float] = 0.9
    repeat_penalty: Optional[float] = 1.1
    stream: bool = True

@app.post("/v1/chat/completions")
async def handle_chat_completion(request: ChatCompletionRequest):
    completion_id = f"chatcmpl-{str(uuid.uuid4())}"
    created_timestamp = int(datetime.now().timestamp())

    # Build prompt using Qwen3.5 ChatML format
    # Prepend /no_think system message if no system message exists
    prompt_parts = []
    has_system = any(msg.role == "system" for msg in request.messages)
    if not has_system:
        prompt_parts.append("<|im_start|>system\n/no_think<|im_end|>\n")
    for msg in request.messages:
        prompt_parts.append(
            f"<|im_start|>{msg.role}\n{msg.content}<|im_end|>\n"
        )
    prompt_parts.append("<|im_start|>assistant\n")
    prompt = "".join(prompt_parts)

    response = llm.create_completion(
        prompt=prompt,
        max_tokens=request.max_tokens,
        temperature=request.temperature,
        top_k=request.top_k,
        top_p=request.top_p,
        repeat_penalty=request.repeat_penalty,
        stop=["<|im_start|>", "<|im_end|>", "<|endoftext|>"],
        stream=True
    )

    async def generate():
        for chunk in response:
            completion = chunk['choices'][0]
            if completion['finish_reason'] is None:
                chunk_data = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_timestamp,
                    "model": request.model,
                    "choices": [{
                        "delta": {"content": completion['text']},
                        "index": 0,
                        "finish_reason": None
                    }]
                }
                yield f"data: {json.dumps(chunk_data, ensure_ascii=False)}\n\n"
            else:
                final_chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_timestamp,
                    "model": request.model,
                    "choices": [{
                        "delta": {},
                        "index": 0,
                        "finish_reason": completion['finish_reason']
                    }]
                }
                yield f"data: {json.dumps(final_chunk, ensure_ascii=False)}\n\n"
                yield "data: [DONE]\n\n"

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(generate(), media_type="text/event-stream", headers=headers)
