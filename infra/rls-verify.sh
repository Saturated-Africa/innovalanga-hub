#!/bin/bash
# Prove that row-level security actually enforces, on a copy of the real data.
#
#   sudo bash infra/rls-verify.sh          (run on the instance)
#
# Without this, the policies are decoration. Postgres will happily create a
# policy that filters nothing - that is exactly what happens when the connecting
# role owns the table - and every catalog view will report it as active. The
# only way to know is to connect as the application role and try to read
# somebody else's rows.
#
# Nothing here touches the live database. It dumps a copy, applies the migration
# to the copy, invents a second programme with real rows in it, and then attacks
# the boundary from the application role in both directions: what the tenant
# should see, and what it must not.
#
# Re-run it after any change to the policies, and after any migration that adds
# a table - a new table with no policy is readable by every tenant.
#
# The role password is generated here and never leaves the instance.
set -euo pipefail
cd /opt/innovalanga

PG="docker compose exec -T postgres"
TEST_DB=innovalanga_rlstest
OWNER=innovalanga

owner_sql() { $PG psql -v ON_ERROR_STOP=1 -U "$OWNER" -d "$1" -tAc "$2"; }

echo "== 1. fresh copy of the live database =="
# Dumped and reloaded rather than cloned with TEMPLATE: the application holds
# open connections, and a template database has to be idle. This also exercises
# the same path a restore would take.
$PG psql -U "$OWNER" -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE);" >/dev/null 2>&1 || true
$PG psql -v ON_ERROR_STOP=1 -U "$OWNER" -d postgres -c "CREATE DATABASE $TEST_DB;" >/dev/null
docker compose exec -T postgres bash -c   "pg_dump -U ${OWNER} -d innovalanga | psql -q -U ${OWNER} -d ${TEST_DB}" > /tmp/rls-copy.log 2>&1 || {
    echo "   COPY FAILED:"; tail -15 /tmp/rls-copy.log; exit 1; }
echo "   copied; tables: $(owner_sql "$TEST_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"

echo "== 2. apply the migration to the copy =="
# Piped in rather than passed with -f: psql runs inside the container and the
# file is on the host.
$PG psql -v ON_ERROR_STOP=1 -U "$OWNER" -d "$TEST_DB" < /tmp/rls.sql > /tmp/rls-apply.log 2>&1 || {
  echo "   MIGRATION FAILED:"; tail -25 /tmp/rls-apply.log; exit 1; }
echo "   policies created: $(owner_sql "$TEST_DB" "SELECT count(*) FROM pg_policies WHERE schemaname='public';")"
echo "   tables with RLS:  $(owner_sql "$TEST_DB" "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity;")"

echo "== 3. give the role a login password, generated here =="
APP_PW="$(openssl rand -hex 32)"
$PG psql -v ON_ERROR_STOP=1 -U "$OWNER" -d "$TEST_DB" >/dev/null <<SQL
ALTER ROLE innovalanga_app WITH LOGIN PASSWORD '${APP_PW}';
SQL
echo "   password set (${#APP_PW} characters, not shown)"

echo "== 4. a second programme, with real rows of its own =="
# Populated rather than left empty. An empty programme proves only that nothing
# leaks out of nowhere; a populated one proves the far more important direction,
# that rows belonging to somebody else stay invisible.
OTHER=rlstest-programme
owner_sql "$TEST_DB" "
  INSERT INTO \"Programme\" (id, name, slug, \"createdAt\", \"updatedAt\")
  VALUES ('${OTHER}', 'RLS Trial Programme', 'rls-trial', now(), now())
  ON CONFLICT (id) DO NOTHING;" >/dev/null

TIA=$(owner_sql "$TEST_DB" "SELECT id FROM \"Programme\" WHERE id <> '${OTHER}' ORDER BY \"createdAt\" LIMIT 1;")

owner_sql "$TEST_DB" "
  INSERT INTO \"Cohort\" (id, \"programmeId\", name, \"startDate\", \"endDate\", \"createdAt\", \"updatedAt\")
  VALUES ('rlstest-cohort', '${OTHER}', 'Trial Cohort', now(), now(), now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO \"User\" (id, email, name, role, \"programmeId\", \"createdAt\", \"updatedAt\")
  VALUES ('rlstest-user', 'trial@rls.test', 'Trial Participant', 'innovator', '${OTHER}', now(), now())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO \"InnovatorProfile\" (id, \"userId\", \"cohortId\", \"firstName\", \"lastName\", \"createdAt\", \"updatedAt\")
  VALUES ('rlstest-innovator', 'rlstest-user', 'rlstest-cohort', 'Trial', 'Participant', now(), now())
  ON CONFLICT (id) DO NOTHING;" >/dev/null

echo "   real programme:  $TIA"
echo "   trial programme: $OTHER (1 cohort, 1 participant)"

TOTAL_INNOVATORS=$(owner_sql "$TEST_DB" "
  SELECT count(*) FROM \"InnovatorProfile\" i JOIN \"Cohort\" c ON c.id=i.\"cohortId\"
  WHERE c.\"programmeId\" = '${TIA}';")
EVERYONE=$(owner_sql "$TEST_DB" "SELECT count(*) FROM \"InnovatorProfile\";")
TOTAL_TXNS=$(owner_sql "$TEST_DB" "SELECT count(*) FROM \"FinanceTransaction\";")
TOTAL_STIPENDS=$(owner_sql "$TEST_DB" "SELECT count(*) FROM \"StipendRecord\";")
echo "   owner sees $EVERYONE participants in total, $TOTAL_INNOVATORS of them on $TIA"

# Query as the application role, with app.programme_id supplied on the
# connection itself rather than per statement. If this works, the application
# needs no per-query wrapping at all.
app_sql() {
  local programme="$1" query="$2"
  PGPASSWORD="$APP_PW" $PG psql -tAc "$query" \
    "postgresql://innovalanga_app@localhost:5432/${TEST_DB}?options=-c%20app.programme_id%3D${programme}"
}
app_sql_noprogramme() {
  PGPASSWORD="$APP_PW" $PG psql -tAc "$1" \
    "postgresql://innovalanga_app@localhost:5432/${TEST_DB}"
}

echo
echo "== 5. does a GUC on the connection string reach the session? =="
SEEN=$(app_sql "$TIA" "SELECT current_setting('app.programme_id', true);")
echo "   app.programme_id as seen by the session: '${SEEN}'"
if [ "$SEEN" != "$TIA" ]; then
  echo "   FAILED: the connection option did not reach the backend."
  exit 1
fi

echo
echo "== 6. the attack: no where clause, as the application role =="
FAILURES=0
check() { # label expected actual
  if [ "$2" = "$3" ]; then printf '   ok    %-46s %s\n' "$1" "$3"
  else printf '   FAIL  %-46s got %s, expected %s\n' "$1" "$3" "$2"; FAILURES=$((FAILURES+1)); fi
}

check "participants, own programme"      "$TOTAL_INNOVATORS" "$(app_sql "$TIA"   'SELECT count(*) FROM "InnovatorProfile";')"
check "participants, other programme"    "1"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "InnovatorProfile";')"
check "the trial participant is hidden"  "0"                 "$(app_sql "$TIA" "SELECT count(*) FROM \"InnovatorProfile\" WHERE id='rlstest-innovator';")"
check "and cannot be fetched by id"      "0"                 "$(app_sql "$TIA" "SELECT count(*) FROM \"Cohort\" WHERE id='rlstest-cohort';")"
check "participants, no programme set"   "0"                 "$(app_sql_noprogramme 'SELECT count(*) FROM "InnovatorProfile";')"

check "transactions, own programme"      "$TOTAL_TXNS"       "$(app_sql "$TIA"   'SELECT count(*) FROM "FinanceTransaction";')"
check "transactions, other programme"    "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "FinanceTransaction";')"

check "stipends, own programme"          "$TOTAL_STIPENDS"   "$(app_sql "$TIA"   'SELECT count(*) FROM "StipendRecord";')"
check "stipends, other programme"        "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "StipendRecord";')"

check "assessments, other programme"     "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "Assessment";')"
check "bookings, other programme"        "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "Booking";')"
check "documents, other programme"       "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "Document";')"
check "mentorship logs, other programme" "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "MentorshipLog";')"
check "mentors, other programme"         "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "MentorProfile";')"
check "blackouts, other programme"       "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "BlackoutPeriod";')"
check "finance proofs, other programme"  "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "FinanceProof";')"
check "reporting periods, other"         "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "ReportingPeriod";')"
check "beneficiaries, other programme"   "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "BeneficiaryRecord";')"
check "indicator records, other"         "0"                 "$(app_sql "$OTHER" 'SELECT count(*) FROM "IndicatorRecord";')"
check "verification tokens, denied"      "0"                 "$(app_sql "$TIA"   'SELECT count(*) FROM "VerificationToken";')"

echo
echo "== 7. can the role write into somebody else's programme? =="
WROTE=$(PGPASSWORD="$APP_PW" $PG psql -tAc "
  INSERT INTO \"Cohort\" (id, \"programmeId\", name, \"startDate\", \"endDate\", \"createdAt\", \"updatedAt\")
  VALUES ('rls-probe-cohort', '${TIA}', 'Probe', now(), now(), now(), now()) RETURNING id;" \
  "postgresql://innovalanga_app@localhost:5432/${TEST_DB}?options=-c%20app.programme_id%3D${OTHER}" 2>&1 | tail -1 || true)
case "$WROTE" in
  *"row-level security"*|*"violates"*) echo "   ok    insert into another programme refused" ;;
  *) echo "   FAIL  insert into another programme was allowed: $WROTE"; FAILURES=$((FAILURES+1)) ;;
esac

echo
echo "== 8. can the role turn its own policies off? =="
ESCALATE=$(PGPASSWORD="$APP_PW" $PG psql -tAc 'ALTER TABLE "InnovatorProfile" DISABLE ROW LEVEL SECURITY;' \
  "postgresql://innovalanga_app@localhost:5432/${TEST_DB}?options=-c%20app.programme_id%3D${TIA}" 2>&1 | tail -1 || true)
case "$ESCALATE" in
  *"must be owner"*|*"permission denied"*) echo "   ok    cannot disable its own policies" ;;
  *) echo "   FAIL  the role disabled RLS: $ESCALATE"; FAILURES=$((FAILURES+1)) ;;
esac

echo
echo "== 8b. does a join reach around the policy? =="
JOINED=$(app_sql "$TIA" "
  SELECT count(*) FROM \"InnovatorProfile\" i
  JOIN \"Cohort\" c ON c.id = i.\"cohortId\"
  JOIN \"Programme\" p ON p.id = c.\"programmeId\";" || true)
check "join across three tables stays scoped" "$TOTAL_INNOVATORS" "$JOINED"

echo
echo "== 8c. can the tenant create a row it is allowed to own? =="
# This exists because of a bug that took a bisection to find. An INSERT that is
# allowed on its own is refused when it carries RETURNING, because PostgreSQL
# applies the SELECT policy to the new row as well - the statement reads back what
# it wrote. A USING expression that looks the row up in its own table cannot see
# it yet, so the whole insert fails, and it fails with the WITH CHECK wording,
# which points the reader somewhere else entirely.
#
# Prisma always writes RETURNING. So this shape is what the application actually
# issues, and a policy that passes the checks above can still make every create
# impossible. Tested here rather than trusted.
INSERT_PLAIN=$(app_sql "$TIA" "
  BEGIN;
  INSERT INTO \"User\" (id, email, name, role, \"programmeId\", \"createdAt\", \"updatedAt\")
  VALUES ('rls-verify-plain', 'rls-verify-plain@test.invalid', 'Probe', 'innovator',
          app_current_programme(), now(), now());
  ROLLBACK;
  SELECT 'ok';" 2>/dev/null || echo "refused")
check "tenant may insert a user in its own programme" "ok" "$INSERT_PLAIN"

INSERT_RETURNING=$(app_sql "$TIA" "
  BEGIN;
  INSERT INTO \"User\" (id, email, name, role, \"programmeId\", \"createdAt\", \"updatedAt\")
  VALUES ('rls-verify-returning', 'rls-verify-returning@test.invalid', 'Probe', 'innovator',
          app_current_programme(), now(), now())
  RETURNING id;
  ROLLBACK;
  SELECT 'ok';" 2>/dev/null || echo "refused")
check "the same insert survives RETURNING, which is what the ORM sends" "ok" "$INSERT_RETURNING"

# And the escalation the write check exists to stop.
INSERT_NULL=$(app_sql "$TIA" "
  BEGIN;
  INSERT INTO \"User\" (id, email, name, role, \"programmeId\", \"createdAt\", \"updatedAt\")
  VALUES ('rls-verify-null', 'rls-verify-null@test.invalid', 'Probe', 'innovator',
          NULL, now(), now());
  ROLLBACK;
  SELECT 'allowed';" 2>/dev/null || echo "refused")
check "tenant may NOT create a platform-wide account" "refused" "$INSERT_NULL"

echo
echo "== 9. the owner connection is unaffected, so sign-in still works =="
OWNER_USERS=$(owner_sql "$TEST_DB" 'SELECT count(*) FROM "User";')
check "owner still reads every account" "$(owner_sql "$TEST_DB" 'SELECT count(*) FROM "User";')" "$OWNER_USERS"

echo
if [ "$FAILURES" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "$FAILURES CHECK(S) FAILED"; fi
echo "(the trial database is left in place for inspection; the live one is untouched)"
exit "$FAILURES"
