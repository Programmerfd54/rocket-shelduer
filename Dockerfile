FROM node:20

# Устанавливаем необходимые пакеты для сборки native модулей
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    git \
    curl \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Копируем файлы зависимостей
COPY package*.json ./

# Настраиваем npm с правильными таймаутами
RUN npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-retries 5 \
    && npm config set registry https://registry.npmjs.org/

# Очищаем кэш npm перед установкой
RUN npm cache clean --force

# Используем npm install вместо npm ci для разрешения конфликтов версий
RUN npm install --include=optional --verbose

# Копируем остальной код
COPY . .

# Генерируем Prisma клиент
RUN npx prisma generate

# Собираем приложение
RUN npm run build

# Создаём непривилегированного пользователя и передаём владение
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000

# В production требуется HEALTH_CHECK_SECRET; передайте его в docker run -e
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD sh -c 'curl -sf "http://localhost:3000/api/health?secret=$${HEALTH_CHECK_SECRET}" || exit 1'

CMD ["npm", "start"]