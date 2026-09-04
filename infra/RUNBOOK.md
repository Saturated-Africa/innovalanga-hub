# Innovalanga Hub deployment runbook

Target: AWS af-south-1 (Cape Town). A single EC2 host running the application,
Postgres and Caddy as containers. Estimated run rate is in the TCO document.

## 0. Prerequisites

- **af-south-1 is an opt-in region.** Enable it on the account first, or every
  command below fails with an opaque authorisation error.
- `aws login` — profiles `default` and `saturagent` exist on this machine; the
  session was expired at the time of writing.
- Access to DNS for `innovalanga.co.za` at 1-Grid, for step 5.

Confirm the Bedrock inference profile id before deploying. af-south-1 serves
Claude 4.5 only through **global** cross-region profiles:

```bash
aws bedrock list-inference-profiles --region af-south-1 \
  --query "inferenceProfileSummaries[?contains(inferenceProfileId, 'anthropic')].inferenceProfileId"
```

Set the result as `AI_MODEL` in step 4.

## 1. Deploy the infrastructure

```bash
cd infra
npm install
npx cdk bootstrap aws://ACCOUNT_ID/af-south-1

npx cdk synth --strict -c account=ACCOUNT_ID    # review the templates
npx cdk diff -c account=ACCOUNT_ID              # review what will change
npx cdk deploy --all -c account=ACCOUNT_ID
```

To use managed Postgres instead of the container, add `-c database=rds`. That
is the only change required; the application is unaware of the difference.

Note the stack outputs: `ElasticIp`, `InstanceId`, `RepositoryUri`.

## 2. Fill in the secrets

CDK generates `NEXTAUTH_SECRET` and `CRON_SECRET`. Three values must be set by
hand, once, on the secret `innovalanga/app`:

| Key | Value |
|---|---|
| `ENCRYPTION_KEY` | **Must match the existing key byte for byte.** `lib/encryption.ts` pads or truncates it as raw UTF-8, not hex, despite the comment in `.env.example`. Change it and every stored `idNumberEncrypted` value becomes permanently unreadable. |
| `RESEND_API_KEY` | From the Resend dashboard. |
| `POSTGRES_PASSWORD` | Any strong value; only the container reads it. |

Set these in the console, not in a shared terminal.

## 3. Build and push the image

**Do not build on the instance.** `next build` needs roughly 1.5-2 GB and a
t4g.small has 2 GiB in total, shared with Postgres. Build on a machine with
arm64 support, or in CodeBuild on an ARM image.

```bash
aws ecr get-login-password --region af-south-1 \
  | docker login --username AWS --password-stdin REPOSITORY_URI

docker buildx build --platform linux/arm64 -t REPOSITORY_URI:latest --push .
```

## 4. Start the application

```bash
aws ssm start-session --target INSTANCE_ID --region af-south-1
```

On the instance, place `docker-compose.yml` and `Caddyfile` in
`/opt/innovalanga`, write `.env` from Secrets Manager, then:

```bash
cd /opt/innovalanga
docker compose pull
docker compose up -d
docker compose exec app npx prisma migrate deploy
docker compose exec app npx prisma db seed      # first deploy only
```

Environment values the container needs, beyond the secrets:
`NEXTAUTH_URL=https://hub.innovalanga.co.za`, `AWS_REGION=af-south-1`,
`AWS_S3_BUCKET` (from the Data stack), `AI_PROVIDER=bedrock`, and `AI_MODEL`
from step 0.

## 5. DNS and TLS

Add at 1-Grid:

```
hub.innovalanga.co.za.   A   ELASTIC_IP
```

Caddy requests the certificate automatically on the first request once the
record resolves. Verify:

```bash
curl -I https://hub.innovalanga.co.za/api/health
curl -s "https://hub.innovalanga.co.za/api/health?deep=1"
```

## 6. Verification

Log in as each seeded role:

| Role | Credentials |
|---|---|
| super_admin | `admin@innovalanga.co.za` / `Admin@1234` |
| facilitator | `facilitator@innovalanga.co.za` / `Facilitator@1234` |
| mentor | `mentor1@innovalanga.co.za` / `Mentor@1234` |
| innovator | `zanele@innovalanga.co.za` / `Innovator@1234` |
| funder_viewer | `funder@tia.gov.za` / `Funder@1234` |

Then check these, in order of how much they would cost you if wrong:

1. As `funder@tia.gov.za`, request `/api/reports/export?type=stipends`. Must be
   **403**, not a CSV of names and individual payment amounts.
2. As a facilitator, confirm the dashboard counts cover only their programme.
3. Ask the assistant a question, then confirm in CloudWatch that no real
   participant name appears in the outbound Bedrock request.
4. Confirm the assistant **streams** — the answer should appear progressively.
   Arriving in one lump means Caddy buffering, not a model problem.
5. Confirm the schedule ran: check the `innovalanga-cron-invoker` log group.

## 7. Backups

Daily EBS snapshots are configured by the CDK. Add the nightly database dump as
a cron entry on the instance (`crontab -e`), where `BACKUP_BUCKET` comes from
the Data stack outputs:

```
0 0 * * * cd /opt/innovalanga && docker compose exec -T postgres pg_dump -U innovalanga innovalanga | gzip | aws s3 cp - s3://BACKUP_BUCKET/pg/$(date +\%F).sql.gz
```

Note the escaped `\%F`: cron treats an unescaped `%` as a newline and the
command will silently fail without it.

**Test a restore before relying on this.** An untested backup is not a backup.
With the database running as a container rather than RDS, this dump and the EBS
snapshots are the entire recovery story.

## Rollback

```bash
docker compose pull PREVIOUS_TAG && docker compose up -d
```

The `InnovalangaData` stack carries termination protection, so tearing down or
redeploying the application stack never touches documents, secrets or the
database.

## What is deliberately not deployed

`InnovalangaOllama` synthesises but is excluded from the default set, so
`cdk deploy --all` cannot accidentally start a GPU instance. To deploy it:

```bash
npx cdk deploy InnovalangaOllama -c ollama=true -c account=ACCOUNT_ID
```

Then set `AI_PROVIDER=ollama` and `OLLAMA_BASE_URL` to the host's private
address. Pseudonymisation becomes a no-op at that point, because prompts no
longer leave the VPC.
