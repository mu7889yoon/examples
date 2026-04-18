"""SigV4 signing module for Pyodide environment.

Implements AWS Signature Version 4 using only hashlib and hmac
(available in Pyodide). No boto3 or botocore dependency.
"""

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse


@dataclass
class AWSCredentials:
    """Temporary AWS credentials from Cognito Identity Pool."""

    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: float  # Unix timestamp


def sha256_hex(data: str) -> str:
    """SHA-256 ハッシュの16進文字列を返す。"""
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def hmac_sha256(key: bytes, msg: str) -> bytes:
    """HMAC-SHA256 のバイト列を返す。"""
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def hmac_sha256_hex(key: bytes, msg: str) -> str:
    """HMAC-SHA256 の16進文字列を返す。"""
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).hexdigest()


def extract_host(url: str) -> str:
    """URL からホスト名を抽出する。"""
    return urlparse(url).hostname or ""


def extract_path(url: str) -> str:
    """URL からパスを抽出し、SigV4 canonical URI 用に二重エンコードする。

    AWS（S3 以外）は canonical URI でパスセグメントの二重エンコードを期待する。
    既にエンコード済みの %XX をさらにエンコードして %25XX にする。
    """
    from urllib.parse import quote
    raw_path = urlparse(url).path
    if not raw_path:
        return "/"
    # パスセグメントごとに二重エンコード（/ は保持）
    segments = raw_path.split("/")
    encoded_segments = [quote(seg, safe="") for seg in segments]
    return "/".join(encoded_segments)


def extract_query_string(url: str) -> str:
    """URL からクエリ文字列を抽出する。"""
    return urlparse(url).query or ""


def sign_request(
    credentials: AWSCredentials,
    method: str,
    url: str,
    headers: dict[str, str],
    body: str,
    region: str,
    service: str = "bedrock-agentcore",
) -> dict[str, str]:
    """SigV4 署名を計算し、署名済みヘッダーを返す。

    Args:
        credentials: AWS temporary credentials.
        method: HTTP method (e.g. "POST").
        url: Full request URL.
        headers: Request headers (will be mutated with auth headers).
        body: Request body string.
        region: AWS region (e.g. "ap-northeast-1").
        service: AWS service name. Defaults to "bedrock-agentcore".

    Returns:
        The headers dict with Authorization, x-amz-date,
        x-amz-security-token, and host added.
    """
    # Step 1: タイムスタンプとスコープ
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")

    headers["x-amz-date"] = amz_date
    headers["x-amz-security-token"] = credentials.session_token
    headers["host"] = extract_host(url)

    # Step 2: 正規リクエストの作成
    sorted_keys = sorted(headers.keys(), key=str.lower)
    canonical_headers = "".join(
        f"{k.lower()}:{headers[k].strip()}\n" for k in sorted_keys
    )
    signed_headers = ";".join(k.lower() for k in sorted_keys)
    payload_hash = sha256_hex(body)

    canonical_request = "\n".join([
        method,
        extract_path(url),
        extract_query_string(url),
        canonical_headers,
        signed_headers,
        payload_hash,
    ])

    # Step 3: 署名文字列の作成
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        sha256_hex(canonical_request),
    ])

    # Step 4: 署名キーの導出
    k_date = hmac_sha256(
        f"AWS4{credentials.secret_access_key}".encode("utf-8"), date_stamp
    )
    k_region = hmac_sha256(k_date, region)
    k_service = hmac_sha256(k_region, service)
    k_signing = hmac_sha256(k_service, "aws4_request")

    # Step 5: 署名の計算と Authorization ヘッダー構築
    signature = hmac_sha256_hex(k_signing, string_to_sign)
    headers["Authorization"] = (
        f"AWS4-HMAC-SHA256 "
        f"Credential={credentials.access_key_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, "
        f"Signature={signature}"
    )

    return headers
