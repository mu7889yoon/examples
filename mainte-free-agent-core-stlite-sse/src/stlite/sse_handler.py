"""Stream response handler for Pyodide environment.

Uses js.fetch + ReadableStream via the js module.
Handles both SSE format (data: ...) and newline-delimited JSON.
"""

import asyncio
import json

import js
from pyodide.ffi import to_js


async def stream_sse_to_placeholder(
    url: str,
    headers: dict[str, str],
    body: str,
    placeholder,
) -> str:
    """ストリームレスポンスを読みながら Streamlit の placeholder にリアルタイム表示する。"""
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

    def _parse(raw):
        """JSON をパースし、二重エンコード対応。"""
        parsed = json.loads(raw)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return parsed

    while True:
        result = await reader.read()
        if result.done:
            break

        text = decoder.decode(result.value, to_js({"stream": True}))
        buffer += text
        lines = buffer.split("\n")
        buffer = lines.pop()

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # SSE 形式: "data: {...}"
            if line.startswith("data: "):
                data = line[6:]
                if data == "[DONE]":
                    return full_response
                try:
                    parsed = _parse(data)
                    chunk = parsed.get("chunk", "")
                    for ch in chunk:
                        full_response += ch
                        placeholder.markdown(full_response + "▌")
                        await asyncio.sleep(0.05)
                    placeholder.markdown(full_response)
                except (json.JSONDecodeError, AttributeError):
                    pass
                continue

            # 改行区切り JSON: "{...}"
            try:
                parsed = _parse(line)
                if isinstance(parsed, dict) and parsed.get("done"):
                    return full_response
                if isinstance(parsed, dict):
                    chunk = parsed.get("chunk", "")
                    if chunk:
                        for ch in chunk:
                            full_response += ch
                            placeholder.markdown(full_response + "▌")
                            await asyncio.sleep(0.05)
                        placeholder.markdown(full_response)
                    result_text = parsed.get("result", "")
                    if result_text:
                        full_response = result_text
                        placeholder.markdown(full_response)
            except (json.JSONDecodeError, AttributeError):
                pass

    # バッファに残ったデータを処理
    if buffer.strip():
        try:
            parsed = _parse(buffer.strip())
            if isinstance(parsed, dict):
                chunk = parsed.get("chunk", parsed.get("result", ""))
                if chunk:
                    for ch in chunk:
                        full_response += ch
                        placeholder.markdown(full_response + "▌")
                        await asyncio.sleep(0.05)
                    placeholder.markdown(full_response)
        except (json.JSONDecodeError, AttributeError):
            pass

    return full_response
