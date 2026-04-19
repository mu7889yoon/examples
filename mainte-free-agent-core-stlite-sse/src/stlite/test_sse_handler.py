"""Unit tests for parse_line and ParseResult in sse_handler.py.

These tests import only the pure functions (parse_json_line, parse_line, ParseResult)
which have no Pyodide/js dependencies.
"""

import json
import sys
from unittest.mock import MagicMock

# Stub out Pyodide-only modules before importing sse_handler
sys.modules.setdefault("js", MagicMock())
sys.modules.setdefault("pyodide", MagicMock())
sys.modules.setdefault("pyodide.ffi", MagicMock())

from sse_handler import ParseResult, parse_json_line, parse_line


# --- ParseResult dataclass ---

def test_parse_result_fields():
    r = ParseResult(chunk="hello", done=False, result="")
    assert r.chunk == "hello"
    assert r.done is False
    assert r.result == ""


# --- parse_line: empty / whitespace ---

def test_parse_line_empty_string():
    assert parse_line("") is None


def test_parse_line_whitespace_only():
    assert parse_line("   ") is None


# --- parse_line: [DONE] signal ---

def test_parse_line_done_signal_sse():
    r = parse_line("data: [DONE]")
    assert r == ParseResult(chunk="", done=True, result="")


def test_parse_line_done_signal_bare():
    r = parse_line("[DONE]")
    assert r == ParseResult(chunk="", done=True, result="")


# --- parse_line: SSE format ---

def test_parse_line_sse_with_chunk():
    payload = json.dumps({"chunk": "hello"})
    r = parse_line(f"data: {payload}")
    assert r is not None
    assert r.chunk == "hello"
    assert r.done is False
    assert r.result == ""


def test_parse_line_sse_with_done_field():
    payload = json.dumps({"chunk": "", "done": True, "result": "final"})
    r = parse_line(f"data: {payload}")
    assert r is not None
    assert r.done is True
    assert r.result == "final"


# --- parse_line: NDJSON format ---

def test_parse_line_ndjson_chunk():
    payload = json.dumps({"chunk": "world"})
    r = parse_line(payload)
    assert r is not None
    assert r.chunk == "world"
    assert r.done is False


def test_parse_line_ndjson_done():
    payload = json.dumps({"done": True, "result": "all done"})
    r = parse_line(payload)
    assert r is not None
    assert r.done is True
    assert r.result == "all done"


# --- parse_line: unparseable ---

def test_parse_line_invalid_json():
    assert parse_line("not json at all") is None


def test_parse_line_sse_invalid_json():
    assert parse_line("data: not-json") is None


# --- parse_line: double-encoded JSON (delegated to parse_json_line) ---

def test_parse_line_double_encoded():
    inner = {"chunk": "double", "done": False, "result": ""}
    double = json.dumps(json.dumps(inner))
    r = parse_line(f"data: {double}")
    assert r is not None
    assert r.chunk == "double"


# --- parse_line: result field ---

def test_parse_line_result_field():
    payload = json.dumps({"chunk": "", "result": "full text"})
    r = parse_line(payload)
    assert r is not None
    assert r.result == "full text"
    assert r.chunk == ""
