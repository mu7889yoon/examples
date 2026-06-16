import io
import unittest
from unittest.mock import patch, MagicMock

from s3_docs import S3DocsRepository


class FakePaginator:
    def paginate(self, **_: object):
        return [
            {
                "Contents": [
                    {"Key": "docs/discord-operation.md"},
                    {"Key": "docs/faq.md"},
                ]
            }
        ]


class FakeS3Client:
    def get_paginator(self, name: str) -> FakePaginator:
        assert name == "list_objects_v2"
        return FakePaginator()

    def get_object(self, *, Bucket: str, Key: str):
        data = {
            "docs/discord-operation.md": "speaker ロールを付与します",
            "docs/faq.md": "確認中です",
        }
        return {"Body": io.BytesIO(data[Key].encode("utf-8"))}


class AppTest(unittest.TestCase):
    @patch("agent._get_repository")
    @patch("agent.Agent")
    def test_handle_event_returns_answer(self, mock_agent_cls: MagicMock, mock_repo: MagicMock) -> None:
        # Setup fake repository
        repository = S3DocsRepository(bucket="bucket", s3_client=FakeS3Client())
        mock_repo.return_value = repository

        # Setup fake agent that returns a canned response
        mock_agent_instance = MagicMock()
        mock_agent_instance.return_value = "speaker ロールを付与します。参照元: docs/discord-operation.md"
        mock_agent_cls.return_value = mock_agent_instance

        # Import after patching
        from app import handle_event

        result = handle_event({"question": "speaker ロールの命名ルールを教えて"})

        self.assertIn("speaker", result["answer"])
