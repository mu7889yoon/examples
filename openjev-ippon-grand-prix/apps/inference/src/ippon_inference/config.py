"""Strict, dependency-free configuration loading for the inference runtime."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path


class ConfigError(ValueError):
    """A configuration is missing a required value or contains an unsafe one."""


@dataclass(frozen=True)
class ModelConfig:
    name: str
    source: str
    revision: str
    path: str | None = None
    backend: str = "llama.cpp"
    llama_server_url: str | None = None
    option_token_ids: tuple[int, ...] = ()
    gguf_file: str | None = None
    expected_bytes: int | None = None
    sha256: str | None = None


@dataclass(frozen=True)
class StateConfig:
    system: str
    language: str
    context: str


@dataclass(frozen=True)
class DecisionConfig:
    question: str
    laugh_option: str
    not_laugh_option: str
    laugh_probability_threshold: float


@dataclass(frozen=True)
class ScoringConfig:
    ippon_threshold_ratio: float
    max_parallel_judges: int


@dataclass(frozen=True)
class RuntimeConfig:
    version: int
    duration_seconds: int
    model: ModelConfig
    state: StateConfig
    decision: DecisionConfig
    scoring: ScoringConfig


@dataclass(frozen=True)
class JudgeConfig:
    id: str
    name: str
    persona: str


def _object(value: object, field: str) -> dict:
    if not isinstance(value, dict):
        raise ConfigError(f"{field} must be an object")
    return value


def _string(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{field} must be a nonempty string")
    return value


def _ratio(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (float, int)):
        raise ConfigError(f"{field} must be a number between 0 and 1")
    result = float(value)
    if not math.isfinite(result) or not 0 <= result <= 1:
        raise ConfigError(f"{field} must be a finite number between 0 and 1")
    return result


def _positive_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ConfigError(f"{field} must be a positive integer")
    return value


def _token_ids(value: object, field: str) -> tuple[int, ...]:
    if not isinstance(value, list) or not 2 <= len(value) <= 16:
        raise ConfigError(f"{field} must contain 2 to 16 token IDs")
    if any(isinstance(item, bool) or not isinstance(item, int) or item < 0 for item in value):
        raise ConfigError(f"{field} must contain non-negative integers")
    if len(value) != len(set(value)):
        raise ConfigError(f"{field} must not contain duplicate token IDs")
    return tuple(value)


def _read_json(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8") as handle:
            return _object(json.load(handle), str(path))
    except OSError as error:
        raise ConfigError(f"cannot read {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise ConfigError(f"invalid JSON in {path}: {error}") from error


def load_runtime_config(path: str | Path) -> RuntimeConfig:
    """Load global settings; reject unpinned remote model sources."""
    data = _read_json(Path(path))
    session = _object(data.get("session"), "session")
    model = _object(data.get("model"), "model")
    state = _object(data.get("state"), "state")
    decision = _object(data.get("decision"), "decision")
    scoring = _object(data.get("scoring"), "scoring")
    options = decision.get("options")
    if not isinstance(options, list) or len(options) != 2:
        raise ConfigError("decision.options must contain exactly two strings")
    laugh_option, not_laugh_option = (
        _string(value, f"decision.options[{index}]") for index, value in enumerate(options)
    )
    if laugh_option == not_laugh_option:
        raise ConfigError("decision.options must be distinct")
    source = _string(model.get("source") or model.get("path"), "model.source")
    revision = _string(model.get("revision"), "model.revision")
    # OpenJev itself enforces a 40-char SHA for remote sources.  Validate it here
    # so a MicroVM never starts with a floating model version.
    if not Path(source).exists() and (len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision)):
        raise ConfigError("model.revision must be a 40-character lowercase commit SHA for remote sources")
    backend = model.get("backend", "llama.cpp")
    if backend != "llama.cpp":
        raise ConfigError("model.backend must be llama.cpp")
    llama_server_url: str | None = None
    option_token_ids: tuple[int, ...] = ()
    gguf_file: str | None = None
    expected_bytes: int | None = None
    sha256: str | None = None
    llama_server_url = _string(model.get("llamaServerUrl"), "model.llamaServerUrl")
    option_token_ids = _token_ids(model.get("optionTokenIds"), "model.optionTokenIds")
    gguf_file = _string(model.get("ggufFile"), "model.ggufFile")
    expected_bytes = _positive_int(model.get("expectedBytes"), "model.expectedBytes")
    sha256 = _string(model.get("sha256"), "model.sha256")
    if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
        raise ConfigError("model.sha256 must be a 64-character lowercase SHA-256 digest")
    version = _positive_int(data.get("version"), "version")
    return RuntimeConfig(
        version=version,
        duration_seconds=_positive_int(session.get("durationSeconds"), "session.durationSeconds"),
        model=ModelConfig(
            name=_string(model.get("name"), "model.name"),
            source=source,
            revision=revision,
            path=model.get("path") if isinstance(model.get("path"), str) else None,
            backend=backend,
            llama_server_url=llama_server_url,
            option_token_ids=option_token_ids,
            gguf_file=gguf_file,
            expected_bytes=expected_bytes,
            sha256=sha256,
        ),
        state=StateConfig(
            system=_string(state.get("system"), "state.system"),
            language=_string(state.get("language"), "state.language"),
            context=_string(state.get("context"), "state.context"),
        ),
        decision=DecisionConfig(
            question=_string(decision.get("question"), "decision.question"),
            laugh_option=laugh_option,
            not_laugh_option=not_laugh_option,
            laugh_probability_threshold=_ratio(
                decision.get("laughProbabilityThreshold"), "decision.laughProbabilityThreshold"
            ),
        ),
        scoring=ScoringConfig(
            ippon_threshold_ratio=_ratio(scoring.get("ipponThresholdRatio"), "scoring.ipponThresholdRatio"),
            max_parallel_judges=_positive_int(scoring.get("maxParallelJudges", 4), "scoring.maxParallelJudges"),
        ),
    )


def load_judges(directory: str | Path) -> tuple[JudgeConfig, ...]:
    """Load every judge JSON file in stable name order and reject duplicate IDs."""
    folder = Path(directory)
    if not folder.is_dir():
        raise ConfigError(f"judges directory does not exist: {folder}")
    judges: list[JudgeConfig] = []
    for path in sorted(folder.glob("*.json")):
        data = _read_json(path)
        judges.append(
            JudgeConfig(
                id=_string(data.get("id"), f"{path}.id"),
                name=_string(data.get("name"), f"{path}.name"),
                persona=_string(data.get("persona"), f"{path}.persona"),
            )
        )
    if not judges:
        raise ConfigError(f"no judge JSON files found in {folder}")
    ids = [judge.id for judge in judges]
    if len(ids) != len(set(ids)):
        raise ConfigError("judge ids must be unique")
    return tuple(judges)
