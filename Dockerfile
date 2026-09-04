# syntax=docker/dockerfile:1
#
# Innovalanga Hub runtime image.
#
# Target: linux/arm64 (Graviton t4g on Amazon Linux 2023).
#
# Build this OFF the instance. `next build` needs roughly 1.5-2 GB and a
# t4g.small has 2 GiB total, so building in place will OOM. Use CodeBuild on an
# ARM image, GitHub Actions on arm64, or `docker buildx` locally, then push to
# ECR and have the instance only pull and run.
#
#   docker buildx build --platform linux/arm64 -t innovalanga-hub:latest .

# Debian bookworm rather than Alpine: Prisma's engine for
# linux-arm64-openssl-3.0.x is glibc-linked, and the musl variant is a different
# binaryTarget. Matching the base to the declared target avoids a class of
# "engine not found" failures at first query.
FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1


# ---------------------------------------------------------------------------
# deps: install with the lockfile only, so this layer caches across code edits
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app

# openssl is required by the Prisma query engine at runtime and at generate time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci


# ---------------------------------------------------------------------------
# builder: generate the Prisma client and build the standalone server
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Run generate INSIDE the target architecture. schema.prisma also declares
# binaryTargets for linux-arm64-openssl-3.0.x, so a cross-arch or cached build
# still produces the right engine; this is the belt-and-braces half.
RUN npx prisma generate

# The build reads env vars but must not bake secrets. Real values are injected
# at runtime; these placeholders only satisfy anything read at build time.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build


# ---------------------------------------------------------------------------
# runner: standalone output only
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates wget \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public

# Standalone traces only the reachable server files. Ownership is set on copy so
# no recursive chown layer is needed.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma schema and the generated engine, needed to run migrations from this
# same image at deploy time.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000

# Liveness only. The deep variant touches the database, and a database blip
# should not cause the runtime to kill an otherwise healthy process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
