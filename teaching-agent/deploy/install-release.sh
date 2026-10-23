#!/usr/bin/env bash
set -euo pipefail
test -x /opt/node-v24.19.0/bin/node
export PATH="/opt/node-v24.19.0/bin:$PATH"
release_id="$1"
archive="$2"
runtime_env="$3"
expected_sha="$4"
[[ "$release_id" =~ ^[A-Za-z0-9_-]+$ ]] || exit 2
base=/srv/teachdemo
release="$base/releases/$release_id"
test -f "$archive"
test -f "$runtime_env"
actual_sha=$(sha256sum "$archive" | cut -d ' ' -f 1)
test "$actual_sha" = "$expected_sha"
test ! -e "$release"
id teachdemo >/dev/null 2>&1 || useradd --system --home-dir "$base" --no-create-home --shell /sbin/nologin teachdemo
install -d -m 755 "$base/releases" "$base/shared/fonts" /etc/teachdemo
install -d -o teachdemo -g teachdemo -m 750 "$base/shared/cache"
install -d -o teachdemo -g teachdemo -m 750 "$base/shared/classroom"
runuser -u teachdemo -- test -w "$base/shared/classroom"
install -d -m 700 "$base/backups/$release_id"
install -d -m 755 "$release"
tar -xzf "$archive" -C "$release"
cd "$release"
printf 'Installing Linux production dependencies for %s\n' "$release_id"
nice -n 10 npm ci --omit=dev --no-audit --no-fund --cache "$base/shared/npm-cache"
install -m 644 deploy-assets/NotoSansSC.ttf "$base/shared/fonts/NotoSansSC.ttf"
install -m 644 deploy-assets/OFL.txt "$base/shared/fonts/OFL.txt"
if test -f /etc/teachdemo/teachdemo.env; then cp -p /etc/teachdemo/teachdemo.env "$base/backups/$release_id/teachdemo.env"; fi
install -m 600 "$runtime_env" /etc/teachdemo/teachdemo.env
ln -s "$base/shared/cache" "$release/.cache"
chgrp -R teachdemo "$release"
chmod -R g+rX "$release"
if test -f /etc/systemd/system/teachdemo.service; then cp -p /etc/systemd/system/teachdemo.service "$base/backups/$release_id/teachdemo.service"; fi
install -m 644 deploy/teachdemo.service /etc/systemd/system/teachdemo.service
if test -L "$base/current"; then readlink -f "$base/current" > "$base/backups/$release_id/previous-release.txt"; fi
ln -s "$release" "$base/.current-$release_id"
mv -Tf "$base/.current-$release_id" "$base/current"
systemctl daemon-reload
systemctl enable teachdemo
systemctl restart teachdemo
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3327/teachdemo/api/health; then printf '\nSERVICE_READY\n'; exit 0; fi
  sleep 1
done
journalctl -u teachdemo -n 35 --no-pager
exit 1
