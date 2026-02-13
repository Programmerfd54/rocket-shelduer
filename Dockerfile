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

# Удаляем пребилды sharp для linux-x64: на части серверов они требуют «v2 microarchitecture»
# (новый CPU), и при сборке Next вылетает «Could not load the sharp module». Удаление заставляет
# sharp собраться из исходников через системный libvips (см. выше apt-get libvips-dev).
RUN rm -rf node_modules/@img/sharp-linux-x64 node_modules/@img/sharp-libvips-linux-x64 2>/dev/null; \
    SHARP_FORCE_GLOBAL_LIBVIPS=1 npm rebuild sharp

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Запускаем приложение
CMD npx prisma migrate deploy && npm run create-superuser && npm start
