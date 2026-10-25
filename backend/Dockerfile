FROM node:20-alpine

WORKDIR /app

# Prisma picks its query engine from the system OpenSSL. Alpine ships OpenSSL 3 without the
# openssl package, so Prisma can't detect it and falls back to an OpenSSL 1.1 engine that fails.
RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY src ./src
# Server-side commands: npm run user:role (grant approver access) and npm run test:db
COPY scripts ./scripts
RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "start"]
