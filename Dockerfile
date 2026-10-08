# ============ Stage 1: Build ============
FROM node:20 AS builder

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

# npm ci: ставит ровно версии из package-lock.json (с проверкой integrity), не обновляя lock-файл
RUN npm ci --include=optional

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# Удаляем devDependencies для уменьшения размера
RUN npm prune --omit=dev

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

# Копируем только нужное для production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

# Каталоги загрузок существуют в образе: при первом монтировании пустого named volume Docker копирует
# туда содержимое образа (уже загруженные файлы) с владельцем nextjs.
RUN mkdir -p public/help-uploads public/uploads/avatars \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs \
    && chown -R nextjs:nodejs /app

USER nextjs

EXPOSE 3000

# Секрет передаётся заголовком (не попадает в access-логи и URL)
# Если HEALTH_CHECK_SECRET не задан, проверка идёт без заголовка (эндпоинт тогда открыт, как в прежней версии)
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -sf ${HEALTH_CHECK_SECRET:+-H "X-Health-Secret: ${HEALTH_CHECK_SECRET}"} "http://localhost:3000/api/health" || exit 1

# create-superuser создаёт LEAD_SUP только если его ещё нет (случайный пароль печатается один раз в лог,
# либо SUPERUSER_PASSWORD из env); при первом входе требуется смена пароля.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/create-superuser.ts && exec npm start"]
