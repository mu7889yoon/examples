"""Cookie parser for cognito-at-edge tokens."""

import json


def _get_cookie_dict() -> dict[str, str]:
    """runtime_cookies.json から Cookie 辞書を取得する。"""
    candidates = [
        "runtime_cookies.json",
        "/home/pyodide/runtime_cookies.json",
        "../runtime_cookies.json",
    ]
    for path in candidates:
        try:
            with open(path) as f:
                return json.loads(f.read())
        except Exception:
            continue
    return {}


def get_id_token_from_cookie(client_id: str) -> str | None:
    """Cookie から cognito-at-edge が保存した IdToken を取得する。"""
    cookie_dict = _get_cookie_dict()
    if not cookie_dict:
        return None

    last_auth_user_key = f"CognitoIdentityServiceProvider.{client_id}.LastAuthUser"
    username = cookie_dict.get(last_auth_user_key)
    if not username:
        return None

    id_token_key = f"CognitoIdentityServiceProvider.{client_id}.{username}.idToken"
    return cookie_dict.get(id_token_key)
