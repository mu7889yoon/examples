#!/bin/sh
set -eu

IP=""

# IPv6 でパブリック IP を取得
IP=$(wget -qO- http://checkip.amazonaws.com 2>/dev/null | tr -d '\n' || true)

if [ -z "${IP}" ]; then
  IP="unknown"
fi

cat > /usr/share/nginx/html/index.html <<EOF
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>it works</title>
  </head>
  <body>
    it works<br/>
    IP: ${IP}
  </body>
</html>
EOF

exec nginx -g 'daemon off;'

