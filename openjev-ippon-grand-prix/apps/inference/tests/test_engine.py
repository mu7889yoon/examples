from __future__ import annotations

import asyncio
import unittest

from ippon_inference.config import (
    DecisionConfig,
    JudgeConfig,
    ModelConfig,
    RuntimeConfig,
    ScoringConfig,
    StateConfig,
)
from ippon_inference.engine import JudgeEngine


def config(*, ratio: float = 0.5) -> RuntimeConfig:
    return RuntimeConfig(
        version=1,
        duration_seconds=3600,
        model=ModelConfig("fake", "local-model", "local-manifest"),
        state=StateConfig("system", "ja", "context"),
        decision=DecisionConfig("笑いますか？", "笑う", "笑わない", 0.5),
        scoring=ScoringConfig(ratio, 3),
    )


class FakeScorer:
    def __init__(self, results: dict[str, float]) -> None:
        self.results = results

    def score(self, row: dict) -> list[float]:
        # A small, different delay verifies that SSE uses completion order.
        delays = {"judge-001": 0.03, "judge-002": 0.01, "judge-003": 0.02}
        import time

        time.sleep(delays[row["id"]])
        probability = self.results[row["id"]]
        return [probability, 1 - probability]


class JudgeEngineTests(unittest.IsolatedAsyncioTestCase):
    async def test_streams_all_judges_and_only_one_ippon(self) -> None:
        judges = tuple(JudgeConfig(f"judge-{number:03d}", str(number), "persona") for number in range(1, 4))
        engine = JudgeEngine(config(), judges, FakeScorer({"judge-001": 0.9, "judge-002": 0.1, "judge-003": 0.8}))

        events = [event async for event in engine.events("お題", "回答")]

        self.assertEqual([event["event"] for event in events], ["start", "judge", "judge", "judge", "ippon", "complete"])
        judges_emitted = [event["data"]["id"] for event in events if event["event"] == "judge"]
        self.assertEqual(judges_emitted, ["judge-002", "judge-003", "judge-001"])
        self.assertEqual(events[0]["data"]["requiredLaughCount"], 2)
        self.assertEqual(events[-1]["data"], {"laughCount": 2, "judgeCount": 3, "score": 1.8, "ippon": True})

    async def test_ippon_zero_ratio_is_emitted_on_first_completion(self) -> None:
        judges = (JudgeConfig("judge-001", "one", "persona"),)
        engine = JudgeEngine(config(ratio=0), judges, FakeScorer({"judge-001": 0.1}))
        events = [event async for event in engine.events("お題", "回答")]
        self.assertEqual([event["event"] for event in events], ["start", "judge", "ippon", "complete"])
        self.assertEqual(events[2]["data"]["requiredLaughCount"], 0)


if __name__ == "__main__":
    unittest.main()
