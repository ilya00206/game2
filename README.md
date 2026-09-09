# ❤️ Księżniczka Bot

Персональный Telegram-бот для изучения польского: карточки, тест, стрики, валюта и магазин подарков.
Полные требования — в [REQUIREMENTS.md](REQUIREMENTS.md).

## Стек

TypeScript · grammY (long polling) · Prisma + SQLite · Luxon · Zod · pino · node-cron · Vitest

## Локальный запуск

```bash
npm install
cp .env.example .env      # заполнить TELEGRAM_BOT_TOKEN и ADMIN_TELEGRAM_ID
npx prisma migrate dev
npm run dev
```

Полезные команды:

| Команда | Назначение |
| --- | --- |
| `npm run build` | Prisma generate + компиляция TypeScript |
| `npm start` | `prisma migrate deploy`, затем запуск бота |
| `npm run seed` | Повторный идемпотентный посев |
| `npm test` | Юнит-тесты бизнес-логики |
| `npm run lint` | ESLint |

### Windows: кириллица в логах

Если вместо русских слов в консоли видны символы вида `╨╜╨░╤ü╤é`, консоль PowerShell
использует кодировку OEM (например, `IBM437`), а не UTF-8. Логи при этом корректны —
искажается только вывод. Исправляется одной командой в текущем окне:

```powershell
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
```

Чтобы применялось всегда: `Add-Content $PROFILE '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'`

Кроме того, PowerShell может блокировать `npm.ps1` политикой выполнения — тогда используйте
`npm.cmd` и `npx.cmd`.

## Переменные окружения

| Переменная | Описание |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Токен бота (обязательно) |
| `DATABASE_URL` | `file:./dev.db` локально, `file:/data/kartochki.db` в production |
| `ADMIN_TELEGRAM_ID` | Telegram ID администратора (обязательно) |
| `ALLOWED_TELEGRAM_IDS` | Белый список через запятую. В production не может быть пустым |
| `EVENT_LOG_ENABLED` | `false` в первой версии; таблица `Event` остаётся пустой |
| `LOG_LEVEL` | `info` по умолчанию |
| `NODE_ENV` | `production` на Railway |
| `TZ` | Влияет только на логи; бизнес-логика использует `User.timezone` |

Секреты хранятся только в `.env` и переменных Railway; `.env` не коммитится.

## Деплой на Railway

1. Создать проект и подключить репозиторий GitHub (деплой основной ветки).
2. Добавить **Volume** и смонтировать его в `/data`.
3. Задать переменные окружения, включая `DATABASE_URL=file:/data/kartochki.db` и `NODE_ENV=production`.
4. Build command: `npm ci && npm run build`. Start command: `npm start`.
5. Держать ровно **одну реплику** — long polling и cron не поддерживают несколько экземпляров.

Pre-deploy command для миграций не используется: volume не монтируется в pre-deploy контейнер,
поэтому `prisma migrate deploy` выполняется в start-команде. Резервные копии не создаются.

## Архитектура

```
src/
  bot/         grammY: контекст, middleware, экраны, клавиатуры
  core/        бизнес-логика без знания о Telegram
    economy/   валюта и конфиги
    events/    типы событий и EventSink
  content/     seed/fallback текстов, реестр ключей, runtime-сервис
  scheduler/   минутный cron-тик и реестр пользователей в памяти
  db/          PrismaClient, PRAGMA, идемпотентный seed
  config/      валидация окружения
```

## Известные отклонения от REQUIREMENTS.md

Prisma для провайдера SQLite не поддерживает `enum` и скалярный тип `Json`, поэтому:

- статусы и типы хранятся как `String`, допустимые значения задаются TS-типами и Zod;
- `SessionCard.options` хранится как JSON-строка и валидируется Zod при записи и чтении.
