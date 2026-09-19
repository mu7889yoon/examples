#!/usr/bin/env python3
"""Fetch and verify the single immutable GGUF selected by runtime config.

The downloaded file is a deployment input, not an image-build dependency.  It
is verified twice: here, before it is packaged into the MicroVM ZIP, and again
by Docker after ``COPY models/``.  The download is written atomically, so a
failed or interrupted transfer can never look like a valid model snapshot.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen


CHUNK_SIZE = 1024 * 1024
DOWNLOAD_RANGE_BYTES = 16 * 1024 * 1024
DOWNLOAD_RETRIES = 3


def _required_string(model: dict[str, object], name: str) -> str:
    value = model.get(name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"model.{name} must be a nonempty string")
    return value


def _required_positive_int(model: dict[str, object], name: str) -> int:
    value = model.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"model.{name} must be a positive integer")
    return value


def _model_from_config(config: Path) -> tuple[str, str, str, int, str]:
    data = json.loads(config.read_text(encoding="utf-8"))
    model = data["model"]
    if not isinstance(model, dict):
        raise ValueError("model must be an object")
    if model.get("backend") != "llama.cpp":
        raise ValueError("Docker native runtime requires model.backend=llama.cpp")
    source = _required_string(model, "source")
    revision = _required_string(model, "revision")
    filename = _required_string(model, "ggufFile")
    expected_bytes = _required_positive_int(model, "expectedBytes")
    sha256 = _required_string(model, "sha256")
    if len(revision) != 40 or any(char not in "0123456789abcdef" for char in revision):
        raise ValueError("model.revision must be a 40-character lowercase SHA")
    if len(sha256) != 64 or any(char not in "0123456789abcdef" for char in sha256):
        raise ValueError("model.sha256 must be a 64-character lowercase SHA-256 digest")
    if Path(filename).name != filename:
        raise ValueError("model.ggufFile must be a filename, not a path")
    return source, revision, filename, expected_bytes, sha256


def verify(path: Path, expected_bytes: int, expected_sha256: str) -> None:
    """Verify both size and content; size alone is not an integrity check."""
    try:
        actual_bytes = path.stat().st_size
    except FileNotFoundError as error:
        raise ValueError(f"GGUF is missing: {path}") from error
    if actual_bytes != expected_bytes:
        raise ValueError(
            f"GGUF byte count mismatch for {path}: expected {expected_bytes}, got {actual_bytes}"
        )
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    actual_sha256 = digest.hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError(
            f"GGUF SHA-256 mismatch for {path}: expected {expected_sha256}, got {actual_sha256}"
        )


def download(url: str, target: Path, expected_bytes: int, expected_sha256: str) -> None:
    temporary = target.with_name(f".{target.name}.{os.getpid()}.part")
    try:
        # Hugging Face's Xet CDN may intentionally close an un-ranged response
        # before the complete multi-GB file. Explicit byte ranges make the
        # transfer deterministic and let us reject a short response immediately.
        with temporary.open("wb") as output:
            offset = 0
            while offset < expected_bytes:
                end = min(offset + DOWNLOAD_RANGE_BYTES, expected_bytes) - 1
                expected_chunk_bytes = end - offset + 1
                for attempt in range(1, DOWNLOAD_RETRIES + 1):
                    try:
                        request = Request(
                            url,
                            headers={
                                "User-Agent": "openjev-ippon-artifact-builder/1",
                                "Range": f"bytes={offset}-{end}",
                            },
                        )
                        with urlopen(request) as response:
                            content_range = response.headers.get("Content-Range")
                            chunk = response.read()
                        expected_range = f"bytes {offset}-{end}/{expected_bytes}"
                        if content_range != expected_range:
                            raise ValueError(
                                f"unexpected Content-Range: expected {expected_range}, got {content_range!r}"
                            )
                        if len(chunk) != expected_chunk_bytes:
                            raise ValueError(
                                f"short range response at {offset}: expected {expected_chunk_bytes}, got {len(chunk)}"
                            )
                        output.write(chunk)
                        offset += len(chunk)
                        break
                    except Exception:
                        if attempt == DOWNLOAD_RETRIES:
                            raise
                        print(
                            f"Retrying model byte range {offset}-{end} ({attempt}/{DOWNLOAD_RETRIES})",
                            flush=True,
                        )
        verify(temporary, expected_bytes, expected_sha256)
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--verify-existing",
        action="store_true",
        help="verify the configured GGUF is already present; do not use the network",
    )
    args = parser.parse_args()
    source, revision, filename, expected_bytes, sha256 = _model_from_config(args.config)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    target = args.output_dir / filename
    if args.verify_existing:
        verify(target, expected_bytes, sha256)
        print(f"Verified pinned GGUF: {target} ({expected_bytes} bytes, sha256={sha256})", flush=True)
        return
    url = f"https://huggingface.co/{quote(source, safe='/')}/resolve/{revision}/{quote(filename)}"
    print(f"Downloading pinned GGUF: {source}@{revision}/{filename}", flush=True)
    download(url, target, expected_bytes, sha256)
    print(f"Verified pinned GGUF: {target} ({expected_bytes} bytes, sha256={sha256})", flush=True)


if __name__ == "__main__":
    main()
