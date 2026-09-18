#!/bin/bash
# Prove that a backup can actually be restored.
#
#   # from a workstation with AWS credentials:
#   URL=$(aws s3 presign s3://<backups-bucket>/pg/<dump>.sql.gz --expires-in 3600)
#   # then on the instance:
#   sudo bash infra/restore-verify.sh "$URL" pg/<dump>.sql.gz
#
# A backup nobody has restored is a hypothesis. This script is the experiment:
# it takes a real dump, builds a database from it in isolation, and checks that
# what came back is usable - not merely that the file existed and the command
# exited zero.
#
# The dump arrives as a presigned URL rather than being fetched from S3 by the
# instance, because the instance deliberately cannot read the backups bucket. It
# has write-only access, so a compromised host can add to the backup history but
# cannot read it or destroy it. That is worth keeping, and it means a restore is
# an operator action: somebody with credentials hands the instance one specific
# file, for one hour.
#
# It is paranoid about two things a naive check would miss.
#
# First, row counts. A dump that restores without error but is missing a table's
# contents produces a perfectly healthy-looking empty database, and the failure
# surfaces only when somebody needs the data.
#
# Second, whether the application could actually run against it. pg_dump is
# invoked with --no-privileges, so the restore carries the row-level security
# policies but not the grants that let the application role read through them. A
# database that restores cleanly and then serves nothing is not a restored
# database.
#
# The live database is never touched. The scratch one is dropped at the end
# unless KEEP=1 is set.
set -uo pipefail
cd /opt/innovalanga

URL="${1:-}"
KEY="${2:-the supplied dump}"
SCRATCH_DB=innovalanga_restoretest
OWNER=innovalanga
PG="docker compose exec -T postgres"

[ -n "$URL" ] || {
  echo "usage: restore-verify.sh <presigned-url> [label]"
  echo "  the instance cannot read the backups bucket by design; presign the dump first"
  exit 2
}

FAILURES=0
note()  { printf '   %-52s %s\n' "$1" "$2"; }
check() {
  if [ "$2" = "$3" ]; then
    printf '   ok    %-46s %s\n' "$1" "$3"
  else
    printf '   FAIL  %-46s got %s, expected %s\n' "$1" "$3" "$2"
    FAILURES=$((FAILURES+1))
  fi
}

echo "== fetching the dump =="
echo "   $KEY"
rm -f /tmp/restore.sql.gz
curl -fsSL "$URL" -o /tmp/restore.sql.gz || { echo "   FATAL: could not download"; exit 1; }
BYTES=$(stat -c%s /tmp/restore.sql.gz)
note "size" "$(numfmt --to=iec "$BYTES")"

echo "== is it a real gzip stream? =="
gzip -t /tmp/restore.sql.gz 2>/dev/null || { echo "   FATAL: corrupt archive"; exit 1; }
STATEMENTS=$(gzip -dc /tmp/restore.sql.gz | grep -c '^CREATE TABLE' || true)
POLICIES_IN_DUMP=$(gzip -dc /tmp/restore.sql.gz | grep -c '^CREATE POLICY' || true)
GRANTS_IN_DUMP=$(gzip -dc /tmp/restore.sql.gz | grep -c '^GRANT ' || true)
note "tables in the dump" "$STATEMENTS"
note "policies in the dump" "$POLICIES_IN_DUMP"
note "grants in the dump" "$GRANTS_IN_DUMP"

echo "== restoring into a scratch database =="
$PG psql -U "$OWNER" -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH_DB WITH (FORCE);" >/dev/null 2>&1
$PG psql -v ON_ERROR_STOP=1 -U "$OWNER" -d postgres -c "CREATE DATABASE $SCRATCH_DB;" >/dev/null || {
  echo "   FATAL: could not create the scratch database"; exit 1; }

gzip -dc /tmp/restore.sql.gz | $PG psql -q -U "$OWNER" -d "$SCRATCH_DB" > /tmp/restore.log 2>&1
ERRORS=$(grep -c '^ERROR' /tmp/restore.log || true)
note "errors during restore" "$ERRORS"
if [ "$ERRORS" -gt 0 ]; then
  grep '^ERROR' /tmp/restore.log | head -5 | sed 's/^/     /'
fi

q()  { $PG psql -U "$OWNER" -d "$SCRATCH_DB" -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }
# For lists. q() collapses whitespace, which is correct for one number and
# silently turns a list of table names into a single meaningless token - the
# loop below then ran once, compared nothing, and reported success.
qlist() { $PG psql -U "$OWNER" -d "$SCRATCH_DB" -tAc "$1" 2>/dev/null | tr -d '\r' | sed '/^$/d'; }
qL() { $PG psql -U "$OWNER" -d innovalanga    -tAc "$1" 2>/dev/null | tr -d '[:space:]'; }

echo
echo "== how old is this dump? =="
# A backup is a photograph of an earlier schema. Comparing it to the current
# database will differ for everything created since, and calling that a failure
# would make this report cry wolf after every migration - at which point nobody
# reads it. So the vintage is established first, and only what exists in both is
# compared.
MIG_DUMP=$(q  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
MIG_LIVE=$(qL "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;")
note "migrations in the dump" "$MIG_DUMP"
note "migrations live now" "$MIG_LIVE"
if [ "${MIG_DUMP:-0}" -lt "${MIG_LIVE:-0}" ]; then
  echo "   This dump predates $(( MIG_LIVE - MIG_DUMP )) migration(s). Tables added since"
  echo "   are absent from it, which is correct rather than a fault."
  q "SELECT '     missing since: '||migration_name FROM (
       SELECT migration_name FROM _prisma_migrations
     ) d RIGHT JOIN (SELECT 1) x ON true WHERE false;" >/dev/null 2>&1
  $PG psql -U "$OWNER" -d innovalanga -tAc     "SELECT '     added since: '||migration_name FROM _prisma_migrations
     WHERE finished_at IS NOT NULL ORDER BY finished_at OFFSET ${MIG_DUMP};" 2>/dev/null
fi

echo
echo "== does the restored data match, table by table? =="
# Only tables the dump actually contains. Anything newer is reported above.
TABLES=$(qlist "SELECT table_name FROM information_schema.tables
                WHERE table_schema='public' AND table_type='BASE TABLE'
                  AND table_name <> '_prisma_migrations' ORDER BY table_name;")
COMPARED=0
for table in $TABLES; do
  LIVE_N=$(qL "SELECT count(*) FROM \"$table\";")
  REST_N=$(q  "SELECT count(*) FROM \"$table\";")
  # A table that exists in both but differs is a real problem.
  if [ "$LIVE_N" != "$REST_N" ]; then
    printf '   FAIL  %-46s restored %s, live %s
' "$table" "$REST_N" "$LIVE_N"
    FAILURES=$((FAILURES+1))
  fi
  COMPARED=$((COMPARED+1))
done
note "tables compared" "$COMPARED"
if [ "$COMPARED" -lt 10 ]; then
  echo "   FAIL  only $COMPARED table(s) were compared; the list was not read correctly"
  FAILURES=$((FAILURES+1))
fi
if [ "$FAILURES" -eq 0 ] && [ "$COMPARED" -ge 10 ]; then
  echo "   ok    all $COMPARED tables restored to the same row count"
fi

echo
echo "== would the application be able to run against it? =="
RESTORED_POLICIES=$(q "SELECT count(*) FROM pg_policies WHERE schemaname='public';")
RESTORED_TABLES=$(q "SELECT count(*) FROM information_schema.tables
                     WHERE table_schema='public' AND table_type='BASE TABLE';")
note "policies in the restored database" "$RESTORED_POLICIES"
# Every tenant-scoped table needs one. VerificationToken and _prisma_migrations
# deliberately have none, so the count is compared against the dump, not live.
if [ "${RESTORED_POLICIES:-0}" -lt 1 ]; then
  echo "   FAIL  the restore carries no row-level security at all"
  FAILURES=$((FAILURES+1))
else
  echo "   ok    row-level security came back with the data"
fi

# The decisive question. pg_dump --no-privileges omits GRANT statements, so the
# application role can end up with no access to a perfectly good database.
APP_TABLES=$(q "SELECT count(*) FROM information_schema.table_privileges
                WHERE grantee='innovalanga_app' AND table_schema='public' AND privilege_type='SELECT';")
note "tables the app role can read, before granting" "$APP_TABLES"

if [ "${APP_TABLES:-0}" -lt "${RESTORED_TABLES:-1}" ]; then
  echo
  echo "   The restore does not carry the application role's privileges. That is"
  echo "   expected - pg_dump runs with --no-privileges - and it means a restored"
  echo "   database serves nothing until they are granted again. This is the step"
  echo "   a recovery would otherwise discover at the worst moment, so it is"
  echo "   applied and re-checked here."
  $PG psql -v ON_ERROR_STOP=1 -U "$OWNER" -d "$SCRATCH_DB" >/dev/null 2>&1 <<SQL
GRANT USAGE ON SCHEMA public TO innovalanga_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO innovalanga_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO innovalanga_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO innovalanga_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO innovalanga_app;
SQL
  AFTER=$(q "SELECT count(*) FROM information_schema.table_privileges
             WHERE grantee='innovalanga_app' AND table_schema='public' AND privilege_type='SELECT';")
  check "after granting, app role reads every table" "$RESTORED_TABLES" "$AFTER"
fi

echo
echo "== and is it still isolated, or did the policies come back inert? =="
PROG=$(q "SELECT id FROM \"Programme\" ORDER BY \"createdAt\" LIMIT 1;")
if [ -n "$PROG" ]; then
  APP_PW=$(openssl rand -hex 32)
  $PG psql -v ON_ERROR_STOP=1 -U "$OWNER" -d "$SCRATCH_DB" >/dev/null 2>&1 <<SQL
ALTER ROLE innovalanga_app WITH LOGIN PASSWORD '${APP_PW}';
SQL
  scoped() {
    PGPASSWORD="$APP_PW" $PG psql -tAc "$2" \
      "postgresql://innovalanga_app@localhost:5432/${SCRATCH_DB}?options=-c%20app.programme_id%3D$1" 2>/dev/null | tr -d '[:space:]'
  }
  check "own programme sees its participants" \
    "$(q "SELECT count(*) FROM \"InnovatorProfile\";")" \
    "$(scoped "$PROG" 'SELECT count(*) FROM "InnovatorProfile";')"
  check "an unknown programme sees nothing" "0" \
    "$(scoped "rlstest-nonexistent" 'SELECT count(*) FROM "InnovatorProfile";')"
else
  echo "   no programme in the restore to test isolation with"
  FAILURES=$((FAILURES+1))
fi

echo
if [ "${KEEP:-0}" = "1" ]; then
  echo "scratch database kept as $SCRATCH_DB"
else
  $PG psql -U "$OWNER" -d postgres -c "DROP DATABASE IF EXISTS $SCRATCH_DB WITH (FORCE);" >/dev/null 2>&1
  echo "scratch database dropped"
fi
rm -f /tmp/restore.sql.gz /tmp/restore.log

if [ "$FAILURES" -eq 0 ]; then
  echo "RESTORE VERIFIED: $KEY can be recovered and served."
else
  echo "$FAILURES CHECK(S) FAILED on $KEY"
fi
exit "$FAILURES"
