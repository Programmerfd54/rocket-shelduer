FROM node:20

WORKDIR /app

# Системные зависимости для сборки sharp из исходников (пребилд linux-x64 требует v2 microarchitecture)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# Копируем только package — зависимости ставим внутри контейнера
COPY package*.json ./
RUN npm install --include=optional

# Копируем исходники
COPY . .

# Удаляем пребилд linux-x64 (несовместим со старыми CPU) и собираем sharp из исходников через системный libvips
RUN rm -rf node_modules/@img/sharp-linux-x64 node_modules/@img/sharp-libvips-linux-x64 2>/dev/null; \
    SHARP_FORCE_GLOBAL_LIBVIPS=1 npm rebuild sharp

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Запускаем приложение
CMD npx prisma migrate deploy && npm run create-superuser && npm start
