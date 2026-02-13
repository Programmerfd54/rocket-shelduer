FROM node:20

WORKDIR /app

# Копируем только package — зависимости ставим внутри контейнера (важно для sharp и нативных модулей)
COPY package*.json ./
RUN npm install --include=optional

# Копируем исходники
COPY . .

# Пересборка sharp под архитектуру контейнера (избегает ошибки "Prebuilt binaries require v2 microarchitecture")
RUN npm rebuild sharp

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Запускаем приложение
CMD npx prisma migrate deploy && npm run create-superuser && npm start
