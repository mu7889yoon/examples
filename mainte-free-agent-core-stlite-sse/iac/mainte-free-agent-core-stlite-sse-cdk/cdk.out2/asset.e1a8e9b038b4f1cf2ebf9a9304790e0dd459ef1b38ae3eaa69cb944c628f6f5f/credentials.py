"""Cognito Identity Pool credential retrieval for Pyodide environment.

Uses pyodide.http.pyfetch to call Cognito Identity REST APIs directly.
No boto3 dependency.
"""

import json

from pyodide.http import pyfetch

from stlite.sigv4 import AWSCredentials


async def get_credentials_from_identity_pool(
    id_token: str,
    user_pool_id: str,
    identity_pool_id: str,
    region: str,
) -> tuple[str, AWSCredentials]:
    """Identity Pool から一時クレデンシャルを取得する。

    Args:
        id_token: Cognito IdToken (JWT).
        user_pool_id: Cognito User Pool ID (e.g. "ap-northeast-1_XXXXXXXXX").
        identity_pool_id: Cognito Identity Pool ID.
        region: AWS region.

    Returns:
        Tuple of (identity_id, AWSCredentials).
    """
    cognito_identity_url = (
        f"https://cognito-identity.{region}.amazonaws.com/"
    )
    logins_key = f"cognito-idp.{region}.amazonaws.com/{user_pool_id}"

    # Step 1: GetId — IdentityId を取得
    get_id_resp = await pyfetch(
        cognito_identity_url,
        method="POST",
        headers={
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "AWSCognitoIdentityService.GetId",
        },
        body=json.dumps({
            "IdentityPoolId": identity_pool_id,
            "Logins": {logins_key: id_token},
        }),
    )
    identity_result = await get_id_resp.json()
    identity_id: str = identity_result["IdentityId"]

    # Step 2: GetCredentialsForIdentity — 一時クレデンシャルを取得
    creds_resp = await pyfetch(
        cognito_identity_url,
        method="POST",
        headers={
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": (
                "AWSCognitoIdentityService.GetCredentialsForIdentity"
            ),
        },
        body=json.dumps({
            "IdentityId": identity_id,
            "Logins": {logins_key: id_token},
        }),
    )
    creds_result = await creds_resp.json()
    creds = creds_result["Credentials"]

    return identity_id, AWSCredentials(
        access_key_id=creds["AccessKeyId"],
        secret_access_key=creds["SecretKey"],
        session_token=creds["SessionToken"],
        expiration=creds["Expiration"],
    )
