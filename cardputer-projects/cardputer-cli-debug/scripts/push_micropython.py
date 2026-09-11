#!/usr/bin/env python3
"""Upload and optionally run a MicroPython script over a UIFlow2 REPL."""

from __future__ import annotations

import argparse
import base64
import time
from pathlib import Path

import serial


def read_until(port: serial.Serial, token: bytes, timeout: float = 5.0) -> bytes:
    data = bytearray()
    deadline = time.time() + timeout
    while time.time() < deadline:
        chunk = port.read(4096)
        if chunk:
            data.extend(chunk)
            if token in data:
                return bytes(data)
        else:
            time.sleep(0.02)
    return bytes(data)


def send_line(port: serial.Serial, line: str) -> None:
    port.write(line.encode("utf-8") + b"\r\n")
    time.sleep(0.06)


def enter_paste_mode(port: serial.Serial) -> None:
    # Ctrl-B leaves raw REPL if a previous client left it active.
    port.write(b"\x02")
    time.sleep(0.5)
    port.reset_input_buffer()

    port.write(b"\x03" * 5 + b"\r\n")
    time.sleep(0.8)
    repl = read_until(port, b">>>")
    if b">>>" not in repl:
        raise RuntimeError("MicroPython REPL prompt was not found")

    port.write(b"\x05")
    paste = read_until(port, b"=== ", timeout=3.0)
    if b"paste mode" not in paste:
        raise RuntimeError("MicroPython paste mode was not available")


def upload(port: serial.Serial, source: bytes, remote: str) -> bytes:
    enter_paste_mode(port)
    send_line(port, "import ubinascii")
    send_line(port, f"f = open({remote!r}, 'wb')")
    for offset in range(0, len(source), 128):
        encoded = base64.b64encode(source[offset : offset + 128]).decode("ascii")
        send_line(port, f"f.write(ubinascii.a2b_base64({encoded!r}))")
    send_line(port, "f.close()")
    send_line(port, f"print('WROTE {remote}')")
    port.write(b"\x04")
    result = read_until(port, b">>>")
    if f"WROTE {remote}".encode() not in result:
        raise RuntimeError("Device did not confirm the file write: " + repr(result[-400:]))
    return result


def run_script(port: serial.Serial, remote: str) -> bytes:
    port.write(f"exec(open({remote!r}).read())\r\n".encode("utf-8"))
    result = read_until(port, b">>>")
    if b"Traceback" in result:
        raise RuntimeError("Device-side script failed: " + repr(result[-1000:]))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True, help="Serial port, e.g. /dev/tty.usbmodem101")
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--remote", default="/flash/helloworld.py")
    parser.add_argument("--no-run", action="store_true")
    parser.add_argument("--allow-boot-files", action="store_true")
    args = parser.parse_args()

    if not args.allow_boot_files and Path(args.remote).name in {"boot.py", "main.py"}:
        parser.error("Refusing to overwrite boot.py/main.py without --allow-boot-files")

    source = args.source.read_bytes()
    with serial.Serial(args.port, 115200, timeout=0.2) as port:
        upload_result = upload(port, source, args.remote)
        print(upload_result.decode("utf-8", errors="replace")[-500:])
        if not args.no_run:
            run_result = run_script(port, args.remote)
            print(run_result.decode("utf-8", errors="replace")[-500:])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
