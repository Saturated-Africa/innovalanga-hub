#!/bin/bash
# Restore the database from a backup. This is the real thing, not a drill.
#
#   # from a workstation with AWS credentials, pick a dump:
#   aws s3 ls s3://<backups-bucket>/pg/
#   URL=$(aws s3 presign s3://<backups-bucket>/pg/<dump>.sql.gz --expires-in 3600)
#
#   # then on the instance:
#   sudo bash infra/restore.sh "$URL" pg/<dump>.sql.gz
#
# Use infra/restore-verify.sh to rehearse against a scratch database. This one
# replaces the live database, and asks before it does.
#
# Two things this does that a bare `psql < dump` does not, both learned from
# rehearsing it:
#
#   1. It re-grants the application role. pg_dump runs with --no-privileges, so
#      a restored database carries its row-level security policies but not the
#      grants that let the application read through them. Without this step the
#      site comes back up and serves nothing, with no error that points at the
#      cause.
#
#   2. It takes a dump of what is there now, first. Restoring over a database
#      that was merely damaged rather than lost destroys the evidence of what
#      went wrong, and sometimes the damaged copy has rows the backup does not.
set -uo pipefail
cd /opt/innovalanga

URL="${1:-}"
KEY="${2:-the supplied dump}"
OWNER=innovalanga
DB=innovalanga
PG="docker compose exec -T postgres"

[ -n "$URL" ] || {
  echo "usage: restore.sh <presigned-url> [label]"
  echo "  the instance cannot read the backups bucket by design; presign the dump first"
  exit 2
}

if [ "${I_UNDERSTAND_THIS_REPLACES_THE_DATABASE:-}" != "yes" ]; then
  echo
  echo "This replaces the live database with $KEY."
  echo "Everything written since that backup will be gone."
  echo
  echo "Rehearse first:  sudo bash infra/restore-verify.sh \"\$URL\" $KEY"
  echo "Then re-run:     I_UNDERSTAND_THIS_REPLACES_THE_DATABASE=yes sudo -E bash infra/restore.sh \"\$URL\" $KEY"
  exit 3
fi

echo "== fetching =="
rm -f /tmp/restore.sql.gz
curl -fsSL "$URL" -o /tmp/restore.sql.gz || { echo "FATAL: could not download"; exit 1; }
gzip -t /tmp/restore.sql.gz || { echo "FATAL: corrupt archive"; exit 1; }
echo "   $KEY, $(numfmt --to=iec "$(stat -c%s /tmp/restore.sql.gz)")"

echo "== preserving what is there now =="
# Written beside the data on the retained volume rather than to S3: this has to
# work when the reason for restoring is that something else does not.
SAFETY="/var/lib/innovalanga/pgdata/before-restore-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
if $PG pg_dump -U "$OWNER" -d "$DB" --clean --if-exists --no-owner --no-privileges 2>/dev/null | gzip -9 > "$SAFETY"; then
  echo "   $SAFETY ($(numfmt --to=iec "$(stat -c%s "$SAFETY")"))"
else
  echo "   WARNING: could not dump the current database. It may already be unusable."
  echo "            Continuing, because that is usually why you are here."
fi

echo "== stopping the application =="
# Stopped, not left running: a half-restored database being read by a live
# application produces errors nobody can interpret afterwards.
docker compose stop app >/dev/null 2>&1

echo "== restoring =="
gzip -dc /tmp/restore.sql.gz | $PG psql -q -U "$OWNER" -d "$DB" > /tmp/restore.log 2>&1
ERRORS=$(grep -c '^ERROR' /tmp/restore.log || true)
echo "   errors: $ERRORS"
[ "$ERRORS" -gt 0 ] && grep '^ERROR' /tmp/restore.log | head -5 | sed 's/^/     /'

echo "== re-granting the application role =="
# The step a bare restore misses. See the note at the top.
$PG psql -v ON_ERROR_STOP=1 -U "$OWNER" -d "$DB" >/dev/null 2>&1 <<SQL
GRANT USAGE ON SCHEMA public TO innovalanga_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO innovalanga_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO innovalanga_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO innovalanga_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO innovalanga_app;
SQL
READABLE=$($PG psql -U "$OWNER" -d "$DB" -tAc "SELECT count(*) FROM information_schema.table_privileges
  WHERE grantee='innovalanga_app' AND table_schema='public' AND privilege_type='SELECT';" | tr -d '[:space:]')
echo "   the application role can read $READABLE tables"

echo "== starting =="
docker compose up -d app >/dev/null 2>&1
for _ in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost/login 2>/dev/null)
  [ "$CODE" = "200" ] && break
  sleep 2
done

echo
echo "== what came back =="
$PG psql -U "$OWNER" -d "$DB" -tAc "
  SELECT '   participants: '||(SELECT count(*) FROM \"InnovatorProfile\")||
         '  grants: '||(SELECT count(*) FROM \"Grant\")||
         '  transactions: '||(SELECT count(*) FROM \"FinanceTransaction\")||
         '  policies: '||(SELECT count(*) FROM pg_policies WHERE schemaname='public');" 2>/dev/null

rm -f /tmp/restore.sql.gz /tmp/restore.log
echo
echo "Restored from $KEY."
echo "The database as it was before this is at $SAFETY"
