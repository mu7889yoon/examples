"""The small adapter that binds IPPON inputs to OpenJev direct scoring."""

from __future__ import annotations

from typing import Protocol

from .config import ModelConfig


class OptionScorer(Protocol):
    def score(self, row: dict) -> list[float]:
        """Return probabilities in the same order as row['options']."""


class OpenJevDirectScorer:
    """Lazy OpenJev scorer; imports heavy GPU dependencies only on first run."""

    def __init__(self, model_config: ModelConfig) -> None:
        self._config = model_config
        self._model = None
        self._tokenizer = None
        self._metadata = None

    def load(self) -> None:
        if self._model is not None:
            return
        from semif_phase1.core import load_causal_model

        self._model, self._tokenizer, self._metadata = load_causal_model(
            self._config.source, self._config.revision
        )

    def score(self, row: dict) -> list[float]:
        self.load()
        from semif_phase1.direct import score

        result = score(self._model, self._tokenizer, row, self._metadata)
        probabilities = result["probabilities"]
        if not isinstance(probabilities, list) or len(probabilities) != 2:
            raise RuntimeError("OpenJev direct scorer returned an invalid option probability vector")
        return [float(value) for value in probabilities]
