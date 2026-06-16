import unittest

from grep_search import build_context, search_documents, tokenize_question


class GrepSearchTest(unittest.TestCase):
    def test_tokenize_question_deduplicates_tokens(self) -> None:
        self.assertEqual(tokenize_question("speaker role speaker"), ["speaker", "role"])

    def test_search_documents_prioritizes_filename_and_hits(self) -> None:
        documents = {
            "docs/faq.md": "案内文です",
            "docs/discord-operation.md": "speaker ロールを付与します\nspeaker に通知します",
        }
        hits = search_documents("speaker role", documents)
        self.assertEqual(hits[0].source, "docs/discord-operation.md")
        self.assertGreaterEqual(hits[0].score, 2)

    def test_build_context_contains_sources(self) -> None:
        documents = {
            "docs/faq.md": "確認中です",
        }
        hits = search_documents("未ヒット", documents, max_hits=1)
        context = build_context(hits)
        self.assertIn("Source: docs/faq.md", context)
