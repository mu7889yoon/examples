"""Command handler module for Discord slash commands."""

import json

from microvm_client import MicrovmClient

# Discord interaction type for APPLICATION_COMMAND
INTERACTION_TYPE_APPLICATION_COMMAND = 2

# Discord response type for CHANNEL_MESSAGE_WITH_SOURCE
RESPONSE_TYPE_CHANNEL_MESSAGE = 4


def respond(content: str) -> dict:
    """Build a Discord interaction response.

    Args:
        content: The message content to send back to the user.

    Returns:
        A dict with statusCode, headers, and body suitable for API Gateway.
    """
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({
            "type": RESPONSE_TYPE_CHANNEL_MESSAGE,
            "data": {"content": content},
        }),
    }


def handle_run(client: MicrovmClient) -> dict:
    """Handle the /run slash command."""
    client.run_microvm()
    return respond("🚀 MicroVM を起動しました")


def handle_command(payload: dict) -> dict:
    """Route a Discord interaction payload to the appropriate command handler.

    Only processes APPLICATION_COMMAND (type 2) interactions. Dispatches
    to handle_run based on the command name.

    Args:
        payload: The Discord interaction payload dict.

    Returns:
        A Discord interaction response dict, or an error response if the
        command is unrecognized or the interaction type is unsupported.
    """
    interaction_type = payload.get("type")
    if interaction_type != INTERACTION_TYPE_APPLICATION_COMMAND:
        return respond("⚠️ サポートされていないインタラクションタイプです。")

    data = payload.get("data", {})
    command_name = data.get("name", "")

    client = MicrovmClient()

    if command_name == "run":
        return handle_run(client)
    else:
        return respond(f"⚠️ 不明なコマンド: /{command_name}")
