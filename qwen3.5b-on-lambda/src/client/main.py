#!/usr/bin/env python3
import requests
import json
import argparse
import os
import readline
import sys
import time
import threading
import signal
import re
import boto3
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


class ThinkingIndicator:
    """Animated thinking spinner."""
    FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"

    def __init__(self):
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        self._stop.clear()
        self._thread = threading.Thread(target=self._animate, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join()
        sys.stderr.write("\r\033[K")
        sys.stderr.flush()

    def _animate(self):
        i = 0
        while not self._stop.is_set():
            sys.stderr.write(f"\r{self.FRAMES[i % len(self.FRAMES)]} Thinking...")
            sys.stderr.flush()
            i += 1
            self._stop.wait(0.1)


class ChatClient:
    def __init__(self, api_base, temperature=0.7, max_tokens=32768, profile=None, region=None):
        self.api_base = api_base.rstrip("/")
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.messages = []
        self.indicator = ThinkingIndicator()

        session = boto3.Session(profile_name=profile)
        self.credentials = session.get_credentials().get_frozen_credentials()
        self.region = (
            region
            or session.region_name
            or self._infer_region_from_api_base(self.api_base)
            or "us-east-1"
        )

    @staticmethod
    def _infer_region_from_api_base(api_base):
        match = re.search(r"\.lambda-url\.([a-z0-9-]+)\.on\.aws", api_base)
        return match.group(1) if match else None

    def _sign_request(self, url, headers, body):
        request = AWSRequest(method="POST", url=url, data=body, headers=headers)
        SigV4Auth(self.credentials, "lambda", self.region).add_auth(request)
        return dict(request.headers)

    def send(self, user_message):
        self.messages.append({"role": "user", "content": user_message})

        url = f"{self.api_base}/v1/chat/completions"
        payload = json.dumps({
            "messages": self.messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": True,
        })
        headers = {"Content-Type": "application/json"}
        signed_headers = self._sign_request(url, headers, payload)

        self.indicator.start()
        first_token = True
        full_response = ""

        try:
            with requests.post(url, data=payload, headers=signed_headers, stream=True) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line:
                        continue
                    line = line.decode("utf-8")
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        break

                    chunk = json.loads(data)
                    choices = chunk.get("choices", [])
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        if first_token:
                            self.indicator.stop()
                            first_token = False
                        sys.stdout.write(content)
                        sys.stdout.flush()
                        full_response += content
        except KeyboardInterrupt:
            self.indicator.stop()
            if full_response:
                self.messages.append({"role": "assistant", "content": full_response})
            print("\n[Interrupted]")
            return
        finally:
            self.indicator.stop()

        print()
        if full_response:
            self.messages.append({"role": "assistant", "content": full_response})

    def new_chat(self):
        self.messages = []
        print("[New conversation started]")


def main():
    parser = argparse.ArgumentParser(description="Chat client for Qwen 3.5 on Lambda")
    parser.add_argument("--api-base", default=os.environ.get("CHAT_API_BASE"), help="Function URL")
    parser.add_argument("--temperature", type=float, default=0.6)
    parser.add_argument("--max-tokens", type=int, default=32768)
    parser.add_argument("--profile", default=None, help="AWS profile name")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION"), help="AWS region for SigV4 signing")
    args = parser.parse_args()

    if not args.api_base:
        print("Error: --api-base or CHAT_API_BASE env var required")
        sys.exit(1)

    client = ChatClient(args.api_base, args.temperature, args.max_tokens, args.profile, args.region)

    last_interrupt = 0

    def handle_sigint(sig, frame):
        nonlocal last_interrupt
        now = time.time()
        if now - last_interrupt < 1:
            print("\nBye!")
            sys.exit(0)
        last_interrupt = now
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, handle_sigint)

    print("Qwen 3.5 Chat (type /quit to exit, /new for new conversation)")
    print("Use EOF or ``` for multi-line input")
    print()

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye!")
            break

        if not user_input:
            continue
        if user_input == "/quit":
            print("Bye!")
            break
        if user_input == "/new":
            client.new_chat()
            continue

        # Multi-line input
        if user_input in ("EOF", "```"):
            lines = []
            print("(Enter EOF or ``` to finish)")
            while True:
                try:
                    line = input()
                except EOFError:
                    break
                if line.strip() in ("EOF", "```"):
                    break
                lines.append(line)
            user_input = "\n".join(lines)
            if not user_input.strip():
                continue

        print()
        print("Assistant: ", end="", flush=True)
        client.send(user_input)
        print()


if __name__ == "__main__":
    main()
