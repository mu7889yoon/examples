"""Main Streamlit application for AgentCore chat."""

import asyncio
import time
import uuid

import streamlit as st

from stlite import config
from stlite.agent_client import AgentError, invoke_agent_runtime
from stlite.cookie_parser import get_id_token_from_cookie
from stlite.credentials import get_credentials_from_identity_pool


def ensure_credentials() -> None:
    """セッションにクレデンシャルがなければ取得、期限切れなら更新する。"""
    id_token = get_id_token_from_cookie(config.CLIENT_ID)
    if not id_token:
        st.error("認証トークンが見つかりません。ページをリロードしてください。")
        st.stop()

    needs_refresh = False
    if "credentials" not in st.session_state:
        needs_refresh = True
    elif st.session_state.credentials.expiration < time.time() + 300:
        needs_refresh = True

    if needs_refresh:
        token = (
            id_token
            if "credentials" not in st.session_state
            else get_id_token_from_cookie(config.CLIENT_ID)
        )
        if not token:
            st.warning("セッションが期限切れです。ページをリロードしてください。")
            st.stop()
        identity_id, credentials = asyncio.run(
            get_credentials_from_identity_pool(
                token,
                config.USER_POOL_ID,
                config.IDENTITY_POOL_ID,
                config.REGION,
            )
        )
        was_refresh = "credentials" in st.session_state
        st.session_state.credentials = credentials
        st.session_state.identity_id = identity_id
        if was_refresh:
            st.rerun()


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

ensure_credentials()

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
                    agent_runtime_arn=config.AGENT_RUNTIME_ARN,
                    prompt=prompt,
                    session_id=st.session_state.session_id,
                    region=config.REGION,
                    placeholder=placeholder,
                )
            )
            st.session_state.messages.append(
                {"role": "assistant", "content": full_response}
            )
        except AgentError as e:
            if e.status_code == 429:
                placeholder.warning(e.message)
            else:
                placeholder.error(e.message)
        except Exception as e:
            placeholder.error(f"エラーが発生しました: {e}")
