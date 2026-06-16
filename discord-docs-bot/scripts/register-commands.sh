#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Discord スラッシュコマンド /ask を登録するスクリプト
#
# 必要な環境変数:
#   DISCORD_APP_ID    – Discord Application ID
#   DISCORD_BOT_TOKEN – Bot Token (Bot タブからコピー)
#
# グローバル登録 (全サーバーに反映、最大1時間かかる):
#   ./scripts/register-commands.sh
#
# ギルド限定登録 (即時反映、テスト向き):
#   DISCORD_GUILD_ID=123456789 ./scripts/register-commands.sh
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

: "${DISCORD_APP_ID:?環境変数 DISCORD_APP_ID を設定してください}"
: "${DISCORD_BOT_TOKEN:?環境変数 DISCORD_BOT_TOKEN を設定してください}"

# ギルド ID が指定されていればギルドコマンドとして登録 (即時反映)
if [[ -n "${DISCORD_GUILD_ID:-}" ]]; then
  URL="https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands"
  echo ">> ギルド限定で登録します (Guild: ${DISCORD_GUILD_ID})"
else
  URL="https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands"
  echo ">> グローバルコマンドとして登録します (反映まで最大1時間)"
fi

# /ask コマンド定義
# default_member_permissions: "0" = デフォルトで誰にも表示しない (管理者は常に使える)
# サーバー管理者が「サーバー設定 > 連携サービス」から特定ロールに許可を追加できる
PAYLOAD=$(cat <<'EOF'
[
  {
    "name": "ask",
    "description": "ドキュメントを参照して質問に回答します",
    "type": 1,
    "default_member_permissions": "0",
    "options": [
      {
        "name": "question",
        "description": "質問内容",
        "type": 3,
        "required": true
      }
    ]
  }
]
EOF
)

echo ">> PUT ${URL}"

HTTP_CODE=$(curl -s -o /tmp/discord-register-response.json -w "%{http_code}" \
  -X PUT \
  -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "${PAYLOAD}" \
  "${URL}")

echo ">> HTTP ${HTTP_CODE}"

if [[ "${HTTP_CODE}" == 2* ]]; then
  echo "✅ コマンド登録成功"
  cat /tmp/discord-register-response.json | python3 -m json.tool 2>/dev/null || cat /tmp/discord-register-response.json
else
  echo "❌ コマンド登録失敗"
  cat /tmp/discord-register-response.json | python3 -m json.tool 2>/dev/null || cat /tmp/discord-register-response.json
  exit 1
fi
