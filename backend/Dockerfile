FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "start"]
