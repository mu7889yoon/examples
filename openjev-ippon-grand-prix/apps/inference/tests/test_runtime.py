from __future__ import annotations

import unittest

from ippon_inference.config import (
    DecisionConfig,
    JudgeConfig,
    ModelConfig,
    RuntimeConfig,
    ScoringConfig,
    StateConfig,
)
from ippon_inference.runtime import InferenceRuntime, RuntimeBusyError, RuntimeState
from ippon_inference.llama_cpp import LlamaCppDirectScorer


class FakeScorer:
    loaded = False

    def load(self) -> None:
        self.loaded = True

    def score(self, row: dict) -> list[float]:
        return [0.5, 0.5]


def config() -> RuntimeConfig:
    return RuntimeConfig(
        version=1,
        duration_seconds=3600,
        model=ModelConfig("fake", "local-model", "local-manifest"),
        state=StateConfig("system", "ja", "context"),
        decision=DecisionConfig("question", "笑う", "笑わない", 0.5),
        scoring=ScoringConfig(0.5, 1),
    )


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def test_selects_native_llama_cpp_scorer_from_model_config(self) -> None:
        runtime_config = config()
        native_model = ModelConfig(
            runtime_config.model.name,
            runtime_config.model.source,
            runtime_config.model.revision,
            backend="llama.cpp",
            llama_server_url="http://127.0.0.1:8081",
            option_token_ids=(54, 55),
            gguf_file="model.gguf",
        )
        native_config = RuntimeConfig(
            runtime_config.version,
            runtime_config.duration_seconds,
            native_model,
            runtime_config.state,
            runtime_config.decision,
            runtime_config.scoring,
        )
        runtime = InferenceRuntime(native_config, (JudgeConfig("judge-001", "one", "persona"),))
        self.assertIsInstance(runtime.scorer, LlamaCppDirectScorer)

    async def test_lifecycle_and_single_active_judge(self) -> None:
        scorer = FakeScorer()
        runtime = InferenceRuntime(config(), (JudgeConfig("judge-001", "one", "persona"),), scorer)
        await runtime.ready()
        await runtime.validate()
        await runtime.run()
        self.assertTrue(scorer.loaded)
        self.assertEqual(runtime.state, RuntimeState.RUNNING)
        runtime.acquire_judge()
        with self.assertRaises(RuntimeBusyError):
            runtime.acquire_judge()
        runtime.release_judge()
        await runtime.terminate()
        with self.assertRaises(RuntimeBusyError):
            runtime.acquire_judge()


if __name__ == "__main__":
    unittest.main()
