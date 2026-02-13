FROM node:20

WORKDIR /app

# Увеличьте тайм-аут и количество попыток
RUN npm config set fetch-timeout 600000 && \
    npm config set fetch-retries 10

COPY package*.json ./

# Используйте флаг --legacy-peer-deps для обхода конфликтов зависимостей
RUN npm install --include=optional --legacy-peer-deps

COPY . .

# Соберите приложение
RUN npm run build

# Команда запуска
CMD ["npm", "start"]
