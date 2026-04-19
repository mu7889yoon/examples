"""Cookie parser for cognito-at-edge tokens.

Reads cookies from runtime_cookies.json (mounted by index.html at startup).
Falls back to js.document.cookie if the file is unavailable.
"""

import json


def _get_cookie_dict() -> dict[str, str]:
    """runtime_cookies.json または js.document.cookie から Cookie 辞書を取得する。"""
    # stlite では index.html が document.cookie を JSON 化してマウントしている
    try:
        with open("runtime_cookies.json") as f:
            return json.loads(f.read())
    except Exception:
        pass

    # フォールバック: js.document.cookie を直接読む
    try:
        import js
        cookies = str(js.document.cookie)
        if not cookies:
            return {}
        cookie_dict = {}
        for item in cookies.split(";"):
            item = item.strip()
            if "=" in item:
                key, value = item.split("=", 1)
                cookie_dict[key.strip()] = value.strip()
        return cookie_dict
    except Exception:
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
