from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from ippon_inference.llama_cpp import LlamaCppDirectScorer, LlamaCppServerConfig, LlamaCppServerError, _messages


class _Response:
    status = 200

    def __init__(self, payload: object) -> None:
        self._payload = json.dumps(payload).encode()

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> _Response:
        return self

    def __exit__(self, *args: object) -> None:
        return None


class LlamaCppDirectScorerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.row = {
            "id": "judge-001",
            "state": {"topic": "お題", "answer": "回答"},
            "question": "Judge persona: 客\n\n笑いますか？",
            "options": [
                {"id": "laugh", "description": "笑う"},
                {"id": "not_laugh", "description": "笑わない"},
            ],
        }
        self.scorer = LlamaCppDirectScorer(LlamaCppServerConfig("http://127.0.0.1:8081", (54, 55)))

    def test_preserves_openjev_direct_options_v1_prompt(self) -> None:
        messages = _messages(self.row)
        self.assertEqual(messages[0]["content"], "Apply the supplied criterion to the supplied evidence. Choose exactly one listed option. Respond with only its uppercase letter, with no explanation or reasoning.")
        payload = json.loads(messages[1]["content"])
        self.assertEqual(payload["evidence"], self.row["state"])
        self.assertEqual(payload["criterion"], self.row["question"])
        self.assertEqual(payload["options"], [{"letter": "A", "description": "笑う"}, {"letter": "B", "description": "笑わない"}])
        self.assertIn('"evidence": {"topic": "お題", "answer": "回答"}', messages[1]["content"])

    @patch("ippon_inference.llama_cpp.urlopen")
    def test_reads_option_logprobs_and_normalizes_declared_options_only(self, open_url: object) -> None:
        open_url.side_effect = [  # type: ignore[attr-defined]
            _Response({"status": "ok"}),
            _Response({"content": "A"}),
            _Response({"content": "B"}),
            _Response({"choices": [{"logprobs": {"content": [{"top_logprobs": [
                {"token": "A", "logprob": -0.1}, {"token": "B", "logprob": -2.1}
            ]}]}}]}),
        ]
        self.scorer.load()
        probabilities = self.scorer.score(self.row)
        self.assertAlmostEqual(probabilities[0], 0.8807970779)
        self.assertAlmostEqual(probabilities[1], 0.1192029220)
        completion = json.loads(open_url.call_args_list[3].args[0].data)  # type: ignore[attr-defined]
        self.assertEqual(completion["logit_bias"], {"54": 100, "55": 100})
        self.assertEqual(completion["grammar"], 'root ::= "A" | "B"')

    @patch("ippon_inference.llama_cpp.urlopen")
    def test_rejects_tokenizer_mapping_that_does_not_match_the_gguf(self, open_url: object) -> None:
        open_url.side_effect = [_Response({"status": "ok"}), _Response({"content": "B"})]  # type: ignore[attr-defined]
        with self.assertRaisesRegex(LlamaCppServerError, "54"):
            self.scorer.load()

    @patch("ippon_inference.llama_cpp.urlopen")
    def test_rejects_missing_option_logprob(self, open_url: object) -> None:
        open_url.return_value = _Response({"choices": [{"logprobs": {"content": [{"top_logprobs": [
            {"token": "A", "logprob": -0.1}
        ]}]}}]})  # type: ignore[attr-defined]
        with self.assertRaisesRegex(LlamaCppServerError, "B"):
            self.scorer.score(self.row)


if __name__ == "__main__":
    unittest.main()
