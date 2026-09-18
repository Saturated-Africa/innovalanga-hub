#!/bin/bash
# Move the site from plain HTTP on an IP address to HTTPS on a hostname.
#
#   sudo bash infra/enable-tls.sh hub.innovalanga.co.za
#
# Caddy obtains the certificate itself, but only once the name resolves to this
# instance: Let's Encrypt validates by connecting back to it over port 80. Point
# Caddy at a hostname that does not resolve here and it will redirect every
# request to an HTTPS port it cannot serve, which takes the whole site down.
#
# So this checks first, and puts the site back if the certificate does not
# arrive. A TLS cutover that fails closed is a five-minute outage; one that
# fails open is a site nobody can reach and nobody can explain.
set -uo pipefail

HOST="${1:-}"
[ -n "$HOST" ] || { echo "usage: enable-tls.sh <hostname>"; exit 2; }

cd /opt/innovalanga
ENV=.env
BACKUP="/var/lib/innovalanga/pgdata/.env.before-tls"

fail() { echo "FAILED: $*"; }

echo "== what this instance's public address is =="
TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
MYIP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
echo "  $MYIP"

echo "== where $HOST points =="
RESOLVED=$(getent hosts "$HOST" | awk '{print $1}' | head -1)
if [ -z "$RESOLVED" ]; then
  fail "$HOST does not resolve yet. Create the A record and allow a few minutes."
  exit 1
fi
echo "  $RESOLVED"

if [ "$RESOLVED" != "$MYIP" ]; then
  fail "$HOST resolves to $RESOLVED, not to this instance at $MYIP."
  echo "       Certificate issuance would fail and the site would go down."
  exit 1
fi

echo "== keeping a copy of the working configuration =="
# Beside the database on the retained volume, so a failed cutover can be undone
# even from a fresh instance.
install -m 600 "$ENV" "$BACKUP"
echo "  $BACKUP"

echo "== switching the site to $HOST =="
set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" "$ENV"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV"
  fi
}
set_env SITE_ADDRESS "$HOST"
# The session cookie's security attributes are derived from this, not from
# NODE_ENV. Everyone is signed out once, because the cookie changes to the
# __Host- prefixed secure form. That is the correct behaviour, not a fault.
set_env NEXTAUTH_URL "https://${HOST}"
grep -E '^(SITE_ADDRESS|NEXTAUTH_URL)=' "$ENV" | sed 's/^/  /'

echo "== restarting =="
docker compose up -d --force-recreate caddy app >/dev/null 2>&1

echo "== waiting for the certificate =="
OK=no
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://${HOST}/login" 2>/dev/null)
  if [ "$CODE" = "200" ]; then OK=yes; break; fi
  sleep 10
done

if [ "$OK" = yes ]; then
  echo "  https://${HOST}/login returns 200"
  echo
  echo "== checks =="
  echo -n "  http redirects to https: "
  curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' --max-time 10 "http://${HOST}/login"
  echo -n "  certificate issuer: "
  echo | openssl s_client -servername "$HOST" -connect "${HOST}:443" 2>/dev/null \
    | openssl x509 -noout -issuer 2>/dev/null | sed 's/issuer=//' || echo "(could not read)"
  echo -n "  expires: "
  echo | openssl s_client -servername "$HOST" -connect "${HOST}:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | sed 's/notAfter=//' || echo "(could not read)"
  echo
  echo "Done. The site is at https://${HOST}"
  echo "Everyone has been signed out once, because the session cookie is now secure."
  exit 0
fi

echo
fail "no certificate after five minutes. Putting the site back as it was."
docker compose logs --tail=30 caddy 2>&1 | grep -iE "error|challenge|acme" | tail -8 | sed 's/^/    /'
install -m 600 "$BACKUP" "$ENV"
docker compose up -d --force-recreate caddy app >/dev/null 2>&1
sleep 5
echo -n "  site restored on http: "
curl -s -o /dev/null -w '%{http_code}\n' --max-time 15 "http://${MYIP}/login"
exit 1
