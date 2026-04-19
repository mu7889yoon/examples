"""Stream response handler for Pyodide environment.

Uses js.fetch + ReadableStream via the js module.
Handles both SSE format (data: ...) and newline-delimited JSON.
"""

import json
from dataclasses import dataclass

import js
from pyodide.ffi import to_js


def parse_json_line(raw: str) -> dict | None:
    """JSON をパースし、二重エンコード時のみ再パースする。

    Args:
        raw: JSON 文字列。

    Returns:
        パース済み dict、またはパース失敗時は None。
    """
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return parsed
    except json.JSONDecodeError:
        return None


@dataclass
class ParseResult:
    """SSE 行パース結果。"""

    chunk: str  # 追加テキスト（空文字列の場合あり）
    done: bool  # ストリーム終了シグナル
    result: str  # result フィールド（全文置換用、空文字列の場合あり）


def parse_line(line: str) -> ParseResult | None:
    """SSE 行または NDJSON 行をパースし、ParseResult を返す。

    Args:
        line: 生テキスト行（strip 済み想定）。

    Returns:
        ParseResult or None（空行またはパース不能時）。
    """
    line = line.strip()
    if not line:
        return None

    # SSE 形式: "data: ..." プレフィックスを除去
    if line.startswith("data: "):
        line = line[6:]

    # [DONE] シグナル
    if line == "[DONE]":
        return ParseResult(chunk="", done=True, result="")

    # JSON パースを parse_json_line に委譲
    parsed = parse_json_line(line)
    if not isinstance(parsed, dict):
        return None

    chunk = parsed.get("chunk", "")
    done = bool(parsed.get("done", False))
    result = parsed.get("result", "")

    return ParseResult(chunk=chunk, done=done, result=result)


async def stream_sse_to_placeholder(
    url: str,
    headers: dict[str, str],
    body: str,
    placeholder,
) -> str:
    """ストリームレスポンスを読みながら placeholder にリアルタイム表示する。

    チャンクは一括で accumulated response に追加し、
    placeholder.markdown() を 1 チャンクにつき 1 回呼び出す。
    """
    fetch_options = to_js(
        {"method": "POST", "headers": headers, "body": body},
        dict_converter=js.Object.fromEntries,
    )

    response = await js.fetch(url, fetch_options)

    if not response.ok:
        error_text = await response.text()
        raise Exception(f"HTTP {response.status}: {error_text}")

    reader = response.body.getReader()
    decoder = js.TextDecoder.new("utf-8")
    buffer = ""
    full_response = ""

    while True:
        result = await reader.read()
        if result.done:
            break

        text = decoder.decode(result.value, to_js({"stream": True}))
        buffer += text
        lines = buffer.split("\n")
        buffer = lines.pop()

        for line in lines:
            pr = parse_line(line)
            if pr is None:
                continue
            if pr.done:
                return full_response
            if pr.result:
                full_response = pr.result
                placeholder.markdown(full_response)
            elif pr.chunk:
                full_response += pr.chunk
                placeholder.markdown(full_response + "▌")
        placeholder.markdown(full_response) if full_response else None

    # バッファに残ったデータを処理
    if buffer.strip():
        pr = parse_line(buffer)
        if pr is not None:
            if pr.result:
                full_response = pr.result
            elif pr.chunk:
                full_response += pr.chunk
            placeholder.markdown(full_response)

    return full_response
