#!/usr/bin/env bash
set -euo pipefail

release="$1"
domain=vip.swimisland.ru
base=/opt/swim-island-vip
service=/etc/systemd/system/swim-island-vip.service
available=/etc/nginx/sites-available/swim-island-vip
enabled=/etc/nginx/sites-enabled/swim-island-vip
port=8787

test "$(id -u)" = 0
test -f "$release/server.mjs"
test -f "$release/public/client/index.html"
test -d /etc/nginx/sites-available
test -d /etc/nginx/sites-enabled
test ! -e "$service"
test ! -e "$available"
test ! -e "$enabled"
nginx -T 2>&1 | awk '
  /server_name[[:space:]]/ && /vip[.]swimisland[.]ru/ { found = 1 }
  END { exit found ? 1 : 0 }
'
if ss -ltnH "sport = :$port" | grep -q .; then
  echo "Port $port is in use."
  exit 1
fi

rollback() {
  status=$?
  if [ "$status" -ne 0 ]; then
    rm -f -- "$enabled" "$available"
    if [ -f "$service" ]; then
      systemctl disable --now swim-island-vip.service || true
      rm -f -- "$service"
      systemctl daemon-reload
    fi
  fi
  exit "$status"
}
trap rollback EXIT

id swimvip >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin swimvip
install -d -m 755 "$base/acme/.well-known/acme-challenge"
cat > "$service" <<EOF
[Unit]
Description=Swim Island VIP web portal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=swimvip
Group=swimvip
WorkingDirectory=$release
Environment=SWIM_PUBLIC_ORIGIN=https://$domain
Environment=SWIM_UPSTREAM_ORIGIN=https://swim-island-chats.pages.dev
Environment=PORT=$port
Environment=NODE_OPTIONS=--dns-result-order=ipv4first
ExecStart=/usr/bin/node $release/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now swim-island-vip.service
for attempt in {1..6}; do
  if curl -fsS --max-time 10 "http://127.0.0.1:$port/health"; then
    break
  fi
  sleep 2
done
curl -fsS --max-time 10 -o /dev/null "http://127.0.0.1:$port/health"

cat > "$available" <<EOF
server {
    listen 80;
    server_name $domain;

    location ^~ /.well-known/acme-challenge/ {
        root $base/acme;
    }
    location / {
        return 503;
    }
}
EOF
ln -s "$available" "$enabled"
if ! nginx -t; then
  rm "$enabled"
  exit 1
fi
systemctl reload nginx
echo 'SWIM_SERVICE_READY'
