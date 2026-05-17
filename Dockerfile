# =============================================================================
# Stage 1: сборка React-панели (Vite → web/dist)
# =============================================================================
FROM node:20-bookworm-slim AS web-build

WORKDIR /build/web

COPY web/package.json web/package-lock.json ./
RUN npm ci --include=dev

COPY web/index.html web/vite.config.js ./
COPY web/src ./src/

RUN npm run build \
  && test -f dist/index.html \
  && test -d dist/assets

# =============================================================================
# Stage 2: WhatsApp-бот + готовая панель /admin
# =============================================================================
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV DOCKER=true

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Код приложения (web/dist в .dockerignore — не перезапишет сборку)
COPY . .

# Панель из stage 1 — всегда свежая после git push
COPY --from=web-build /build/web/dist ./web/dist

RUN test -f web/dist/index.html \
  && test -d web/dist/assets \
  && echo "✅ Admin panel built: web/dist"

EXPOSE 8080

CMD ["node", "index.js"]
