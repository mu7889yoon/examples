from __future__ import annotations

import os
from typing import Any

from strands import Agent, tool
from strands.models import BedrockModel

from grep_search import build_context, search_documents
from s3_docs import S3DocsRepository

SYSTEM_PROMPT = """\
あなたは Discord コミュニティの運営ドキュメントを案内するアシスタントです。
以下の制約を守ってください。
- 回答は日本語で簡潔に書く
- ドキュメントに根拠がないことは断定しない
- 必要なら「該当箇所が見つからない」と明記する
- 最後に参照元を 1 行で列挙する

## 出力フォーマット
Discord のメッセージとして投稿されるため、Discord の Markdown 記法を活用すること。
- **太字** で重要なキーワードを強調
- `コード` でコマンドや設定値を表記
- > 引用ブロックでドキュメントから抜粋する場合に使用
- 箇条書き (- または 1. 2. 3.) で手順やリストを整理
- ### 見出しで長い回答をセクション分け（必要な場合のみ）

## 手順
ユーザーからの質問に答えるには、まず search_docs ツールで関連ドキュメントを検索してください。
"""

# --- S3DocsRepository のシングルトン (Lambda コールドスタート対策) ---
_repository: S3DocsRepository | None = None


def _get_repository() -> S3DocsRepository:
    global _repository
    if _repository is None:
        _repository = S3DocsRepository()
    return _repository


# --- Strands カスタムツール ---


@tool
def search_docs(query: str) -> str:
    """コミュニティ運営ドキュメントをキーワード検索し、関連する箇所を返す。

    Args:
        query: 検索したいキーワードや質問文
    """
    repository = _get_repository()
    documents = repository.load_documents()
    hits = search_documents(query, documents)
    context = build_context(hits)
    sources = [hit.source for hit in hits]
    return f"{context}\n\n参照元: {', '.join(sources)}"


# --- Agent ファクトリ ---


def create_agent() -> Agent:
    model_id = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-20250514-v1:0")
    model = BedrockModel(
        model_id=model_id,
        max_tokens=600,
        temperature=0.2,
    )
    return Agent(
        model=model,
        tools=[search_docs],
        system_prompt=SYSTEM_PROMPT,
    )
