"""Parallel Judge execution and contract-compatible SSE event production."""

from __future__ import annotations

import asyncio
import math
from collections.abc import AsyncIterator
from typing import Any

from .config import JudgeConfig, RuntimeConfig
from .openjev import OptionScorer


class JudgeEngine:
    def __init__(self, config: RuntimeConfig, judges: tuple[JudgeConfig, ...], scorer: OptionScorer) -> None:
        self._config = config
        self._judges = judges
        self._scorer = scorer

    @property
    def judge_count(self) -> int:
        return len(self._judges)

    def _shared_state(self, topic: str, answer: str) -> dict[str, str]:
        """Build the state shared by all judges for one submitted answer."""
        return {
            "system": self._config.state.system,
            "language": self._config.state.language,
            "context": self._config.state.context,
            "topic": topic,
            "answer": answer,
        }

    def _row(self, judge: JudgeConfig, state: dict[str, str]) -> dict[str, Any]:
        # The persona is the only judge-specific criterion added to this shared
        # evidence payload.  Future KV-cache prefix reuse can use the same split.
        return {
            "id": judge.id,
            "state": state,
            "question": f"Judge persona: {judge.persona}\n\n{self._config.decision.question}",
            "options": [
                {"id": "laugh", "description": self._config.decision.laugh_option},
                {"id": "not_laugh", "description": self._config.decision.not_laugh_option},
            ],
        }

    async def _score_one(
        self, semaphore: asyncio.Semaphore, judge: JudgeConfig, shared_state: dict[str, str]
    ) -> tuple[JudgeConfig, float]:
        async with semaphore:
            probabilities = await asyncio.to_thread(self._scorer.score, self._row(judge, shared_state))
        if len(probabilities) != 2 or any(not math.isfinite(value) for value in probabilities):
            raise RuntimeError(f"Judge {judge.id} returned invalid probabilities")
        probability = float(probabilities[0])
        if not 0 <= probability <= 1:
            raise RuntimeError(f"Judge {judge.id} returned P(laugh) outside [0, 1]")
        return judge, probability

    async def events(self, topic: str, answer: str) -> AsyncIterator[dict[str, Any]]:
        """Produce start/judge/ippon/complete in contract order.

        Tasks are created together and each completed result is emitted immediately.
        IPPON never cancels remaining tasks: the final event always reflects every
        configured judge.
        """
        required = math.ceil(self.judge_count * self._config.scoring.ippon_threshold_ratio)
        yield {
            "event": "start",
            "data": {
                "judgeCount": self.judge_count,
                "requiredLaughCount": required,
                "ipponThresholdRatio": self._config.scoring.ippon_threshold_ratio,
            },
        }
        semaphore = asyncio.Semaphore(self._config.scoring.max_parallel_judges)
        shared_state = self._shared_state(topic, answer)
        tasks = [
            asyncio.create_task(self._score_one(semaphore, judge, shared_state))
            for judge in self._judges
        ]
        completed = 0
        laughed_count = 0
        score = 0.0
        ippon = False
        try:
            for task in asyncio.as_completed(tasks):
                judge, probability = await task
                completed += 1
                score += probability
                laughed = probability >= self._config.decision.laugh_probability_threshold
                if laughed:
                    laughed_count += 1
                yield {
                    "event": "judge",
                    "data": {
                        "id": judge.id,
                        "probability": probability,
                        "laughed": laughed,
                        "completedCount": completed,
                        "laughCount": laughed_count,
                        "judgeCount": self.judge_count,
                    },
                }
                if not ippon and laughed_count >= required:
                    ippon = True
                    yield {
                        "event": "ippon",
                        "data": {
                            "laughCount": laughed_count,
                            "requiredLaughCount": required,
                            "judgeCount": self.judge_count,
                        },
                    }
            yield {
                "event": "complete",
                "data": {
                    "laughCount": laughed_count,
                    "judgeCount": self.judge_count,
                    "score": score,
                    "ippon": ippon,
                },
            }
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
