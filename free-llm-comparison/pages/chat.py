import streamlit as st
from openai import OpenAI

st.title("💬 Chat")

if "messages" not in st.session_state:
    st.session_state.messages = []

for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

if prompt := st.chat_input("Send a message..."):
    endpoint = st.session_state.get("endpoint", "")
    api_key = st.session_state.get("api_key", "")
    model = st.session_state.get("model", "")
    temperature = st.session_state.get("temperature", 1.0)
    max_tokens = st.session_state.get("max_tokens", 1024)

    if not api_key:
        st.error("API Key が設定されていません。.env を確認してください。")
        st.stop()
    if not model:
        st.error("Model が設定されていません。.env を確認してください。")
        st.stop()

    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.expander("📡 Request Log", expanded=False):
        st.code(
            f"POST {endpoint}/chat/completions\n"
            f"Model: {model}\n"
            f"Temperature: {temperature}\n"
            f"Max Tokens: {max_tokens}",
            language="text",
        )

    client = OpenAI(
        base_url=endpoint,
        api_key=api_key,
        default_headers={"Accept": "application/json"},
    )

    with st.chat_message("assistant"):
        try:
            stream = client.chat.completions.create(
                model=model,
                messages=st.session_state.messages,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=True,
            )

            def generate():
                for chunk in stream:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content

            response = st.write_stream(generate())
        except Exception as e:
            response = f"Error: {e}"
            st.error(response)

    st.session_state.messages.append({"role": "assistant", "content": response})
