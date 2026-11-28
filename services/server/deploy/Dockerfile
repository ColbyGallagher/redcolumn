# syntax=docker/dockerfile:1

# Multi-stage OCI image for the self-hosted redcolumn server.
# Builds the @nb/web static assets and bundles them alongside @nb/server.

FROM node:24-trixie-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

# Stage 1: build the web app static bundle.
FROM base AS web-builder
WORKDIR /src

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
COPY packages/i18n/package.json packages/i18n/
COPY packages/markup/package.json packages/markup/
COPY packages/measure/package.json packages/measure/
COPY packages/ops/package.json packages/ops/
COPY packages/pdf-core/package.json packages/pdf-core/
COPY packages/policy/package.json packages/policy/
COPY packages/sheets/package.json packages/sheets/
COPY packages/stitch/package.json packages/stitch/
COPY services/server/package.json services/server/

RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages/ packages/
COPY apps/web/ apps/web/

RUN pnpm --filter @nb/web build

# Stage 2: install production dependencies for @nb/server and its transitive workspace packages.
FROM base AS server-deps
WORKDIR /src

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/desktop/package.json apps/desktop/
COPY apps/web/package.json apps/web/
COPY e2e/package.json e2e/
COPY packages/i18n/package.json packages/i18n/
COPY packages/markup/package.json packages/markup/
COPY packages/measure/package.json packages/measure/
COPY packages/ops/package.json packages/ops/
COPY packages/pdf-core/package.json packages/pdf-core/
COPY packages/policy/package.json packages/policy/
COPY packages/sheets/package.json packages/sheets/
COPY packages/stitch/package.json packages/stitch/
COPY services/server/package.json services/server/

RUN pnpm --filter @nb/server... install --frozen-lockfile --prod --ignore-scripts

# Stage 3: minimal runtime image with non-root user and PostgreSQL 17 pg_dump/pg_restore support.
FROM node:24-trixie-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 redcolumn \
  && useradd --uid 10001 --gid 10001 --home-dir /app --shell /usr/sbin/nologin redcolumn

WORKDIR /app

COPY --from=server-deps /src/package.json /src/pnpm-workspace.yaml ./
COPY --from=server-deps /src/node_modules ./node_modules
COPY --from=server-deps /src/packages/i18n/package.json ./packages/i18n/
COPY packages/i18n/src ./packages/i18n/src
COPY --from=server-deps /src/packages/sheets/package.json ./packages/sheets/
COPY packages/sheets/src ./packages/sheets/src
COPY --from=server-deps /src/packages/measure/package.json ./packages/measure/
COPY --from=server-deps /src/packages/measure/node_modules ./packages/measure/node_modules
COPY packages/measure/src ./packages/measure/src
COPY --from=server-deps /src/packages/markup/package.json ./packages/markup/
COPY --from=server-deps /src/packages/markup/node_modules ./packages/markup/node_modules
COPY packages/markup/src ./packages/markup/src
COPY --from=server-deps /src/packages/ops/package.json ./packages/ops/
COPY --from=server-deps /src/packages/ops/node_modules ./packages/ops/node_modules
COPY packages/ops/src ./packages/ops/src
COPY --from=server-deps /src/services/server/package.json ./services/server/
COPY --from=server-deps /src/services/server/node_modules ./services/server/node_modules
COPY services/server/migrations ./services/server/migrations
COPY services/server/src ./services/server/src
COPY --from=web-builder /src/apps/web/dist ./web

RUN printf '#!/bin/sh\nexec node --experimental-strip-types /app/services/server/src/cli.ts "$@"\n' > /usr/local/bin/redcolumn-admin \
  && chmod 0755 /usr/local/bin/redcolumn-admin \
  && mkdir -p /var/lib/redcolumn/blobs \
  && chown -R redcolumn:redcolumn /app /var/lib/redcolumn

# WEB_DIST_DIR holds the built @nb/web static bundle; static serving from this
# directory is wired up in the follow-up server web-serving change.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BLOB_DIR=/var/lib/redcolumn/blobs \
    WEB_DIST_DIR=/app/web

USER redcolumn
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--experimental-strip-types", "/app/services/server/src/index.ts"]
