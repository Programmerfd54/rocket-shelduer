FROM node:20

# Увеличим таймауты npm и настроим повторные попытки
ENV npm_config_fetch_timeout=600000
ENV npm_config_fetch_retries=5
ENV npm_config_fetch_retry_maxtimeout=120000

WORKDIR /app

# Установим системные зависимости для sharp
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 git curl ca-certificates pkg-config libvips-dev \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# если у вас package-lock.json — копируйте его тоже
COPY package-lock*.json ./

# Если нужен альтернативный registry (например внутренний зеркало), можно указать:
# RUN npm config set registry https://registry.npmjs.org/

RUN npm ci --include=optional --unsafe-perm

COPY . .

# сборка приложения (если нужно)
RUN npm run build --if-present

EXPOSE 3000
CMD ["npm", "start"]
