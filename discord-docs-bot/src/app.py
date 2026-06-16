from __future__ import annotations

import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any

from agent import create_agent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Agent はプロセス起動時に一度だけ生成
_agent = create_agent()


def handle_event(event: dict[str, Any]) -> dict[str, Any]:
    question = event["question"]
    logger.info("Received question: %s", question)

    result = _agent(question)
    answer = str(result)

    logger.info("Generated answer (length=%d)", len(answer))
    return {"answer": answer}


class AgentCoreHandler(BaseHTTPRequestHandler):
    """HTTP handler implementing the AgentCore Runtime service contract."""

    def do_GET(self) -> None:
        if self.path == "/ping":
            self._send_json(200, {"status": "Healthy"})
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path == "/invocations":
            self._handle_invocation()
        else:
            self._send_json(404, {"error": "Not found"})

    def _handle_invocation(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            event = json.loads(body) if body else {}

            logger.info("Received invocation", extra={"event_keys": list(event.keys())})
            result = handle_event(event)
            self._send_json(200, result)
        except Exception:
            logger.exception("Invocation failed")
            self._send_json(500, {"error": "Internal server error"})

    def _send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        logger.info(format, *args)


def main() -> None:
    host = "0.0.0.0"
    port = 8080
    server = HTTPServer((host, port), AgentCoreHandler)
    logger.info("AgentCore runtime listening on %s:%d", host, port)
    server.serve_forever()


if __name__ == "__main__":
    main()
