import os
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

DISCORD_PUBLIC_KEY = os.environ.get("DISCORD_PUBLIC_KEY", "")


def verify_signature(signature: str, timestamp: str, body: str) -> bool:
    """Verify Discord request signature using Ed25519."""
    try:
        verify_key = VerifyKey(bytes.fromhex(DISCORD_PUBLIC_KEY))
        message = (timestamp + body).encode("utf-8")
        verify_key.verify(message, bytes.fromhex(signature))
        return True
    except (BadSignatureError, ValueError, Exception):
        return False
