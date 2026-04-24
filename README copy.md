# House Tenerife — WhatsApp AI-консультант

Node.js-бот на [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js): отвечает в личных сообщениях WhatsApp, подключает каталог `housetenerife.eu` и чат-API (переменные в `.env.example`).

## Локально

```bash
cp .env.example .env
# Заполните AI_API_KEY и при необходимости другие переменные

npm ci
npm start
```

Первый запуск: отсканируйте QR-код в терминале. Сессия сохраняется в `SESSION_PATH` (по умолчанию `./.wwebjs_auth_ht`).

## Репозиторий на GitHub

Код: **[github.com/VladTichonenko/housetenerife](https://github.com/VladTichonenko/housetenerife)**.

Клонирование:

```bash
git clone https://github.com/VladTichonenko/housetenerife.git
cd housetenerife
```

Если проект уже есть локально с историей коммитов, привяжите remote и отправьте ветку `main`:

```bash
git remote add origin https://github.com/VladTichonenko/housetenerife.git
# если на GitHub при создании репозитория уже лежит README.md — один раз:
# git pull origin main --allow-unrelated-histories
git push -u origin main
```

Не коммитьте `.env` (он в `.gitignore`). Папки сессии WhatsApp (`.wwebjs_auth_ht` и т.п.) можно коммитить, если нужно перенести авторизацию; для **публичного** репозитория это небезопасно — лучше volume на сервере или приватный репозиторий.

## Деплой на Railway

1. **New Project** → **Deploy from GitHub repo** → выберите репозиторий `housetenerife`.
2. Railway подхватит `Dockerfile` и `railway.json` (сборка через Docker).
3. В **Variables** задайте минимум:
   - `AI_API_KEY` — ключ чат-API (как в `.env.example`).
   - При необходимости: `AI_MODEL`, `AI_API_URL`, `DISABLE_WEB_SEARCH`, `PROTOCOL_TIMEOUT_MS`, `SESSION_PATH`.
4. Переменная **`PORT`** задаётся Railway автоматически — HTTP-сервер слушает её для `/` и `/health`.
5. **Сессия WhatsApp:** файловая система контейнера эфемерна. Чтобы не сканировать QR после каждого деплоя, добавьте **Volume**, смонтируйте, например, `/data`, и в переменных укажите `SESSION_PATH=/data/.wwebjs_auth_ht`.
6. После деплоя откройте **Deploy → View logs**: при первой авторизации в логах появится QR (или используйте одноразовый shell/логи Railway для сканирования).
7. Рекомендуется план с достаточным **RAM** (Chromium + Node обычно от ~512 MB–1 GB и выше в зависимости от нагрузки).

### Healthcheck

- `GET /` — быстрый статус (`ready`, `uptime`).
- `GET /health` — расширенная диагностика.

### Синхронизация каталога

Локально или в одноразовом job на Railway:

```bash
npm run sync-db
```

Переменные `SYNC_*` см. в `.env.example`.

## Лицензия

ISC (см. `package.json`).
