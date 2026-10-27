FROM node:22-alpine AS build
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM caddy:2-alpine
COPY --from=build /build/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
