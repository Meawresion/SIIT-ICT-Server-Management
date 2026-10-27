# Two targets: "dev" for docker compose (src is bind-mounted, node --watch) and the default
# final stage for ECS (production dependencies only, runs as the non-root node user).
FROM node:22-alpine AS base

WORKDIR /app

# Prisma picks its query engine from the system OpenSSL. Alpine ships OpenSSL 3 without the
# openssl package, so Prisma can't detect it and falls back to an OpenSSL 1.1 engine that fails.
RUN apk add --no-cache openssl

COPY package*.json ./

FROM base AS dev
RUN npm ci
COPY prisma ./prisma
COPY src ./src
# Server-side commands: npm run user:role (grant approver access) and npm run test:db
COPY scripts ./scripts
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "dev"]

# The generated Prisma client stays in node_modules; only the dev tools are removed.
FROM dev AS build
RUN npm prune --omit=dev

FROM base AS prod
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY prisma ./prisma
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
