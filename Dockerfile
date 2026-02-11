FROM node:20

WORKDIR /app

# Копируем package файлы
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install

# Копируем все файлы проекта
COPY . .

# Генерируем Prisma client (если используешь)
RUN npx prisma generate

# Собираем проект
RUN npm run build

EXPOSE 3000

# Запускаем приложение
CMD npx prisma migrate deploy && npm start
