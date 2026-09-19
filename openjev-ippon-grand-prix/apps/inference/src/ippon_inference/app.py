"""ASGI application for the inference endpoint and Lambda MicroVM hooks."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from .config import ConfigError, load_judges, load_runtime_config
from .runtime import InferenceRuntime, RuntimeBusyError


class JudgeRequest(BaseModel):
    topic: str = Field(min_length=1, max_length=4_000)
    answer: str = Field(min_length=1, max_length=4_000)


def _sse(event: dict) -> bytes:
    return f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False, separators=(',', ':'))}\n\n".encode()


def create_app(runtime: InferenceRuntime | None = None) -> FastAPI:
    if runtime is None:
        try:
            config = load_runtime_config(os.environ.get("INFERENCE_CONFIG", "/app/configs/config.json"))
            judges = load_judges(os.environ.get("INFERENCE_JUDGES_DIR", "/app/configs/judges"))
            runtime = InferenceRuntime(config, judges)
        except ConfigError as error:
            # Do not fail import-time health diagnostics; lifecycle validate/run
            # reports the configuration error before the MicroVM is admitted.
            raise RuntimeError(f"invalid inference configuration: {error}") from error

    app = FastAPI(title="AI IPPON Inference Runtime", docs_url=None, redoc_url=None)
    app.state.runtime = runtime

    @app.get("/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "state": runtime.state.value,
            "acceptingJudges": runtime.accepting_judges,
            "judgeCount": runtime.engine.judge_count,
            "model": runtime.config.model.name,
        }

    @app.post("/judge")
    async def judge(request: JudgeRequest) -> StreamingResponse:
        try:
            runtime.acquire_judge()
        except RuntimeBusyError as error:
            raise HTTPException(status_code=409, detail="BUSY") from error

        async def stream() -> AsyncIterator[bytes]:
            try:
                async for event in runtime.engine.events(request.topic, request.answer):
                    yield _sse(event)
            finally:
                runtime.release_judge()

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    def hook(operation: str):
        async def endpoint() -> JSONResponse:
            try:
                await getattr(runtime, operation)()
            except RuntimeError as error:
                raise HTTPException(status_code=409, detail=str(error)) from error
            return JSONResponse({"state": runtime.state.value})

        return endpoint

    prefix = "/aws/lambda-microvms/runtime/v1"
    app.add_api_route(f"{prefix}/ready", hook("ready"), methods=["POST"])
    app.add_api_route(f"{prefix}/validate", hook("validate"), methods=["POST"])
    app.add_api_route(f"{prefix}/run", hook("run"), methods=["POST"])
    app.add_api_route(f"{prefix}/suspend", hook("suspend"), methods=["POST"])
    app.add_api_route(f"{prefix}/resume", hook("resume"), methods=["POST"])
    app.add_api_route(f"{prefix}/terminate", hook("terminate"), methods=["POST"])
    return app
