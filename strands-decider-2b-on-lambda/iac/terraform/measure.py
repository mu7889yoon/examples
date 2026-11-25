"""Record Lambda cold-start evidence and deployed ECR image size as JSON Lines."""

import argparse
import base64
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


def aws(region, *args):
    output = subprocess.check_output(
        ["aws", *args, "--region", region, "--output", "json", "--no-cli-pager"],
        env={**os.environ, "AWS_MAX_ATTEMPTS": "1"},
        text=True,
    )
    return json.loads(output)


def log_number(text, pattern):
    match = re.search(pattern, text)
    return float(match.group(1)) if match else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("region")
    parser.add_argument("function_name")
    args = parser.parse_args()

    function = aws(args.region, "lambda", "get-function", "--function-name", args.function_name)
    config = function["Configuration"]
    image_uri = function["Code"]["ResolvedImageUri"]
    registry, image = image_uri.split("/", 1)
    repository, digest = image.rsplit("@", 1)
    image_details = aws(
        args.region, "ecr", "describe-images",
        "--registry-id", registry.split(".", 1)[0],
        "--repository-name", repository,
        "--image-ids", f"imageDigest={digest}",
    )["imageDetails"][0]

    request = Path(__file__).resolve().parents[2] / "request.json"
    with tempfile.TemporaryDirectory() as directory:
        response_path = Path(directory) / "response.json"
        started_at = datetime.now(timezone.utc).isoformat()
        started = time.perf_counter()
        invoke = aws(
            args.region, "lambda", "invoke", "--function-name", args.function_name,
            "--log-type", "Tail", "--cli-read-timeout", "910",
            "--payload", f"fileb://{request}", str(response_path),
        )
        wall_ms = round((time.perf_counter() - started) * 1000, 2)
        response = json.loads(response_path.read_text(encoding="utf-8"))

    if invoke.get("FunctionError"):
        raise SystemExit(f"Lambda returned {invoke['FunctionError']}: {response}")
    probability = response["answers"]["is_urgent"]["noul"]
    if not 0 <= probability <= 1:
        raise SystemExit(f"Unexpected Decider result: {response}")

    logs = base64.b64decode(invoke["LogResult"]).decode("utf-8", errors="replace")
    report = re.search(r"^REPORT\s+RequestId: ([\w-]+)[^\n]*", logs, re.MULTILINE)
    if not report:
        raise SystemExit("The Lambda log tail did not contain a REPORT line.")

    report_line = report.group()
    init_ms = log_number(report_line, r"\bInit Duration:\s+([\d.]+) ms")
    record = {
        "started_at_utc": started_at,
        "region": args.region,
        "architecture": config["Architectures"][0],
        "memory_mb": config["MemorySize"],
        "model": response["model"],
        "image_digest": digest,
        "ecr_image_size_bytes": image_details["imageSizeInBytes"],
        "request_id": report.group(1),
        "cold_start_confirmed": init_ms is not None,
        "invoke_wall_ms": wall_ms,
        "lambda_init_ms": init_ms,
        "lambda_duration_ms": log_number(report_line, r"\sDuration:\s+([\d.]+) ms"),
        "model_ready_seconds": log_number(logs, r"\bmodel ready in ([\d.]+) s"),
        "decider_handler_ms": response["latency_ms"],
        "lambda_report": report_line,
    }
    with Path("measurements.jsonl").open("a", encoding="utf-8") as output:
        output.write(json.dumps(record) + "\n")
    print(json.dumps(record, indent=2))
    if init_ms is None:
        print("No Init Duration was reported. This sample does not confirm a cold start.")


if __name__ == "__main__":
    main()
