from __future__ import annotations

import os
from typing import Any

try:
    import boto3
except ImportError:  # pragma: no cover - test fallback
    boto3 = None


class S3DocsRepository:
    def __init__(
        self,
        bucket: str | None = None,
        *,
        s3_client: Any | None = None,
    ) -> None:
        self.bucket = bucket or os.environ["DOCS_BUCKET"]
        self.prefix = "docs/"
        if s3_client is not None:
            self.s3 = s3_client
        elif boto3 is not None:
            self.s3 = boto3.client("s3")
        else:
            raise RuntimeError("boto3 is required when no s3_client is injected")

    def load_documents(self) -> dict[str, str]:
        paginator = self.s3.get_paginator("list_objects_v2")
        documents: dict[str, str] = {}
        for page in paginator.paginate(Bucket=self.bucket, Prefix=self.prefix):
            for item in page.get("Contents", []):
                key = item["Key"]
                if not key.endswith(".md"):
                    continue
                response = self.s3.get_object(Bucket=self.bucket, Key=key)
                body = response["Body"].read().decode("utf-8")
                documents[key] = body
        return documents
