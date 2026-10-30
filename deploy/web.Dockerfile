# Builds the PWA and serves it with stock Caddy. Context: repo root.
FROM node:22-alpine AS app
WORKDIR /src
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=app /src/dist /srv/app
