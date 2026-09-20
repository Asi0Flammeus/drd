# ==============================================================================
# DRD — production image
#
# Two stages. The builder installs every dependency and compiles the client;
# the runtime keeps production dependencies, the built client, the server
# sources (Node runs the TypeScript directly — there is no server build step)
# and the Chrome that Puppeteer pinned.
#
# Chrome comes from Puppeteer rather than from Debian's `chromium` package on
# purpose: the capture pipeline speaks CDP to it, and a browser whose version
# was chosen by the distribution is a protocol mismatch waiting for a quiet
# afternoon. The download is ~180 MB and it is the price of a capture endpoint
# that works the day it ships.
# ==============================================================================

FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY server ./server
COPY scripts ./scripts
COPY test ./test
RUN npm run build

# ------------------------------------------------------------------ runtime --
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PUPPETEER_CACHE_DIR=/opt/puppeteer \
    DRD_HOST=0.0.0.0 \
    DRD_PORT=5178 \
    DRD_DATA_DIR=/app/data \
    DRD_CLIENT_DIR=/app/dist/client \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

# Chrome's own runtime libraries, plus fonts — without fonts a captured page
# renders in a fallback face and every typography reference is a lie.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-color-emoji \
      fonts-dejavu-core \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libexpat1 \
      libgbm1 \
      libglib2.0-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      tini \
      wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npx puppeteer browsers install chrome \
    && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
COPY tsconfig.server.json ./

# Chrome must not run as root, and neither must anything else here. The data
# directory is the only writable path the application needs. Both it and the
# browser cache are group-writable so the image still works when compose runs
# it as the uid that owns a bind-mounted ./data.
RUN useradd --system --create-home --uid 10001 drd \
    && mkdir -p /app/data \
    && chown -R drd:0 /app/data /opt/puppeteer \
    && chmod -R g+rwX /app/data /opt/puppeteer
USER drd
# That uid may not own /home/drd, and Chrome needs a writable HOME. /tmp is a
# tmpfs in the compose file.
ENV HOME=/tmp

VOLUME ["/app/data"]
EXPOSE 5178

# Migrations are idempotent and run in a transaction each, so applying them on
# every start is safe and removes the "did anyone run migrate?" failure mode.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DRD_PORT||5178)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "node scripts/migrate.ts && exec node server/main.ts"]
