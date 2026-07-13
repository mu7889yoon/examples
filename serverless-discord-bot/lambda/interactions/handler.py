"""Lambda entry point for Discord interactions webhook."""

import json
import logging

from signature_verifier import verify_signature
from command_handler import handle_command

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Discord interaction type for PING
INTERACTION_TYPE_PING = 1


def lambda_handler(event, context):
    """Handle incoming Discord interaction requests.

    Flow:
        1. Verify request signature (Ed25519)
        2. Respond to PING (type 1) with PONG
        3. Route other interactions to the command handler

    Args:
        event: API Gateway event with headers and body.
        context: Lambda context (unused).

    Returns:
        A dict with statusCode and body for API Gateway response.
    """
    body = event.get("body", "")
    headers = event.get("headers", {})

    # Signature verification
    signature = headers.get("x-signature-ed25519", "")
    timestamp = headers.get("x-signature-timestamp", "")

    if not verify_signature(signature, timestamp, body):
        logger.warning("Invalid request signature")
        return {"statusCode": 401, "body": "invalid request signature"}

    payload = json.loads(body)

    # PING handling (Discord URL verification)
    if payload.get("type") == INTERACTION_TYPE_PING:
        logger.info("Responding to PING")
        return {"statusCode": 200, "body": json.dumps({"type": 1})}

    # Command handling
    return handle_command(payload)
