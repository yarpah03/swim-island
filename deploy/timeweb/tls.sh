#!/usr/bin/env bash
set -euo pipefail

domain=vip.swimisland.ru
base=/opt/swim-island-vip
site=/etc/nginx/sites-available/swim-island-vip
log_config=/etc/nginx/conf.d/swim-island-vip-log.conf
port=8787
cert=/etc/letsencrypt/live/$domain

test "$(id -u)" = 0
test -f "$site"
certbot certonly --webroot -w "$base/acme" -d "$domain" --cert-name "$domain" \
  --non-interactive --keep-until-expiring --deploy-hook 'systemctl reload nginx'
test -f "$cert/fullchain.pem"
test -f "$cert/privkey.pem"
cp "$site" "$base/http-only.conf"
# Keep one-time registration codes out of this virtual host's access log.
cat > "$log_config" <<'LOG'
log_format swim_island_vip '$remote_addr - [$time_local] "$request_method $uri $server_protocol" $status $body_bytes_sent';
LOG
cat > "$site" <<EOF
server {
    listen 80;
    server_name $domain;
    access_log /var/log/nginx/swim-island-vip-access.log swim_island_vip;
    location ^~ /.well-known/acme-challenge/ {
        root $base/acme;
    }
    location / {
        return 301 https://$domain\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name $domain;
    access_log /var/log/nginx/swim-island-vip-access.log swim_island_vip;
    ssl_certificate $cert/fullchain.pem;
    ssl_certificate_key $cert/privkey.pem;
    client_max_body_size 768k;

    location / {
        proxy_pass http://127.0.0.1:$port;
        proxy_http_version 1.1;
        proxy_set_header Host $domain;
    }
}
EOF
if ! nginx -t; then
  cp "$base/http-only.conf" "$site"
  exit 1
fi
if ! systemctl reload nginx; then
  cp "$base/http-only.conf" "$site"
  systemctl reload nginx
  exit 1
fi
echo 'SWIM_HTTPS_READY'
