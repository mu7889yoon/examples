"""OpenJev direct-option scoring through a local ``llama-server`` process.

The browser implementation in the pinned OpenJev revision uses wllama, which
is llama.cpp compiled to WebAssembly.  A Lambda MicroVM does not need a browser
or WebGPU: it runs the same GGUF model with llama.cpp's ARM64 CPU backend.

``llama-server`` exposes an OpenAI-compatible chat endpoint.  We force exactly
one of OpenJev's A..P answer-slot tokens, request its top log probabilities,
and normalize *only* the declared slots.  Adding the same logit bias to every
slot does not alter that conditional distribution; it only makes the two slots
available in the returned top-logprob vector.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen


LETTERS = "ABCDEFGHIJKLMNOP"
PROMPT_VERSION = "direct-options-v1"
DIRECT_SYSTEM = (
    "Apply the supplied criterion to the supplied evidence. Choose exactly one listed option. "
    "Respond with only its uppercase letter, with no explanation or reasoning."
)


class LlamaCppServerError(RuntimeError):
    """The native llama.cpp scorer is unavailable or returned an invalid result."""


@dataclass(frozen=True)
class LlamaCppServerConfig:
    """Connection and tokenizer information for one pinned GGUF model.

    ``option_token_ids`` are model-tokenizer specific.  They are intentionally
    configuration, rather than guessed from a tokenizer family.  The image
    build verifies them with ``/detokenize`` before becoming ready.
    """

    url: str
    option_token_ids: tuple[int, ...]
    timeout_seconds: float = 120.0


def _softmax(values: list[float]) -> list[float]:
    if len(values) < 2 or any(not math.isfinite(value) for value in values):
        raise LlamaCppServerError("llama.cpp returned non-finite option log probabilities")
    maximum = max(values)
    weights = [math.exp(value - maximum) for value in values]
    total = sum(weights)
    return [weight / total for weight in weights]


def _messages(row: dict[str, Any]) -> list[dict[str, str]]:
    """Render the exact OpenJev ``direct-options-v1`` message contract."""
    options = row.get("options")
    if not isinstance(options, list) or not 2 <= len(options) <= len(LETTERS):
        raise LlamaCppServerError("OpenJev rows require 2 to 16 options")
    if not isinstance(row.get("id"), str) or not isinstance(row.get("question"), str):
        raise LlamaCppServerError("OpenJev rows need string id and question")
    state = row.get("state")
    if not isinstance(state, (str, dict, list)) or not state:
        raise LlamaCppServerError("OpenJev row state must be a nonempty string, object, or array")
    rendered_options: list[dict[str, str]] = []
    for index, option in enumerate(options):
        if not isinstance(option, dict) or not isinstance(option.get("description"), str):
            raise LlamaCppServerError("every OpenJev option needs a string description")
        rendered_options.append({"letter": LETTERS[index], "description": option["description"]})
    payload = {"evidence": state, "criterion": row["question"], "options": rendered_options}
    return [
        {"role": "system", "content": DIRECT_SYSTEM},
        # Keep json.dumps defaults to preserve the upstream direct-options-v1
        # prompt bytes (and therefore its prompt hash) exactly.
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


class LlamaCppDirectScorer:
    """CPU-native replacement for OpenJev's CUDA/Transformers scorer."""

    def __init__(self, config: LlamaCppServerConfig) -> None:
        self._config = config

    def _request(self, path: str, body: dict[str, Any] | None = None) -> Any:
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        request = Request(
            f"{self._config.url.rstrip('/')}{path}",
            data=data,
            headers={"Content-Type": "application/json"} if data is not None else {},
            method="POST" if data is not None else "GET",
        )
        try:
            with urlopen(request, timeout=self._config.timeout_seconds) as response:  # noqa: S310 -- fixed loopback URL in image
                if not 200 <= response.status < 300:
                    raise LlamaCppServerError(f"llama.cpp {path} returned HTTP {response.status}")
                return json.loads(response.read())
        except (OSError, URLError, json.JSONDecodeError) as error:
            raise LlamaCppServerError(f"llama.cpp {path} is unavailable: {error}") from error

    def load(self) -> None:
        """Fail MicroVM ``/run`` early until the local model server is ready."""
        self._request("/health")
        if len(self._config.option_token_ids) < 2:
            raise LlamaCppServerError("at least two configured llama.cpp answer-slot token IDs are required")
        # Token IDs are not portable between GGUFs.  Verify the configured
        # mapping against the loaded model before the MicroVM accepts traffic.
        # llama-server returns ``content`` for current releases and ``text``
        # for older releases, so accept only those documented string forms.
        for label, token_id in zip(LETTERS, self._config.option_token_ids):
            decoded = self._request("/detokenize", {"tokens": [token_id]})
            text = decoded.get("content", decoded.get("text")) if isinstance(decoded, dict) else None
            if text != label:
                raise LlamaCppServerError(
                    f"configured llama.cpp token ID {token_id} does not decode to answer slot {label!r}"
                )

    def score(self, row: dict[str, Any]) -> list[float]:
        option_count = len(row.get("options", []))
        if option_count > len(self._config.option_token_ids):
            raise LlamaCppServerError("configured llama.cpp answer-slot token IDs do not cover this row")
        labels = list(LETTERS[:option_count])
        # This mirrors the wllama/OpenJev browser direct readout.  Equal bias
        # preserves pairwise logits, while the grammar prevents a non-option
        # token from consuming the single completion.
        response = self._request(
            "/v1/chat/completions",
            {
                "messages": _messages(row),
                "max_tokens": 1,
                "temperature": 1,
                "top_k": 0,
                "top_p": 1,
                "logprobs": True,
                "top_logprobs": option_count,
                "logit_bias": {
                    str(token_id): 100 for token_id in self._config.option_token_ids[:option_count]
                },
                "grammar": "root ::= " + " | ".join(f'\"{label}\"' for label in labels),
                "cache_prompt": False,
                "chat_template_kwargs": {"enable_thinking": False},
            },
        )
        try:
            entries = response["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
        except (KeyError, IndexError, TypeError) as error:
            raise LlamaCppServerError("llama.cpp did not return first-token log probabilities") from error
        by_label: dict[str, float] = {}
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            token = entry.get("token")
            logprob = entry.get("logprob")
            if token in labels and isinstance(logprob, (int, float)) and math.isfinite(logprob):
                by_label[token] = float(logprob)
        missing = [label for label in labels if label not in by_label]
        if missing:
            raise LlamaCppServerError(f"llama.cpp omitted direct option log probabilities: {', '.join(missing)}")
        return _softmax([by_label[label] for label in labels])
