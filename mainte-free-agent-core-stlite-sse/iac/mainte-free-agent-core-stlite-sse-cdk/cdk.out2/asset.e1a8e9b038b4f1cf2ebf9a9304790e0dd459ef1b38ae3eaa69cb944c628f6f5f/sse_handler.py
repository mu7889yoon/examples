"""SSE stream parser for Pyodide environment.

Uses js.fetch + ReadableStream via the js module and pyodide.ffi.to_js
for Python dict → JS Object conversion. No requests dependency.
"""

import json

import js
from pyodide.ffi import to_js


async def stream_sse_to_placeholder(
    url: str,
    headers: dict[str, str],
    body: str,
    placeholder,
) -> str:
    """SSE ストリームを読みながら Streamlit の placeholder にリアルタイム表示する。

    Args:
        url: AgentCore Runtime endpoint URL.
        headers: SigV4-signed request headers.
        body: JSON request body.
        placeholder: Streamlit st.empty() placeholder for live updates.

    Returns:
        Full response text assembled from all chunks.

    Raises:
        Exception: If the HTTP response status is not ok.
    """
    fetch_options = to_js(
        {"method": "POST", "headers": headers, "body": body},
        dict_converter=js.Object.fromEntries,
    )

    response = await js.fetch(url, fetch_options)

    if not response.ok:
        raise Exception(f"HTTP {response.status}: {await response.text()}")

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
        buffer = lines.pop()  # 未完了の行をバッファに残す

        for line in lines:
            if line.startswith("data: "):
                data = line[6:]
                if data == "[DONE]":
                    return full_response
                parsed = json.loads(data)
                full_response += parsed.get("chunk", "")
                placeholder.markdown(full_response)

    return full_response
