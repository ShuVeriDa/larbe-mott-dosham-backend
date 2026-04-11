# Mott Larbe Dosham Backend

Бэкенд для проекта **Мотт Ларбе Дошам** — единый нохчийн (чеченский) словарь, собранный из 14 источников.

## Стек

- **NestJS 11** (TypeScript 5.7)
- **PostgreSQL 16** + **Prisma 7 ORM** + `pg_trgm`
- **Redis 7** — кэширование + rate limiting
- **Swagger** — документация API (`/api/docs`)

---

## Быстрый старт

```bash
# 1. Установка зависимостей
pnpm install

# 2. Настройка окружения
cp .env.example .env   # или создай .env вручную (см. раздел ниже)

# 3. Создание таблиц в БД
npx prisma migrate dev

# 4. Запуск (dev)
pnpm start:dev
```

Сервер запустится на `http://localhost:9666`.  
Swagger-документация: `http://localhost:9666/api/docs`.  
Health check: `http://localhost:9666/api/health`.

### Через Docker

```bash
docker compose up -d
```

Запускает app + PostgreSQL 16 + Redis 7, все с healthcheck.

---

## Переменные окружения (.env)

```env
DATABASE_URL=postgresql://postgres:123456@localhost:5432/larbe-mott-dosham?schema=public
IMPORT_API_KEY=K1ayleMottLarbeDosham
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:9555
PORT=9666
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
REDIS_URL=redis://localhost:6379
```

---

## Структура проекта

```
src/
  auth/                          # JWT, login/register/logout/me, сессии, password reset, RBAC
  user/                          # Профиль, предпочтения, статистика
  common/
    guards/api-key.guard.ts      # Защита эндпоинтов по X-API-Key
    utils/normalize_util.ts      # Нормализация текста, определение языка (nah/ru)
  database/
    prisma.module.ts             # Глобальный Prisma-модуль
  dictionary/
    dictionary.controller.ts     # GET search, lookup, random, word-of-day, popular, phraseology, declension, conjugation, lemmatize, sources, meta/pos-values, stats + CRUD
    dictionary.service.ts        # Dual-language search (tsvector + ILIKE) + Redis-кэш
    declension.service.ts        # Падежные парадигмы (4 типа, 8 падежей)
    conjugation.service.ts       # Спряжение глаголов (9 времён, 2 типа)
    dto/
  favorites/                     # Избранное (toggle, список, проверка, очистка)
  search-history/                # История поиска (просмотр, очистка)
  suggestions/                   # Предложения правок (create → review)
  admin/
    entries-admin.controller.ts  # Управление записями (list, batch, export, bulk-delete)
    users-admin.controller.ts    # Управление пользователями (15+ эндпоинтов)
    api-keys.controller.ts       # CRUD API-ключей
    pipeline-admin.controller.ts # Пайплайн + история прогонов
    audit-admin.controller.ts    # Аудит-лог + revert
    quality-admin.controller.ts  # Качество данных + экспорт
    admin.service.ts
  redis/
    redis.module.ts
    redis.service.ts
  merge/
    merge.controller.ts          # preview, status, unified-log
    merge.service.ts             # Оркестратор
    parse-pipeline.service.ts
    unify-pipeline.service.ts
    load-pipeline.service.ts
    merge-utils.ts               # mergeInto, estimateCefr
    parsers/                     # 14 парсеров + тесты
  import/
    dictionaries.ts              # Метаданные 14 словарей
  prisma.service.ts
  app.module.ts
  main.ts

prisma/
  schema.prisma                  # 14 моделей (User, UnifiedEntry, LoadRun, ImproveRun, ...)

dictionaries/                    # Исходные JSON-файлы словарей
  parsed/                        # Результат парсинга
  unified.json                   # Итоговый единый словарь
```

---

## Модель данных

### Таблица `UnifiedEntry`

| Поле | Тип | Описание |
|------|-----|----------|
| `word` | String | Слово без диакритики |
| `wordAccented` | String? | Слово с ударениями/тильдами |
| `wordNormalized` | String | Lowercase, без диакритики — для поиска |
| `homonymIndex` | Int? | Индекс омонима: вон¹=1, вон²=2 (null = один) |
| `partOfSpeech` | String? | Часть речи: сущ., гл., прил., нареч., ... |
| `nounClass` | String? | Грамм. класс ед.ч.: **ву**, **йу**, **ду**, **бу** |
| `nounClassPlural` | String? | Грамм. класс мн.ч. (если отличается) |
| `grammar` | Json? | `{ genitive, dative, ergative, instrumental, plural, verbPresent, verbPast, verbParticiple }` |
| `meanings` | Json | `[{ translation, examples: [{ nah, ru }] }]` |
| `phraseology` | Json? | `[{ nah, ru }]` — фразеологизмы |
| `citations` | Json? | `[{ text, source? }]` — литературные цитаты |
| `latinName` | String? | Латинское анатомическое название |
| `styleLabel` | String? | Стиль/регистр: Прост., Устар., Старин., Разг. |
| `domain` | String? | Предметная область: anatomy, computer, math, geology, law, sport |
| `variants` | String[] | Варианты написания |
| `sources` | String[] | Из каких словарей: `["maciev", "baisultanov-nah-ru", ...]` |
| `entryType` | String | `standard` (по умолчанию) \| `neologism` |
| `cefrLevel` | String? | Оценочный CEFR-уровень: A1–C2 |

---

## API-эндпоинты

### Словарь (поиск) — публичные

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/dictionary/search?q=бала&cefr[]=A1&pos=сущ.&sort=relevance` | Поиск с фильтрами |
| GET | `/api/dictionary/lookup/:word` | Точный поиск слова |
| GET | `/api/dictionary/declension/:word` | Падежная парадигма |
| GET | `/api/dictionary/conjugation/:word` | Спряжение глагола |
| GET | `/api/dictionary/lemmatize/:form` | Лемматизация формы |
| GET | `/api/dictionary/stats` | Статистика словаря |
| GET | `/api/dictionary/random?cefr=A1` | Случайное слово |
| GET | `/api/dictionary/word-of-day` | Слово дня (детерминированное, кэш до полуночи) |
| GET | `/api/dictionary/popular` | Топ-10 запросов за 7 дней |
| GET | `/api/dictionary/meta/pos-values` | Список допустимых частей речи |
| GET | `/api/dictionary/sources` | Список словарей-источников |
| GET | `/api/dictionary/phraseology?q=...` | Поиск по фразеологизмам |
| GET | `/api/dictionary/:id` | Запись по ID |
| GET | `/api/health` | Health check |

### Auth

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/auth/register` | Регистрация |
| POST | `/api/auth/login` | Вход (throttled 5/60s) |
| POST | `/api/auth/login/access-token` | Обновление access token |
| POST | `/api/auth/logout` | Выход |
| GET  | `/api/auth/me` | Текущий пользователь |
| POST | `/api/auth/forgot-password` | Запрос сброса пароля (throttled 3/60s) |
| POST | `/api/auth/reset-password` | Установить новый пароль |
| GET  | `/api/auth/sessions` | Активные сессии |
| DELETE | `/api/auth/sessions/:id` | Отозвать сессию |
| DELETE | `/api/auth/sessions` | Отозвать все остальные сессии |

### Пользователь (JWT)

```
PATCH  /api/users/me              — обновить профиль
PATCH  /api/users/me/password     — сменить пароль
PATCH  /api/users/me/preferences  — обновить предпочтения (тема, язык, и др.)
GET    /api/users/me/stats        — статистика: избранное, история, предложения
DELETE /api/users/me              — удалить аккаунт
```

### Избранное, история, предложения (JWT)

```
GET/POST/DELETE /api/favorites, /api/favorites/:entryId, /api/favorites/:entryId/check
GET/DELETE /api/search-history, /api/search-history/:id
POST /api/suggestions   GET /api/suggestions/my   GET /api/suggestions/stats
```

### Редактирование записей (JWT + разрешения)

```
PATCH  /api/dictionary/:id          — CAN_EDIT_ENTRIES
DELETE /api/dictionary/:id          — CAN_DELETE_ENTRIES
PATCH  /api/dictionary/bulk/update  — bulk, до 100 записей
```

### Сборка словаря (merge) — X-API-Key

```
GET  /api/merge/preview/:slug?limit=5
GET  /api/merge/status
GET  /api/merge/unified-log
```

### Admin API (JWT + разрешения)

```
/api/admin/api-keys              — CRUD ключей (CAN_MANAGE_API_KEYS)
/api/admin/users/**              — управление пользователями (CAN_MANAGE_USERS)
/api/admin/entries/**            — управление записями (CAN_EDIT_ENTRIES)
/api/admin/pipeline/**           — пайплайн + история (CAN_RUN_PIPELINE)
/api/admin/quality/**            — качество данных (CAN_EDIT_ENTRIES)
/api/admin/audit/**              — аудит + revert (CAN_EDIT_ENTRIES)
```

---

## ETL-пайплайн (пошагово)

### Этап 1: Парсинг

```bash
# Один словарь
curl -X POST http://localhost:9666/api/admin/pipeline/parse/maciev \
  -H "Authorization: Bearer $TOKEN"

# Или через CLI
npm run pipeline -- parse maciev
npm run pipeline -- parse all
```

### Этап 2: Объединение

```bash
npm run pipeline -- unify-step maciev
npm run pipeline -- unify-step baisultanov-nah-ru
# ... остальные словари в нужном порядке
```

### Этап 3: Загрузка в БД

```bash
npm run pipeline -- load
```

### Этап 4: Нормализация

```bash
npm run pipeline -- improve
```

### Откат и сброс

```bash
npm run pipeline -- rollback 3    # откат к шагу 3
npm run pipeline -- reset         # сбросить unified.json
```

---

## Словари-источники

| Slug | Название | Направл. | После парсинга |
|------|----------|----------|----------------|
| `maciev` | Мациев А.Г. | nah→ru | ~3 247 |
| `karasaev-maciev-ru-nah` | Карасаев-Мациев | ru→nah | ~9 196 |
| `baisultanov-nah-ru` | Байсултанов | nah→ru | ~1 283 |
| `aslahanov-ru-nah` | Аслаханов | ru→nah | ~3 224 |
| `daukaev-ru-nah` | Даукаев | ru→nah | ~2 386 |
| `abdurashidov` | Абдурашидов | both | ~461 |
| `umarhadjiev-ahmatukaev` | Умархаджиев | both | ~587 |
| `nah-ru-anatomy` | Анатомический | nah→ru | ~1 642 |
| `ru-nah-anatomy` | Анатомический | ru→nah | ~1 653 |
| `nah-ru-computer` | Компьютерный | both | ~398 |
| `ismailov-nah-ru` | Исмаилов | nah→ru | ~363 |
| `ismailov-ru-nah` | Исмаилов | ru→nah | ~67 |
| `collected` | Ручной сборник | both | — |
| `neologisms` | Неологизмы | both | — |

---

## Скрипты

```bash
pnpm start:dev                # Запуск в dev-режиме
pnpm build                    # Сборка
pnpm start:prod               # Запуск production
pnpm lint                     # ESLint
pnpm format                   # Prettier
pnpm test                     # Jest тесты (14 файлов)
```
