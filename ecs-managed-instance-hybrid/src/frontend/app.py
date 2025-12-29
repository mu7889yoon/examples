"""
vLLM Spot Inference Frontend Application

stliteで動作するStreamlitアプリケーション。
ランダムなプロンプトを自動送信し、vLLM APIからの応答を表示する。

Note: stlite (Pyodide) では time.sleep() が動作しないため、
asyncio.sleep() を使用しています。
"""

import streamlit as st
import asyncio
import random
from datetime import datetime

# ============================================
# Configuration
# ============================================

# 事前定義されたプロンプト配列 (Requirement 4.1)
PROMPTS = [
    "日本の首都はどこですか？",
    "プログラミングを学ぶコツを教えてください",
    "健康的な朝食のレシピを提案してください",
    "AIの未来について簡潔に説明してください",
    "効率的な時間管理の方法を3つ挙げてください",
    "環境問題について一言で説明してください",
    "おすすめの本を1冊紹介してください",
    "ストレス解消法を教えてください",
    "新しい趣味を始めるならおすすめは？",
    "今日の天気に合う服装を提案してください",
]

# API設定
API_ENDPOINT = st.secrets.get("api_endpoint", "http://localhost:8000")
DELAY_SECONDS = 2
MAX_TOKENS = 512

# ============================================
# Session State Initialization (Requirement 3.2)
# ============================================

if "history" not in st.session_state:
    st.session_state.history = []

if "is_running" not in st.session_state:
    st.session_state.is_running = False

if "last_prompt" not in st.session_state:
    st.session_state.last_prompt = None

if "current_prompt" not in st.session_state:
    st.session_state.current_prompt = None

if "current_response" not in st.session_state:
    st.session_state.current_response = None


# ============================================
# Prompt Selection Logic (Requirements 4.2, 4.3)
# ============================================

def select_random_prompt(prompts: list[str], last_prompt: str | None) -> str:
    """
    プロンプト配列からランダムに選択する。
    連続重複を回避する（配列に複数の要素がある場合）。
    
    Args:
        prompts: プロンプトの配列
        last_prompt: 前回選択されたプロンプト
    
    Returns:
        選択されたプロンプト
    """
    if len(prompts) == 0:
        raise ValueError("Prompts array cannot be empty")
    
    if len(prompts) == 1:
        return prompts[0]
    
    # 連続重複を回避
    available_prompts = [p for p in prompts if p != last_prompt]
    return random.choice(available_prompts)


# ============================================
# API Call Logic (Requirement 1.2, 1.3)
# ============================================

def call_inference_api(prompt: str, endpoint: str = API_ENDPOINT) -> dict:
    """
    vLLM APIを呼び出して推論結果を取得する。
    
    Args:
        prompt: 送信するプロンプト
        endpoint: APIエンドポイント
    
    Returns:
        APIレスポンス（response, latency_ms）
    """
    import pyodide.http
    import json
    
    start_time = asyncio.get_event_loop().time()
    
    try:
        response = pyodide.http.open_url(
            f"{endpoint}/v1/chat/completions",
            method="POST",
            body=json.dumps({
                "model": "Qwen/Qwen3-4B",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": MAX_TOKENS,
            }),
            headers={"Content-Type": "application/json"},
        )
        
        latency_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        data = json.loads(response.read())
        
        # OpenAI互換レスポンスから応答テキストを抽出
        response_text = data["choices"][0]["message"]["content"]
        
        return {
            "response": response_text,
            "latency_ms": latency_ms,
            "success": True,
            "error": None,
        }
    except Exception as e:
        latency_ms = (asyncio.get_event_loop().time() - start_time) * 1000
        return {
            "response": None,
            "latency_ms": latency_ms,
            "success": False,
            "error": str(e),
        }


# ============================================
# History Management (Requirement 3.2, 3.5)
# ============================================

def add_to_history(prompt: str, response: str, latency_ms: float) -> None:
    """
    履歴にプロンプトと応答のペアを追加する。
    
    Args:
        prompt: 送信したプロンプト
        response: 受信した応答
        latency_ms: レイテンシ（ミリ秒）
    """
    history_item = {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "prompt": prompt,
        "response": response,
        "latency_ms": latency_ms,
    }
    st.session_state.history.append(history_item)


# ============================================
# Control Functions (Requirement 3.6)
# ============================================

def start_inference():
    """自動推論を開始する"""
    st.session_state.is_running = True


def stop_inference():
    """自動推論を停止する"""
    st.session_state.is_running = False


# ============================================
# Main Inference Loop (Requirements 3.3, 3.4, 3.5)
# ============================================

def run_inference_cycle():
    """
    1回の推論サイクルを実行する。
    - ランダムプロンプトを選択
    - APIを呼び出し
    - 履歴に追加
    - 2秒待機
    """
    # プロンプト選択
    prompt = select_random_prompt(PROMPTS, st.session_state.last_prompt)
    st.session_state.current_prompt = prompt
    st.session_state.last_prompt = prompt
    
    # API呼び出し
    result = call_inference_api(prompt)
    
    if result["success"]:
        st.session_state.current_response = result["response"]
        add_to_history(prompt, result["response"], result["latency_ms"])
    else:
        st.session_state.current_response = f"Error: {result['error']}"
        add_to_history(prompt, f"Error: {result['error']}", result["latency_ms"])
    
    # 2秒待機 (Requirement 3.4)
    time.sleep(DELAY_SECONDS)


# ============================================
# UI Components
# ============================================

def render_ui():
    """メインUIをレンダリングする"""
    st.title("🤖 vLLM Spot Inference Demo")
    st.markdown("Qwen/Qwen3-4Bモデルを使用した自動推論デモ")
    
    # コントロールボタン (Requirement 3.6)
    col1, col2, col3 = st.columns([1, 1, 2])
    
    with col1:
        if st.button("▶️ 開始", disabled=st.session_state.is_running):
            start_inference()
            st.rerun()
    
    with col2:
        if st.button("⏹️ 停止", disabled=not st.session_state.is_running):
            stop_inference()
            st.rerun()
    
    with col3:
        status = "🟢 実行中" if st.session_state.is_running else "🔴 停止中"
        st.markdown(f"**ステータス:** {status}")
    
    st.divider()
    
    # 現在の処理状況 (Requirement 3.5)
    st.subheader("📝 現在の処理")
    
    if st.session_state.current_prompt:
        st.markdown(f"**プロンプト:** {st.session_state.current_prompt}")
        
        if st.session_state.current_response:
            st.markdown("**応答:**")
            st.info(st.session_state.current_response)
    else:
        st.markdown("_待機中..._")
    
    st.divider()
    
    # 履歴表示 (Requirement 3.2)
    st.subheader("📜 履歴")
    
    if st.session_state.history:
        # 新しい順に表示
        for item in reversed(st.session_state.history[-10:]):
            with st.expander(f"🕐 {item['timestamp']} - {item['prompt'][:30]}..."):
                st.markdown(f"**プロンプト:** {item['prompt']}")
                st.markdown(f"**応答:** {item['response']}")
                st.markdown(f"**レイテンシ:** {item['latency_ms']:.1f}ms")
    else:
        st.markdown("_履歴はまだありません_")


# ============================================
# Main Application
# ============================================

def main():
    """メインアプリケーションエントリーポイント"""
    st.set_page_config(
        page_title="vLLM Spot Inference",
        page_icon="🤖",
        layout="wide",
    )
    
    render_ui()
    
    # 自動推論ループ (Requirement 3.3)
    if st.session_state.is_running:
        run_inference_cycle()
        st.rerun()


if __name__ == "__main__":
    main()
