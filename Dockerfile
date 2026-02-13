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
COPY package-lock*.json ./

# Настраиваем npm с правильными таймаутами и отключаем strict-ssl временно
RUN npm config set fetch-retry-mintimeout 20000 \
    && npm config set fetch-retry-maxtimeout 120000 \
    && npm config set fetch-retries 5 \
    && npm config set strict-ssl false \
    && npm config set registry https://registry.npmjs.org/

# Очищаем кэш npm перед установкой
RUN npm cache clean --force

# Устанавливаем зависимости с verbose выводом для отладки
RUN npm ci --include=optional --unsafe-perm --verbose

# Копируем остальной код
COPY . .

# Генерируем Prisma клиент
RUN npx prisma generate

# Собираем приложение
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]