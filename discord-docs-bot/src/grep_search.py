from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable


TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{2,}")


@dataclass(frozen=True)
class SearchHit:
    source: str
    snippet: str
    score: int


def tokenize_question(question: str) -> list[str]:
    seen: set[str] = set()
    tokens: list[str] = []
    for token in TOKEN_RE.findall(question.lower()):
        if token not in seen:
            seen.add(token)
            tokens.append(token)
    return tokens


def _extract_snippet(lines: list[str], line_index: int, window: int = 1) -> str:
    start = max(0, line_index - window)
    end = min(len(lines), line_index + window + 1)
    snippet = "\n".join(line.rstrip() for line in lines[start:end]).strip()
    return snippet[:800]


def search_documents(
    question: str,
    documents: dict[str, str],
    *,
    max_hits: int = 3,
) -> list[SearchHit]:
    tokens = tokenize_question(question)
    hits: list[SearchHit] = []

    for source, content in documents.items():
        lines = content.splitlines()
        normalized_source = source.lower()
        best_score = 0
        best_index = 0
        source_bonus = 0
        doc_total = 0
        for token in tokens:
            if token in normalized_source:
                source_bonus += 5
        for index, line in enumerate(lines):
            normalized_line = line.lower()
            line_score = 0
            for token in tokens:
                occurrences = normalized_line.count(token)
                line_score += occurrences
            doc_total += line_score
            if line_score > best_score:
                best_score = line_score
                best_index = index

        total_score = source_bonus + doc_total
        if total_score > 0:
            hits.append(
                SearchHit(
                    source=source,
                    snippet=_extract_snippet(lines, best_index),
                    score=total_score,
                )
            )
        elif content:
            hits.append(SearchHit(source=source, snippet=content[:400], score=0))

    hits.sort(key=lambda hit: (-hit.score, hit.source))
    return hits[:max_hits]


def build_context(hits: Iterable[SearchHit]) -> str:
    blocks = []
    for hit in hits:
        blocks.append(f"Source: {hit.source}\n{hit.snippet}")
    return "\n\n".join(blocks)
