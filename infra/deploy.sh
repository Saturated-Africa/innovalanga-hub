#!/bin/bash
#
# Redeploy the application onto the single-instance host.
#
# Run on the instance, via SSM Session Manager or AWS-RunShellScript. Takes one
# argument: a URL the instance can fetch the source tarball from. The instance
# role is deliberately PUT-only on the backups bucket, so the caller presigns a
# GET rather than the role being widened.
#
#   aws s3 cp app-src.tar.gz s3://BUCKET/deploy/app-src.tar.gz
#   URL=$(aws s3 presign s3://BUCKET/deploy/app-src.tar.gz --expires-in 3600)
#   bash deploy.sh "$URL"
#
# No secret value is echoed anywhere in here. xtrace is never enabled, and where
# a key is generated it is written straight to .env and reported by length only.
set -euo pipefail

APP=/opt/innovalanga
URL="${1:?usage: deploy.sh <source-tarball-url>}"

# Prisma renders tables with box-drawing characters. The AWS CLI cannot encode
# those when it prints the invocation output on a Windows console, which fails
# the whole command for a cosmetic reason. Strip to printable ASCII.
clean() { tr -cd '\11\12\15\40-\176'; }

echo "== fetching source =="
cd /tmp
rm -rf deploy-src && mkdir deploy-src
curl -fsSL "$URL" -o /tmp/app-src.tar.gz
tar -xzf /tmp/app-src.tar.gz -C /tmp/deploy-src
rm -f /tmp/app-src.tar.gz

# ---------------------------------------------------------------------------
# Keep the runtime configuration with the data, not with the instance.
#
# .env holds ENCRYPTION_KEY, and that key is generated on the instance. It is
# the one value here that cannot be regenerated: rotate it and every encrypted
# ID number in the database becomes permanently unreadable. It was living on
# the root disk, which is deleted when the instance is replaced - and this
# instance IS replaced, routinely, whenever AWS publishes a new machine image.
#
# So a copy is kept on the retained volume, beside the data it decrypts. A
# fresh instance restores from it before anything else runs.
#
# Written with restrictive permissions and never printed.
# ---------------------------------------------------------------------------
ENV_KEEP=/var/lib/innovalanga/pgdata/.env.runtime
if mountpoint -q /var/lib/innovalanga/pgdata; then
  if [ ! -f "$APP/.env" ] && [ -f "$ENV_KEEP" ]; then
    install -m 600 "$ENV_KEEP" "$APP/.env"
    echo "== runtime config restored from the retained volume =="
  fi
  if [ -f "$APP/.env" ]; then
    install -m 600 "$APP/.env" "$ENV_KEEP"
    echo "== runtime config copied to the retained volume ($(wc -l < "$ENV_KEEP") settings) =="
  fi
fi

echo "== preserving runtime config =="
test -f "$APP/.env" || {
  echo "FATAL: $APP/.env missing, and no copy was found on the retained volume."
  echo "       A fresh instance restores it from /var/lib/innovalanga/pgdata/.env.runtime;"
  echo "       if that is absent too, ENCRYPTION_KEY is gone and any encrypted"
  echo "       ID numbers cannot be read. Recover it before deploying."
  exit 1
}
cp "$APP/.env" /tmp/env.keep

echo "== syncing source =="
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude .env \
  /tmp/deploy-src/ "$APP/"
cp /tmp/env.keep "$APP/.env"
shred -u /tmp/env.keep 2>/dev/null || rm -f /tmp/env.keep
rm -rf /tmp/deploy-src
cd "$APP"

# The Caddyfile takes a site address and provisions TLS for it. An IP address
# cannot hold a public certificate, so leaving an IP in SITE_ADDRESS makes Caddy
# redirect every request to an HTTPS port it is unable to serve - which takes the
# whole site down. A real deployment sets SITE_ADDRESS to a hostname.
if grep -qE '^SITE_ADDRESS=[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' .env; then
  sed -i 's/^SITE_ADDRESS=.*/SITE_ADDRESS=:80/' .env
  echo "SITE_ADDRESS set to :80 (an IP address cannot have a certificate)"
fi

# The CDK ships ENCRYPTION_KEY as the literal placeholder
# REPLACE_WITH_EXISTING_KEY, which is 25 characters. The old encryption code
# zero-padded any short value to 32 bytes and used it without complaint, so the
# sandbox ran its whole life on a key written down in the repository.
# lib/encryption.ts now refuses anything under 32 characters.
CURRENT_LEN=$(grep -E '^ENCRYPTION_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\r\n' | wc -c)
if [ "$CURRENT_LEN" -lt 32 ]; then
  NEWKEY=$(openssl rand -hex 32)
  sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=${NEWKEY}|" .env
  unset NEWKEY
  NEW_LEN=$(grep -E '^ENCRYPTION_KEY=' .env | head -1 | cut -d= -f2- | tr -d '\r\n' | wc -c)
  echo "ENCRYPTION_KEY regenerated on host: was ${CURRENT_LEN} chars, now ${NEW_LEN}"
  echo "NOTE: this key exists only on this instance. For a real deployment, set"
  echo "      it deliberately in Secrets Manager before any data is encrypted."
else
  echo "ENCRYPTION_KEY length ${CURRENT_LEN}, unchanged"
fi

# Document and evidence upload both PUT straight into S3 from the browser, so
# an unset bucket name is not a degraded feature - it is a silently broken one.
# This was absent from the runtime environment on this instance from the day it
# was provisioned, and every upload failed against an empty bucket name.
if ! grep -qE '^AWS_S3_BUCKET=.+' .env; then
  echo "WARNING: AWS_S3_BUCKET is not set in .env."
  echo "         File uploads will fail until it names the documents bucket"
  echo "         from the Data stack. See infra/RUNBOOK.md."
fi

echo "== building image (arm64, on host) =="
docker build -t innovalanga-hub:latest . 2>&1 | clean | tail -6

# ---------------------------------------------------------------------------
# The database's disk must be there before anything starts.
#
# POSTGRES_DATA_PATH bind-mounts the database onto the retained volume. If that
# volume is not mounted, Docker helpfully creates the directory on the root disk
# instead, Postgres finds it empty, and initialises a brand new database over
# the top. The site comes up. Everybody can log in - to an empty system - and
# the real data is still sitting on a volume nobody noticed was detached.
#
# That failure is silent, plausible and recoverable only from backups, so the
# deploy stops instead.
# ---------------------------------------------------------------------------
DATA_PATH=$(grep -E '^POSTGRES_DATA_PATH=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')
if [ -n "$DATA_PATH" ]; then
  echo "== database volume =="
  if ! mountpoint -q "$DATA_PATH"; then
    echo "  FATAL: POSTGRES_DATA_PATH is $DATA_PATH but nothing is mounted there."
    echo "         Starting now would initialise an empty database on the root disk."
    echo "         Mount the retained volume first, or clear POSTGRES_DATA_PATH to"
    echo "         fall back to the old named volume."
    exit 1
  fi
  if [ ! -f "$DATA_PATH/PG_VERSION" ]; then
    echo "  WARNING: $DATA_PATH is mounted but holds no database."
    echo "           Postgres will initialise a new one here."
  fi
  echo "  $DATA_PATH is mounted on $(df --output=source "$DATA_PATH" | tail -1)"
fi

# ---------------------------------------------------------------------------
# Redirect the bare IP address to the hostname.
#
# Once SITE_ADDRESS is a hostname, Caddy answers only for that name. A request
# to the IP was being met with a redirect to https on the IP, which has no
# certificate and cannot have one, so every old link died silently. Anyone still
# holding the address from before the move got a connection failure rather than
# the site.
#
# Generated here rather than written into the Caddyfile because it can only
# exist when there IS a hostname: on an IP-only deployment SITE_ADDRESS is :80,
# and a second block on the same address stops Caddy starting at all. The
# directory is imported with a glob, so removing the file is enough to turn this
# off.
# ---------------------------------------------------------------------------
SITE=$(grep -E '^SITE_ADDRESS=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')
mkdir -p "$APP/caddy-conf.d"
REDIRECT_FILE="$APP/caddy-conf.d/ip-redirect.caddy"

case "$SITE" in
  ""|:*|*[0-9].[0-9]*.[0-9]*.[0-9]*)
    # No hostname, so nothing to redirect to.
    rm -f "$REDIRECT_FILE"
    ;;
  *)
    cat > "$REDIRECT_FILE" <<CADDY
# Generated by infra/deploy.sh. Do not edit; the next deploy overwrites it.
#
# Catches any request on port 80 whose Host is not ${SITE} - the bare IP
# address, chiefly - and sends it to the canonical name. Caddy prefers the more
# specific site block, so the ACME challenge for ${SITE} is unaffected.
http:// {
	redir https://${SITE}{uri} permanent
}
CADDY
    echo "== IP redirects to ${SITE} =="
    ;;
esac

echo "== restarting =="
docker compose up -d --force-recreate app caddy
sleep 12

# Two things bite here. The container runs as the unprivileged `nextjs` user
# with no writable home, so npx cannot create its cache; point HOME somewhere
# writable. And the runtime image is the Next.js standalone output, which
# carries @prisma/client and the generated engine but NOT the prisma CLI - so a
# bare `npx prisma` resolves nothing locally and pulls the newest CLI off the
# registry, which is a different major version with no `migrate` command. Pin it
# to the version the client was generated from.
PRISMA_VERSION=$(node -p "require('$APP/package.json').devDependencies.prisma.replace(/[^0-9.]/g,'')" 2>/dev/null || echo "5.22.0")
echo "== migrations (prisma@${PRISMA_VERSION}) =="
docker compose exec -T -e HOME=/tmp app npx --yes "prisma@${PRISMA_VERSION}" migrate deploy 2>&1 | clean | tail -8

# ---------------------------------------------------------------------------
# The restricted database role.
#
# Row-level security only enforces against a role that owns nothing and cannot
# bypass it. The migration creates that role without a login; the password is
# generated here, on the instance, so no credential ever exists in the
# repository, in a migration file, or in anybody's terminal history.
#
# Regenerated on every deploy, deliberately. The password lives only in this
# instance's .env, so a replaced instance would otherwise inherit a role whose
# password it does not know and be unable to connect. Resetting it each time
# makes that self-healing rather than a lockout.
#
# The value is passed to psql over stdin, never as an argument: arguments are
# visible to every process on the box through the process list.
# ---------------------------------------------------------------------------
echo "== restricted database role =="
if docker compose exec -T postgres psql -U innovalanga -d innovalanga -tAc      "SELECT 1 FROM pg_roles WHERE rolname='innovalanga_app'" 2>/dev/null | grep -q 1; then

  APP_DB_PASSWORD=$(openssl rand -hex 32)

  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U innovalanga -d innovalanga >/dev/null <<SQL
ALTER ROLE innovalanga_app WITH LOGIN PASSWORD '${APP_DB_PASSWORD}';
SQL

  # Hex only, so nothing in it needs escaping inside a URL.
  APP_URL="postgresql://innovalanga_app:${APP_DB_PASSWORD}@postgres:5432/innovalanga?schema=public"
  if grep -qE '^APP_DATABASE_URL=' .env; then
    # Written with a delimiter the value cannot contain.
    sed -i "s|^APP_DATABASE_URL=.*|APP_DATABASE_URL=${APP_URL}|" .env
  else
    printf 'APP_DATABASE_URL=%s
' "$APP_URL" >> .env
  fi
  unset APP_DB_PASSWORD APP_URL

  # The app container was started before this line existed in .env, and compose
  # reads .env when a container is created rather than on every request. Without
  # recreating it the variable is set on disk and absent in the process, which
  # is exactly the state that made the first deploy of this refuse to serve.
  docker compose up -d --force-recreate app >/dev/null 2>&1
  echo "  app restarted so it can see the restricted connection"

  OWNS=$(docker compose exec -T postgres psql -U innovalanga -d innovalanga -tAc     "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner='innovalanga_app'" | tr -d '[:space:]')
  BYPASS=$(docker compose exec -T postgres psql -U innovalanga -d innovalanga -tAc     "SELECT rolbypassrls FROM pg_roles WHERE rolname='innovalanga_app'" | tr -d '[:space:]')
  echo "  innovalanga_app: owns ${OWNS} tables, bypasses RLS: ${BYPASS}"
  if [ "$OWNS" != "0" ] || [ "$BYPASS" != "f" ]; then
    echo "  FATAL: the restricted role is not restricted. Policies would not enforce."
    exit 1
  fi
else
  echo "  role not present yet; it is created by the row-level security migration"
fi

# The app publishes no host port - it is only `expose`d on the compose network,
# reachable through Caddy. Health must be checked on :80, not :3000.
# Install the nightly dump and its timer on every deploy, so it is reinstated
# rather than depending on somebody remembering. The runbook has described this
# backup since day one; it had never actually been installed.
echo "== installing the nightly database dump =="
# Carriage returns are stripped here, not assumed absent. A single CRLF line
# in this file makes the shebang unexecutable and the error is
# "No such file or directory" naming a file that plainly exists - which
# sends everybody looking in the wrong place. This has now happened twice.
sed 's/\r$//' "$APP/infra/backup.sh" > /usr/local/bin/innovalanga-backup.sh
chmod 0755 /usr/local/bin/innovalanga-backup.sh

if ! grep -qE '^BACKUP_BUCKET=.+' .env; then
  echo "  WARNING: BACKUP_BUCKET is not set in .env; the dump will not run."
  echo "           Set it to the backups bucket from the Data stack."
fi

cat > /etc/systemd/system/innovalanga-backup.service <<UNIT
[Unit]
Description=Innovalanga nightly database dump to S3
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/innovalanga-backup.sh
UNIT

# 01:00 UTC, deliberately ahead of the 01:20 block snapshot, so a snapshot also
# carries that night's dump on its filesystem.
cat > /etc/systemd/system/innovalanga-backup.timer <<UNIT
[Unit]
Description=Run the Innovalanga database dump nightly

[Timer]
OnCalendar=*-*-* 01:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now innovalanga-backup.timer >/dev/null 2>&1
echo "  next run: $(systemctl show innovalanga-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null | head -c 40)"

echo "== health =="
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null 2>&1; then
    echo "healthy after ${i} attempt(s)"
    curl -fsS http://127.0.0.1/api/health | clean; echo
    exit 0
  fi
  sleep 5
done

echo "FAILED health check; recent app logs:"
docker compose logs --tail 40 app 2>&1 | clean
exit 1
