# syntax=docker/dockerfile:1
#
# Build context is frontend/, e.g.:
#   docker build -t governance-frontend ./frontend
#
# Not needed for the actual Azure deployment (the plan targets Static Web
# Apps, which builds+serves the Vite output directly with no container) —
# this exists for local docker-compose parity and as a self-hosted fallback.

# ---- Stage: build ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# VITE_API_BASE_URL is read at BUILD time (Vite inlines import.meta.env.*),
# so it must be supplied as a build arg, not a runtime container env var.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

# ---- Stage: serve ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
