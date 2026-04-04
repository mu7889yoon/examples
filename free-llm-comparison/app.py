import os
import streamlit as st
from dotenv import load_dotenv

load_dotenv()

st.set_page_config(page_title="LLM Playground", layout="wide")

# --- Provider config loaded from .env ---
PROVIDERS = {
    "Google Gemini": {
        "endpoint": os.getenv("GEMINI_ENDPOINT", "https://generativelanguage.googleapis.com/v1beta/openai"),
        "api_key": os.getenv("GEMINI_API_KEY", ""),
        "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
    },
    "Sakura AI": {
        "endpoint": os.getenv("SAKURA_ENDPOINT", "https://api.ai.sakura.ad.jp/v1"),
        "api_key": os.getenv("SAKURA_SECRET", ""),
        "model": os.getenv("SAKURA_MODEL", "gpt-oss-120b"),
    },
    "Cloudflare Workers AI": {
        "endpoint": f"https://api.cloudflare.com/client/v4/accounts/{os.getenv('CLOUDFLARE_ACCOUNT_ID', '')}/ai/v1",
        "api_key": os.getenv("CLOUDFLARE_API_KEY", ""),
        "model": os.getenv("CLOUDFLARE_MODEL", "@cf/meta/llama-3.1-8b-instruct"),
    },
    "io.net": {
        "endpoint": os.getenv("IONET_ENDPOINT", "https://api.intelligence.io.solutions/api/v1"),
        "api_key": os.getenv("IONET_API_KEY", ""),
        "model": os.getenv("IONET_MODEL", "meta-llama/Llama-3.3-70B-Instruct"),
    },
    "OpenRouter": {
        "endpoint": os.getenv("OPENROUTER_ENDPOINT", "https://openrouter.ai/api/v1"),
        "api_key": os.getenv("OPENROUTER_API_KEY", ""),
        "model": os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct"),
    },
    "Custom": {
        "endpoint": os.getenv("CUSTOM_ENDPOINT", ""),
        "api_key": os.getenv("CUSTOM_API_KEY", ""),
        "model": os.getenv("CUSTOM_MODEL", ""),
    },
}

with st.sidebar:
    st.header("Provider Settings")
    provider = st.selectbox("Provider", list(PROVIDERS.keys()), key="provider")

cfg = PROVIDERS[provider]
st.session_state["endpoint"] = cfg["endpoint"]
st.session_state["api_key"] = cfg["api_key"]
st.session_state["model"] = cfg["model"]

with st.sidebar:
    st.text_input("API Endpoint", value=cfg["endpoint"], disabled=True)
    st.text_input("API Key", value="••••••••" if cfg["api_key"] else "", disabled=True)
    st.text_input("Model", value=cfg["model"], disabled=True)

    st.divider()
    st.subheader("Parameters")
    st.session_state["temperature"] = st.slider(
        "Temperature", 0.0, 2.0, 1.0, 0.1, key="_temperature"
    )
    st.session_state["max_tokens"] = st.number_input(
        "Max Tokens", min_value=1, max_value=128000, value=1024, key="_max_tokens"
    )

# --- Navigation ---
pg = st.navigation([
    st.Page("pages/chat.py", title="Chat", icon="💬", default=True),
])
pg.run()
