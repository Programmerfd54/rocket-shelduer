FROM node:20

WORKDIR /app

# Только package — зависимости ставим в контейнере (sharp 0.32.6 — пребилды под старые CPU)
COPY package*.json ./
RUN npm install --include=optional

COPY . .
RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Запускаем приложение
CMD npx prisma migrate deploy && npm run create-superuser && npm start
