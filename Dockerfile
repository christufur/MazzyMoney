# syntax=docker/dockerfile:1
#
# One image for the whole app: Express serves the API and the built React files,
# so there is a single origin, a single port, and no CORS.

# --- Stage 1: build the React frontend ---------------------------------------
FROM oven/bun:1-slim AS web

WORKDIR /app/frontend

# Dependencies first, so a code change does not reinstall them.
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile

COPY frontend/ ./
RUN bun run build

# --- Stage 2: runtime image (API + static frontend) --------------------------
FROM oven/bun:1-slim AS app

# Prisma's query engine is a native binary that needs OpenSSL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV TZ=UTC \
    NODE_ENV=production \
    WEB_DIR=/app/frontend/dist \
    HOME=/home/bun

WORKDIR /app

# Production dependencies only. `prisma` is a regular dependency on purpose:
# the container runs `prisma migrate deploy` on start.
COPY backend/package.json backend/bun.lock ./
RUN bun install --frozen-lockfile --production

# Backend source. There is no compile step; Bun runs the TypeScript directly.
COPY backend/ ./

# The generated client lives in prisma/generated (gitignored) and must match this
# OS, so it is generated inside the image.
RUN bunx prisma generate

# Built frontend. The app serves it from WEB_DIR.
COPY --from=web /app/frontend/dist ./frontend/dist

EXPOSE 8000

# Non-root. /app stays root-owned and only needs to be read at runtime;
# HOME is set above so the Prisma CLI has a writable cache directory.
USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "bunx prisma migrate deploy && bun src/index.ts"]
