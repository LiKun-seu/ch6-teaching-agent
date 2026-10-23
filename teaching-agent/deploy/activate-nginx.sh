#!/usr/bin/env bash
set -euo pipefail
release_id="$1"
[[ "$release_id" =~ ^[A-Za-z0-9_-]+$ ]] || exit 2
base=/srv/teachdemo
release="$base/releases/$release_id"
backup="$base/backups/$release_id"
test -f "$release/DEPLOYMENT.json"
curl -fsS http://127.0.0.1:3327/teachdemo/api/health
cp -p /etc/nginx/conf.d/00-edsionc.conf "$backup/00-edsionc.conf"
for file in teachdemo.conf teachdemo-proxy.conf; do
  if test -f "/etc/nginx/snippets/$file"; then cp -p "/etc/nginx/snippets/$file" "$backup/$file"; fi
  install -m 644 "$release/deploy/$file" "/etc/nginx/snippets/$file"
done
install -m 644 "$release/deploy/teachdemo-limits.conf" /etc/nginx/conf.d/teachdemo-limits.conf
python3 - <<'PY'
from pathlib import Path
import re
p=Path('/etc/nginx/conf.d/00-edsionc.conf')
text=p.read_text()
include='    include /etc/nginx/snippets/teachdemo.conf;'
if include not in text:
 pattern=r'(?m)^([ \t]*server_name[ \t]+edsionc\.top[ \t]+www\.edsionc\.top;)[ \t]*$'
 assert len(re.findall(pattern,text))==1, 'Cannot identify target virtual host uniquely'
 text=re.sub(pattern,lambda match: match.group(1)+'\n'+include,text,count=1)
 p.write_text(text)
PY
if ! nginx -t; then
  cp -p "$backup/00-edsionc.conf" /etc/nginx/conf.d/00-edsionc.conf
  printf 'Nginx config test failed; original host config restored.\n' >&2
  exit 1
fi
systemctl reload nginx
systemctl is-active nginx teachdemo
printf 'NGINX_ACTIVATED\n'
