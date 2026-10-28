# Two targets: "dev" for docker compose (src is bind-mounted, Vite dev server) and the default
# final stage for ECS (the static build served by nginx as a non-root user).
FROM node:22-alpine AS dev

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5173

CMD ["npm", "run", "dev", "--", "--host"]

# VITE_* values are baked into the bundle at build time. Empty VITE_API_URL: the browser calls
# /api/... on the page's own origin (the ALB sends /api/* to the backend).
FROM dev AS build
ARG VITE_API_URL=
ARG VITE_CONTACT_EMAIL=
RUN npm run build

FROM public.ecr.aws/nginx/nginx-unprivileged:1.28-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
