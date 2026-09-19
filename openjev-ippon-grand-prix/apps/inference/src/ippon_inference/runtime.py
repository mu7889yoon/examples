"""MicroVM lifecycle state and one-at-a-time judge admission control."""

from __future__ import annotations

import asyncio
import threading
from enum import Enum

from .config import JudgeConfig, RuntimeConfig
from .engine import JudgeEngine, OptionScorer
from .llama_cpp import LlamaCppDirectScorer, LlamaCppServerConfig


class RuntimeState(str, Enum):
    INITIALIZING = "INITIALIZING"
    READY = "READY"
    RUNNING = "RUNNING"
    SUSPENDED = "SUSPENDED"
    TERMINATING = "TERMINATING"
    TERMINATED = "TERMINATED"
    FAILED = "FAILED"


class RuntimeBusyError(RuntimeError):
    pass


class InferenceRuntime:
    def __init__(self, config: RuntimeConfig, judges: tuple[JudgeConfig, ...], scorer: OptionScorer | None = None) -> None:
        self.config = config
        self.judges = judges
        if scorer is not None:
            self.scorer = scorer
        elif config.model.backend == "llama.cpp":
            # The server owns a single ARM64-native llama.cpp model context.
            # JudgeEngine controls requests, so the model never receives two
            # independent sessions simultaneously.
            self.scorer = LlamaCppDirectScorer(
                LlamaCppServerConfig(
                    config.model.llama_server_url or "http://127.0.0.1:8081",
                    config.model.option_token_ids,
                )
            )
        else:
            raise ValueError(f"unsupported inference backend: {config.model.backend}")
        self.engine = JudgeEngine(config, judges, self.scorer)
        self._state = RuntimeState.INITIALIZING
        self._judge_lock = threading.Lock()

    @property
    def state(self) -> RuntimeState:
        return self._state

    @property
    def accepting_judges(self) -> bool:
        return self._state == RuntimeState.RUNNING

    async def ready(self) -> None:
        if self._state in {RuntimeState.TERMINATING, RuntimeState.TERMINATED}:
            raise RuntimeError("runtime is terminating")
        self._state = RuntimeState.READY

    async def validate(self) -> None:
        if not self.judges:
            raise RuntimeError("no judges loaded")
        if self._state in {RuntimeState.TERMINATING, RuntimeState.TERMINATED}:
            raise RuntimeError("runtime is terminating")

    async def run(self) -> None:
        if self._state in {RuntimeState.TERMINATING, RuntimeState.TERMINATED}:
            raise RuntimeError("runtime is terminating")
        load = getattr(self.scorer, "load", None)
        if load is not None:
            await asyncio.to_thread(load)
        self._state = RuntimeState.RUNNING

    async def suspend(self) -> None:
        if self._state == RuntimeState.RUNNING:
            self._state = RuntimeState.SUSPENDED

    async def resume(self) -> None:
        if self._state == RuntimeState.SUSPENDED:
            self._state = RuntimeState.RUNNING

    async def terminate(self) -> None:
        self._state = RuntimeState.TERMINATING
        # An admitted request is allowed to finish its stream; the hook only
        # stops new admissions.  If no stream is active we can terminate now.
        if self._judge_lock.acquire(blocking=False):
            self._judge_lock.release()
            self._state = RuntimeState.TERMINATED

    def acquire_judge(self) -> None:
        if not self.accepting_judges or not self._judge_lock.acquire(blocking=False):
            raise RuntimeBusyError("runtime is unavailable or another judge request is active")

    def release_judge(self) -> None:
        if self._judge_lock.locked():
            self._judge_lock.release()
        if self._state == RuntimeState.TERMINATING:
            self._state = RuntimeState.TERMINATED
