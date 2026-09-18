#!/bin/bash
#
# Nightly database dump to S3.
#
# The runbook has described this since the platform was first deployed. It did
# not exist. There was no crontab, no timer, and the backups bucket held nothing
# but build artefacts. The only reason a day's work was recoverable after the
# instance was replaced was a block-level snapshot taken for other reasons.
#
# A block snapshot is a coarse instrument: it restores a whole filesystem to a
# point in time and cannot be inspected or partially restored. A dump can be
# read, diffed, restored into a different environment, and checked. Both are
# worth having; only one of them existed.
#
# Installed by infra/deploy.sh and run by a systemd timer, so it is reinstated
# on every deploy rather than depending on somebody remembering.
set -euo pipefail

APP=/opt/innovalanga
cd "$APP"

# Read configuration without echoing any of it.
set +x
BUCKET="$(grep -E '^BACKUP_BUCKET=' .env | cut -d= -f2- | tr -d '\r\n' || true)"
PGUSER="$(grep -E '^POSTGRES_USER=' .env | cut -d= -f2- | tr -d '\r\n' || echo innovalanga)"
PGDB="$(grep -E '^POSTGRES_DB=' .env | cut -d= -f2- | tr -d '\r\n' || echo innovalanga)"

if [ -z "$BUCKET" ]; then
  echo "BACKUP_BUCKET is not set in $APP/.env; nothing to do." >&2
  exit 1
fi

STAMP="$(date -u +%Y-%m-%dT%H%M%SZ)"
KEY="pg/${STAMP}.sql.gz"
TMP="$(mktemp /tmp/pgdump.XXXXXX.sql.gz)"
trap 'rm -f "$TMP"' EXIT

echo "dumping ${PGDB}"
# --clean --if-exists so the dump can be restored over an existing database.
docker compose exec -T postgres pg_dump \
  --username "$PGUSER" \
  --dbname "$PGDB" \
  --clean --if-exists --no-owner --no-privileges \
  | gzip -9 > "$TMP"

SIZE=$(stat -c%s "$TMP")
echo "dump is ${SIZE} bytes"

# A dump that is suspiciously small usually means pg_dump failed and wrote an
# error into the pipe. Uploading that over a good backup is how a backup system
# becomes worse than none, so it is refused.
if [ "$SIZE" -lt 10240 ]; then
  echo "FAILED: dump is under 10 KiB, refusing to upload" >&2
  exit 1
fi

# Confirm it is a real gzip stream and that the SQL inside mentions a table.
if ! gzip -t "$TMP" 2>/dev/null; then
  echo "FAILED: not a valid gzip stream" >&2
  exit 1
fi
# Look through the whole dump, not a window at the top of it. With --clean the
# first couple of hundred lines are DROP statements, so a check confined to the
# head of the file rejects every healthy dump - which is exactly what it did the
# first time this ran.
TABLES=$(zcat "$TMP" | grep -c "^CREATE TABLE" || true)
if [ "${TABLES:-0}" -lt 1 ]; then
  echo "FAILED: dump defines no tables" >&2
  exit 1
fi
echo "dump defines ${TABLES} tables"

echo "uploading s3://${BUCKET}/${KEY}"
aws s3 cp "$TMP" "s3://${BUCKET}/${KEY}" --only-show-errors

# The instance role is deliberately PUT-only on this bucket, so the upload
# cannot be read back to verify it. The size check above is the verification
# available from here. The other half is rehearsing a restore, which
# infra/restore-verify.sh does against a scratch database.

# Report success, so that silence means something.
#
# Everything above fails loudly into a log nobody reads. This publishes one
# datapoint per successful backup, and an alarm watches for its absence: if this
# script stops running, or starts failing, the metric simply stops appearing and
# the alarm fires on missing data. A metric written only on success is the point
# - a failure cannot accidentally report health.
#
# The whole thing is wrapped so it can never fail the backup. Health reporting
# that breaks the thing it reports on is worse than no reporting, and this
# already did exactly that: a grep for a line that was not in .env returned
# non-zero, set -e killed the script after a perfectly good upload, and the
# backup was recorded as failed.
report_health() {
  local token region environment
  token=$(curl -sX PUT http://169.254.169.254/latest/api/token     -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null) || return 1
  region=$(curl -s -H "X-aws-ec2-metadata-token: ${token}"     http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null) || return 1
  [ -n "$region" ] || return 1

  environment=$(grep -E '^ENVIRONMENT=' "$APP/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r') || true
  [ -n "$environment" ] || environment=sandbox

  aws cloudwatch put-metric-data --region "$region"     --namespace Innovalanga --metric-name BackupSucceeded     --dimensions "Environment=${environment}" --value 1 --unit Count 2>/dev/null || return 1

  # The size too, so a dump that silently shrinks is visible before it matters.
  aws cloudwatch put-metric-data --region "$region"     --namespace Innovalanga --metric-name BackupSizeBytes     --dimensions "Environment=${environment}" --value "$SIZE" --unit Bytes 2>/dev/null || true

  echo "reported to CloudWatch as ${environment}"
}

report_health || echo "WARNING: could not report to CloudWatch. The backup itself is fine."

echo "done: ${KEY} (${SIZE} bytes)"
