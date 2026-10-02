#!/bin/sh
set -eu

if [ ! -f .env.local ]; then
  echo "infra/.env.local is required for the existing AWS environment." >&2
  exit 2
fi

set -a
. ./.env.local
set +a

exec npx cdkd "$@"
