"""Main Streamlit application for AgentCore chat.

Integrates cookie-based authentication, Cognito Identity Pool credentials,
SigV4 signing, and SSE streaming in a Pyodide (stlite) environment.
"""

import asyncio
import json
import time
import urllib.parse
import uuid

import streamlit as st

from stlite.cookie_parser import get_id_token_from_cookie
from stlite.credentials import get_credentials_from_identity_pool
from stlite.sigv4 import AWSCredentials, sign_request
from stlite.sse_handler import stream_sse_to_placeholder

# --- 設定値（CDK Output から取得してデプロイ前に書き換える） ---
USER_POOL_ID = "ap-northeast-1_0mgJAQqOC"
CLIENT_ID = "72ptfp894qtck6vdcmvuma3neu"
IDENTITY_POOL_ID = "ap-northeast-1:3e656b4d-b024-4d8c-9408-9014740449d3"
AGENT_RUNTIME_ARN = (
    "arn:aws:bedrock-agentcore:ap-northeast-1:162833658961:runtime/stliteNovaAgent-j4Yh9w2fjK"
)
REGION = "ap-northeast-1"


# ---------------------------------------------------------------------------
# AgentCore Runtime 呼び出し
# ---------------------------------------------------------------------------


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
    """
    encoded_arn = urllib.parse.quote(agent_runtime_arn, safe="")
    url = (
        f"https://bedrock-agentcore.{region}.amazonaws.com"
        f"/runtimes/{encoded_arn}/invocations"
    )
    body = json.dumps({"prompt": prompt})

    # 署名対象ヘッダー（AWS CLI と同じ）
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

    return await stream_sse_to_placeholder(url, fetch_headers, body, placeholder)


# ---------------------------------------------------------------------------
# セッション管理
# ---------------------------------------------------------------------------

# session_id: uuid4 + unixtime（47 文字、AgentCore の 33〜256 文字要件を満たす）
if "session_id" not in st.session_state:
    st.session_state.session_id = f"{uuid.uuid4()}-{int(time.time())}"

# チャット履歴の初期化
if "messages" not in st.session_state:
    st.session_state.messages = []

# ---------------------------------------------------------------------------
# 認証: Cookie → IdToken → Identity Pool → 一時クレデンシャル
# ---------------------------------------------------------------------------

id_token = get_id_token_from_cookie(CLIENT_ID)

if not id_token:
    st.error("認証トークンが見つかりません。ページをリロードしてください。")
    st.stop()

# クレデンシャル取得（初回のみ）
if "credentials" not in st.session_state:
    identity_id, credentials = asyncio.run(
        get_credentials_from_identity_pool(
            id_token, USER_POOL_ID, IDENTITY_POOL_ID, REGION,
        )
    )
    st.session_state.credentials = credentials
    st.session_state.identity_id = identity_id

credentials: AWSCredentials = st.session_state.credentials

# クレデンシャル期限切れチェック（残り 300 秒未満で更新）
if credentials.expiration < time.time() + 300:
    fresh_token = get_id_token_from_cookie(CLIENT_ID)
    if fresh_token:
        identity_id, new_credentials = asyncio.run(
            get_credentials_from_identity_pool(
                fresh_token, USER_POOL_ID, IDENTITY_POOL_ID, REGION,
            )
        )
        st.session_state.credentials = new_credentials
        st.session_state.identity_id = identity_id
        st.rerun()
    else:
        st.warning("セッションが期限切れです。ページをリロードしてください。")
        st.stop()

# ---------------------------------------------------------------------------
# チャット UI
# ---------------------------------------------------------------------------

st.title("🤖 AgentCore Chat")

# 履歴の表示
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# ユーザー入力
prompt = st.chat_input("メッセージを入力")
if prompt:
    # ユーザーメッセージを表示・保存
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # アシスタント応答（SSE ストリーミング）
    with st.chat_message("assistant"):
        placeholder = st.empty()
        try:
            full_response = asyncio.run(
                invoke_agent_runtime(
                    credentials=st.session_state.credentials,
                    agent_runtime_arn=AGENT_RUNTIME_ARN,
                    prompt=prompt,
                    session_id=st.session_state.session_id,
                    region=REGION,
                    placeholder=placeholder,
                )
            )
            st.session_state.messages.append(
                {"role": "assistant", "content": full_response}
            )
        except Exception as e:
            error_msg = str(e)
            if "403" in error_msg:
                placeholder.error(
                    "アクセスが拒否されました (403)。IAM 権限設定を確認してください。"
                )
            elif "429" in error_msg:
                placeholder.warning(
                    "リクエストが多すぎます (429)。しばらく待ってから再試行してください。"
                )
            elif "5" in error_msg[:5]:
                placeholder.error(
                    f"サーバーエラーが発生しました: {error_msg}"
                )
            else:
                placeholder.error(f"エラーが発生しました: {error_msg}")
