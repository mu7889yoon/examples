#!/usr/bin/env python3
"""Register Discord slash commands using the bulk overwrite endpoint."""
import json
import os
import sys
from pathlib import Path
import urllib.request
import urllib.error

DISCORD_API_BASE = "https://discord.com/api/v10"
ROOT = Path(__file__).resolve().parents[1]

COMMANDS = [
    {"name": "run", "description": "Start the Discord echo bot MicroVM", "type": 1},
]


def main():
    env = load_env(ROOT / ".env")
    token = os.environ.get("DISCORD_BOT_TOKEN") or env.get("DISCORD_BOT_TOKEN")
    app_id = os.environ.get("DISCORD_APPLICATION_ID") or env.get("DISCORD_APPLICATION_ID")

    if not token or not app_id:
        print("Error: DISCORD_BOT_TOKEN and DISCORD_APPLICATION_ID are required", file=sys.stderr)
        sys.exit(1)

    url = f"{DISCORD_API_BASE}/applications/{app_id}/commands"
    data = json.dumps(COMMANDS).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PUT", headers={
        "Authorization": f"Bot {token}",
        "Content-Type": "application/json",
        "User-Agent": "DiscordBot (https://github.com/serverless-discord-bot, 1.0)",
    })

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            print(json.dumps(result, indent=2))
            print(f"\nSuccessfully registered {len(result)} commands.")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"Error {e.code}: {body}", file=sys.stderr)
        sys.exit(1)


def load_env(path):
    values = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


if __name__ == "__main__":
    main()
