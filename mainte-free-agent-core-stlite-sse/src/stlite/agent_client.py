"""AgentCore Runtime invocation module."""

import json
import re
import urllib.parse
from dataclasses import dataclass

from stlite.sigv4 import AWSCredentials, sign_request
from stlite.sse_handler import stream_sse_to_placeholder


@dataclass
class AgentError(Exception):
    """Structured error from AgentCore invocation."""

    status_code: int
    message: str


def classify_http_error(status_code: int) -> AgentError:
    """HTTP ステータスコードからエラーを分類する。

    Args:
        status_code: HTTP response status code (integer).

    Returns:
        AgentError with classified message.
    """
    if status_code == 403:
        message = "アクセスが拒否されました (403)。IAM 権限設定を確認してください。"
    elif status_code == 429:
        message = "リクエストが多すぎます (429)。しばらく待ってから再試行してください。"
    elif 500 <= status_code <= 599:
        message = f"サーバーエラーが発生しました: {status_code}"
    else:
        message = f"エラーが発生しました: HTTP {status_code}"
    return AgentError(status_code=status_code, message=message)


# Pattern to extract HTTP status code from sse_handler exception messages
_HTTP_STATUS_RE = re.compile(r"^HTTP (\d+):")


async def invoke_agent_runtime(
    credentials: AWSCredentials,
    agent_runtime_arn: str,
    prompt: str,
    session_id: str,
    region: str,
    placeholder=None,
) -> str:
    """AgentCore Runtime を SigV4 署名付きで呼び出し、SSE ストリームを処理する。

    Args:
        credentials: Cognito Identity Pool から取得した一時クレデンシャル。
        agent_runtime_arn: AgentCore Runtime ARN。
        prompt: ユーザーのプロンプト。
        session_id: 会話セッション ID（33〜256 文字）。
        region: AWS リージョン。
        placeholder: Streamlit の st.empty() プレースホルダー。

    Returns:
        AgentCore からの完全なレスポンステキスト。

    Raises:
        AgentError: HTTP エラーレスポンス時。
    """
    encoded_arn = urllib.parse.quote(agent_runtime_arn, safe="")
    url = (
        f"https://bedrock-agentcore.{region}.amazonaws.com"
        f"/runtimes/{encoded_arn}/invocations"
    )
    body = json.dumps({"prompt": prompt})

    signed_headers = sign_request(
        credentials=credentials,
        method="POST",
        url=url,
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
        },
        body=body,
        region=region,
    )

    # ブラウザの fetch は host ヘッダーを自動設定するため除外
    fetch_headers = {k: v for k, v in signed_headers.items() if k.lower() != "host"}

    try:
        return await stream_sse_to_placeholder(url, fetch_headers, body, placeholder)
    except Exception as exc:
        # sse_handler raises Exception("HTTP {status}: {error_text}") on non-ok response
        match = _HTTP_STATUS_RE.match(str(exc))
        if match:
            status_code = int(match.group(1))
            raise classify_http_error(status_code) from exc
        raise
