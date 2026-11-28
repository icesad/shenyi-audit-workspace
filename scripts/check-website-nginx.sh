#!/usr/bin/env bash
# Run only against the disposable loopback virtual host created here.
set -euo pipefail
umask 077
repo=$(git rev-parse --show-toplevel)
cd "$repo"
scratch=$(mktemp -d /tmp/shenyi-website-nginx.XXXXXXXX)
server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill -QUIT "$server_pid" 2>/dev/null || true
    wait "$server_pid" || true
  fi
  rm -rf -- "$scratch"
}
trap cleanup EXIT
out="$scratch/release"
filing='琼ICP备00000000号-1'
node scripts/build-windows-download-site.mjs --output "$out" --source-commit "$(git rev-parse HEAD)" \
  --filing-number "$filing" > "$scratch/build.json"
test "$(sha256sum "$out/baseline.json" | cut -d' ' -f1)" = "$(jq -r .baselineSha256 "$scratch/build.json")"

openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=Shenyi loopback test CA' \
  -keyout "$scratch/ca.key" -out "$scratch/ca.crt" >"$scratch/ca.log" 2>&1
openssl req -new -newkey rsa:2048 -nodes -subj '/CN=shenji.vip' \
  -keyout "$scratch/site.key" -out "$scratch/site.csr" >"$scratch/csr.log" 2>&1
printf '%s\n' 'subjectAltName=DNS:shenji.vip,DNS:wrong.invalid' 'extendedKeyUsage=serverAuth' > "$scratch/site.ext"
openssl x509 -req -in "$scratch/site.csr" -CA "$scratch/ca.crt" -CAkey "$scratch/ca.key" -CAcreateserial \
  -days 1 -extfile "$scratch/site.ext" -out "$scratch/site.crt" >"$scratch/sign.log" 2>&1
port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
# Keep the generated vhost rules intact; substitute only this runner's socket and paths.
sed -e "s@listen 443 ssl;@listen 127.0.0.1:$port ssl;@" \
  -e "s@/etc/nginx/shenyi-website/public-chain.pem@$scratch/site.crt@" \
  -e "s@/etc/nginx/shenyi-website/public-key.pem@$scratch/site.key@" \
  -e "s@/var/log/nginx/shenyi-website-@$scratch/@" \
  -e "s@/srv/shenyi-website/current@$out/site@" \
  "$out/nginx-shenyi-website.conf" > "$scratch/site.conf"
grep -Fxq "    listen 127.0.0.1:$port ssl;" "$scratch/site.conf"
test "$(grep -Ec '^[[:space:]]*listen[[:space:]]' "$scratch/site.conf")" -eq 1
cat > "$scratch/nginx.conf" <<EOF
daemon off;
master_process off;
pid $scratch/nginx.pid;
error_log $scratch/nginx.log warn;
events { worker_connections 64; }
http {
    client_body_temp_path $scratch/body;
    proxy_temp_path $scratch/proxy;
    fastcgi_temp_path $scratch/fastcgi;
    uwsgi_temp_path $scratch/uwsgi;
    scgi_temp_path $scratch/scgi;
    include $scratch/site.conf;
}
EOF
nginx -t -e "$scratch/nginx.log" -p "$scratch" -c "$scratch/nginx.conf"
nginx -e "$scratch/nginx.log" -p "$scratch" -c "$scratch/nginx.conf" &
server_pid=$!
# Host, TLS name and trusted chain are checked as for production; all connections go to loopback.
site=(curl --silent --show-error --noproxy '*' --max-time 10 --cacert "$scratch/ca.crt"
  --connect-to "shenji.vip:443:127.0.0.1:$port" --connect-to "wrong.invalid:443:127.0.0.1:$port")
"${site[@]}" --retry 5 --retry-connrefused --retry-delay 1 --fail https://shenji.vip/ > "$scratch/home"
grep -Fq "$filing" "$scratch/home"
grep -Fq 'https://beian.miit.gov.cn/' "$scratch/home"
grep -Fq '正式安装包待发布' "$scratch/home"
if grep -Eq 'href="/downloads/' "$scratch/home"; then echo 'Unexpected live download link' >&2; exit 1; fi

jq -e '[.assets[].route] | sort == ["/","/assets/brand-shenyi.png","/styles.css"]' "$out/baseline.json" >/dev/null
jq -r '.assets[] | [.route,.sha256,.bytes] | @tsv' "$out/baseline.json" > "$scratch/routes"
while IFS=$'\t' read -r route digest bytes; do
  "${site[@]}" --fail "https://shenji.vip$route" -o "$scratch/body.bin"
  test "$(sha256sum "$scratch/body.bin" | cut -d' ' -f1)" = "$digest"
  test "$(wc -c < "$scratch/body.bin")" -eq "$bytes"
done < "$scratch/routes"

# Plant inert sentinels so a misconfigured static alias cannot pass by accident.
mkdir "$out/site/downloads"
for name in shenyi-windows-setup.exe shenyi-windows-x64.msi; do echo 'fixture' > "$out/site/downloads/$name"; done
echo 'fixture' > "$out/site/private-notes.txt"
check_status() {
  local expected=$1
  shift
  local received
  received=$("${site[@]}" -o /dev/null -w '%{http_code}' "$@")
  if [[ $received != "$expected" ]]; then printf 'Expected %s, got %s for %s\n' "$expected" "$received" "$*" >&2; exit 1; fi
}
for route in /downloads /downloads/shenyi-windows-setup.exe /downloads/shenyi-windows-x64.msi \
  /index.html /private-notes.txt /checkout /api/auth/methods /.git/config; do
  check_status 404 "https://shenji.vip$route"
done
check_status 200 --head https://shenji.vip/
check_status 405 -X POST https://shenji.vip/
check_status 421 -H 'Host: wrong.invalid' https://shenji.vip/
check_status 421 -H 'Host: shenji.vip' https://wrong.invalid/
echo 'PASS: real Nginx, loopback TLS, ICP footer, closed downloads, three static digests, Host/SNI and method checks.'
