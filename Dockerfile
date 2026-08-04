# =============================================================================
# Stage 1: сборка React-панели (Vite → web/dist)
# =============================================================================
FROM node:22-bookworm-slim AS web-build

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
# Puppeteer ставит совместимый Chrome при npm ci (не apt chromium)
# =============================================================================
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
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
    libxshmfence1 \
    libxss1 \
    python3 \
    make \
    g++ \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV DOCKER=true
# dbus в контейнере не нужен — убираем шум и редкие падения при старте
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null

WORKDIR /app

COPY package.json package-lock.json* ./
# Патчи нужны ДО npm ci: postinstall → patch-package (иначе wwebjs без $1/_serialized фикса)
COPY patches ./patches
# Puppeteer postinstall скачивает Chrome, совместимый с puppeteer-core из whatsapp-web.js
RUN npm ci --omit=dev \
  && node -e 'const fs=require("fs"); const s=fs.readFileSync("node_modules/whatsapp-web.js/src/util/Injected/Utils.js","utf8"); if(!s.includes("getMsgKeyId") || !s.includes("$1")) { console.error("❌ whatsapp-web.js patch NOT applied"); process.exit(1); } console.log("✅ whatsapp-web.js patch applied");' \
  && node -e 'const p=require("puppeteer"); const e=p.executablePath(); const fs=require("fs"); if(!fs.existsSync(e)) { console.error("Chrome not found:", e); process.exit(1); } console.log("✅ Puppeteer Chrome:", e);'

# Код приложения (web/dist в .dockerignore — не перезапишет сборку)
COPY . .
# На случай если COPY перезапишет что-то в node_modules — повторно накатываем патч
RUN npx patch-package \
  && node -e "const fs=require('fs'); const s=fs.readFileSync('node_modules/whatsapp-web.js/src/util/Injected/Utils.js','utf8'); if(!s.includes('getMsgKeyId')) { console.error('❌ patch missing after COPY'); process.exit(1); }"

RUN node scripts/ingest-file-doc.js || test -f data/file-doc-knowledge.json

# Падаем на build, а не на Railway healthcheck, если native SQLite не загружается.
RUN node -e "const {getDb,closeDb}=require('./db'); getDb(); closeDb(); console.log('✅ SQLite native module loaded');" \
  && rm -f data/bot.db data/bot.db-wal data/bot.db-shm

# Панель из stage 1 — всегда свежая после git push
COPY --from=web-build /build/web/dist ./web/dist

RUN test -f web/dist/index.html \
  && test -d web/dist/assets \
  && echo "✅ Admin panel built: web/dist"

EXPOSE 8080

CMD ["node", "index.js"]
