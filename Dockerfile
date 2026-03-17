# ============ Stage 1: Build ============
FROM node:20 AS builder

# Build tools for native modules (sharp, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-retries 5 \
    && npm config set registry https://registry.npmjs.org/

RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

# ============ Stage 2: Runner ============
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy standalone output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma schema and migrations for migrate deploy
COPY --from=builder /app/prisma ./prisma

# Scripts for create-superuser
COPY --from=builder /app/scripts ./scripts

# package.json for prisma/tsx (standalone has minimal node_modules)
COPY --from=builder /app/package.json ./

# Install prisma + tsx for migrate and create-superuser (minimal)
RUN npm install prisma@5.22.0 tsx --omit=dev --ignore-scripts

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -sf "http://localhost:3000/api/health?secret=${HEALTH_CHECK_SECRET}" || exit 1

CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/create-superuser.ts && node server.js"]
