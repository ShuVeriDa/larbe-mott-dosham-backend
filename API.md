# MottLarbe API & CLI — Полная документация

Бэкенд чеченского словаря MottLarbe. Сервер по умолчанию запускается на `http://localhost:9666`.
Swagger-документация (только dev): `http://localhost:9666/api/docs`.

---

## Содержание

- [Запуск сервера](#запуск-сервера)
- [API-роуты](#api-роуты)
  - [Dictionary — поиск и лингвистика](#dictionary--поиск-и-лингвистика)
  - [Merge — мониторинг пайплайна](#merge--мониторинг-пайплайна)
- [CLI-команды (пайплайн)](#cli-команды-пайплайн)
  - [parse — парсинг словарей](#parse--парсинг-словарей)
  - [clean — дедупликация оригиналов](#clean--дедупликация-оригиналов)
  - [unify-step — пошаговое слияние](#unify-step--пошаговое-слияние)
  - [rollback — откат слияния](#rollback--откат-слияния)
  - [reset — полный сброс](#reset--полный-сброс)
  - [improve — улучшение данных](#improve--улучшение-данных)
  - [load — загрузка в БД](#load--загрузка-в-бд)
- [Полный пайплайн: от нуля до рабочей БД](#полный-пайплайн-от-нуля-до-рабочей-бд)
- [Доступные словари (slug)](#доступные-словари-slug)

---

## Запуск сервера

```bash
# Разработка (с авто-перезагрузкой)
npm run start:dev

# Продакшен
npm run build && npm run start:prod
```

---

## API-роуты

Все роуты доступны с префиксом `/api`. Словарные GET-эндпоинты публичные. Редактирование записей требует JWT + разрешение CAN_EDIT_ENTRIES. Auth-эндпоинты для регистрации/входа открыты.

---

### Auth — аутентификация

Базовый путь: `/api/auth`

#### `POST /api/auth/register`

Регистрация нового пользователя. Возвращает access token в теле ответа, refresh token устанавливается в httpOnly cookie.

**Body:**

```json
{
  "email": "user@example.com",
  "password": "MyPass1!",
  "username": "username",
  "name": "Имя"
}
```

**Ответ:**

```json
{
  "user": { "id": "uuid", "email": "...", "username": "...", "name": "..." },
  "accessToken": "eyJ..."
}
```

---

#### `POST /api/auth/login`

Вход по username (или email) + пароль.

**Body:**

```json
{
  "username": "username",
  "password": "MyPass1!"
}
```

**Ответ:** аналогичен register.

---

#### `POST /api/auth/login/access-token`

Обновление access token через refresh token из httpOnly cookie. Вызывается фронтендом автоматически при истечении access token.

---

#### `POST /api/auth/logout`

Выход из системы. Требует JWT в заголовке `Authorization: Bearer <token>`. Очищает refresh cookie и обнуляет хеш refresh token в БД.

---

### Dictionary — поиск и лингвистика

Базовый путь: `/api/dictionary`

#### `GET /api/dictionary/search`

Полнотекстовый поиск по словарю. Автоматически определяет язык ввода (чеченский/русский) и ищет в соответствующих полях.

**Query-параметры:**

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `q` | string | *обязательный* | Поисковый запрос |
| `limit` | number | 20 | Количество результатов (1–100) |
| `offset` | number | 0 | Смещение для пагинации |
| `cefr` | string | — | Фильтр по уровню CEFR: `A1`, `A2`, `B1`, `B2`, `C1`, `C2` |
| `pos` | string | — | Фильтр по части речи: `сущ.`, `гл.`, `прил.`, `нареч.` и т.д. |
| `nounClass` | string | — | Фильтр по грамм. классу: `ву`, `йу`, `ду`, `бу` |
| `entryType` | string | — | Фильтр по типу: `standard`, `neologism` |

**Примеры:**

```
GET /api/dictionary/search?q=бала
GET /api/dictionary/search?q=ребёнок&limit=10
GET /api/dictionary/search?q=бала&cefr=A1
GET /api/dictionary/search?q=стаг&limit=50&offset=20
GET /api/dictionary/search?q=бала&pos=сущ.&nounClass=ду
GET /api/dictionary/search?q=бала&entryType=neologism
```

**Логика поиска:**
- Если ввод на русском — ищет в переводах (поле `meanings`)
- Если ввод на чеченском — ищет по `wordNormalized` (нормализованная форма слова)
- Если язык не определён — ищет и там, и там
- Результаты ранжируются по триграммной похожести (`pg_trgm`)
- Если по чеченскому запросу ничего не найдено — автоматически пытается лемматизировать (например, `стагана` → `стаг`) и возвращает подсказку `lemmaHint`

**Ответ:**

```json
{
  "data": [
    {
      "id": 1234,
      "word": "бала",
      "wordAccented": "ба́ла",
      "partOfSpeech": "сущ.",
      "partOfSpeechNah": "цIерниг дош",
      "nounClass": "д",
      "grammar": { "plural": "бераш", "obliqueStem": "бер" },
      "meanings": [
        {
          "translation": "ребёнок, дитя",
          "examples": [
            { "nah": "Бала дуьйцу.", "ru": "Ребёнок разговаривает." }
          ]
        }
      ],
      "phraseology": [
        { "nah": "бала дан", "ru": "родить ребёнка" }
      ],
      "domain": null,
      "cefrLevel": "A1",
      "sources": ["maciev", "baisultanov-nah-ru", "ismailov-nah-ru"],
      "score": 1.0
    }
  ],
  "meta": {
    "total": 3,
    "limit": 20,
    "offset": 0,
    "q": "бала",
    "cefr": null,
    "lang": "nah",
    "lemmaHint": null
  }
}
```

---

#### `GET /api/dictionary/lookup/:word`

Точный поиск слова по нормализованной форме. Возвращает все записи, точно совпадающие со словом (регистронезависимо).

**Примеры:**

```
GET /api/dictionary/lookup/бала
GET /api/dictionary/lookup/стаг
```

**Когда использовать:** когда нужна карточка конкретного слова, а не результаты поиска. Например, при клике на слово в интерфейсе.

**Ответ:** массив объектов `UnifiedEntry` (формат аналогичен `data` из `/search`).

---

#### `GET /api/dictionary/declension/:word`

Возвращает полную парадигму склонения чеченского существительного по всем падежам (именительный, родительный, дательный, эргативный, творительный, вещественный, местный, сравнительный).

**Примеры:**

```
GET /api/dictionary/declension/стаг
GET /api/dictionary/declension/бала
```

**Логика:**
1. Ищет слово в БД
2. Берёт сохранённые грамматические формы из поля `grammar`
3. Недостающие формы генерирует по правилам склонения (4 типа склонения по Алироеву)
4. Если есть форма множественного числа — генерирует парадигму и для неё

**Ответ:**

```json
{
  "word": "стаг",
  "declensionType": 1,
  "singular": {
    "nominative": "стаг",
    "genitive": "стаган",
    "dative": "стагна",
    "ergative": "стаго",
    "instrumental": "стагаца",
    "substantive": "стагах",
    "locative": "стаге",
    "comparative": "стагал"
  },
  "plural": {
    "nominative": "нах",
    "genitive": "нахийн",
    "dative": "нахна",
    "ergative": "наха",
    "instrumental": "нахаца",
    "substantive": "нахех",
    "locative": "нахка",
    "comparative": "нахел"
  }
}
```

Возвращает `null`, если слово не найдено в БД.

---

#### `GET /api/dictionary/conjugation/:word`

Спряжение чеченского глагола — 9 временных форм, причастия, деепричастия, повелительное наклонение, отрицание.

**Примеры:**

```
GET /api/dictionary/conjugation/лаха
GET /api/dictionary/conjugation/тоха
GET /api/dictionary/conjugation/хаза
```

**Логика:**
1. Ищет глагол в БД, проверяет часть речи
2. Извлекает 3 базовые формы: настоящее (`verbPresent`), прош. совершенное (`verbPast`)
3. Определяет тип спряжения (I — окончание -у, II — окончание -а)
4. Генерирует все производные формы по правилам

**Ответ:**

```json
{
  "word": "лаха",
  "conjugationType": 1,
  "baseForms": {
    "present": "лоху",
    "recentPast": null,
    "perfect": "лехна"
  },
  "tenses": {
    "presentSimple": "лоху",
    "presentCompound": "лохуш ву",
    "recentPast": null,
    "evidentialPast": null,
    "perfect": "лехна",
    "remotePast": "лехнера",
    "pastImperfective": "лохура",
    "futurePossible": "лохур",
    "futureFactual": "лохур ду"
  },
  "participles": {
    "present": "лохург",
    "past": "лехнарг",
    "gerundPresent": "лохуш",
    "gerundPast": "лехна",
    "masdar": "лахар"
  },
  "imperative": {
    "basic": "лахал",
    "polite": "лахахьа",
    "politePlural": "лахийша"
  },
  "negation": {
    "present": "ца лоху",
    "imperative": "ма лаха"
  }
}
```

Возвращает `null`, если слово не найдено или не является глаголом.

**Два типа спряжения:**
- **I** — окончание инфинитива -а → -у, корневая гласная меняется (а→о, э→оь, и→уь, о→у, у→у)
- **II** — окончание -а остаётся -а, корневая гласная может не меняться

---

#### `GET /api/dictionary/lemmatize/:form`

Лемматизация: по любой словоформе пытается найти начальную форму (лемму). Отсекает известные падежные окончания чеченского языка и проверяет кандидатов в БД.

**Примеры:**

```
GET /api/dictionary/lemmatize/стагана     → ["стаг"]
GET /api/dictionary/lemmatize/берашна     → ["бала"]
GET /api/dictionary/lemmatize/нахаца      → ["нах"]
```

**Ответ:** массив строк — найденные леммы.

```json
["стаг"]
```

Возвращает пустой массив `[]`, если лемму определить не удалось.

---

#### `GET /api/dictionary/stats`

Статистика базы данных: общее количество записей, распределение по доменам и уровням CEFR.

**Пример:**

```
GET /api/dictionary/stats
```

**Ответ:**

```json
{
  "total": 48532,
  "domains": [
    { "domain": "general", "count": 45000 },
    { "domain": "anatomy", "count": 1200 },
    { "domain": "computer", "count": 800 },
    { "domain": "law", "count": 600 },
    { "domain": "geology", "count": 500 },
    { "domain": "math", "count": 432 }
  ],
  "cefrLevels": [
    { "level": "A1", "count": 5000 },
    { "level": "A2", "count": 8000 },
    { "level": "B1", "count": 15000 },
    { "level": "B2", "count": 12000 },
    { "level": "C1", "count": 6000 },
    { "level": "C2", "count": 2532 }
  ]
}
```

---

#### `GET /api/dictionary/random`

Случайное слово из словаря. Полезно для "слова дня" на фронтенде.

| Параметр | Тип | Описание |
|---|---|---|
| `cefr` | string | Опционально: A1–C2, ограничить уровень |

```
GET /api/dictionary/random
GET /api/dictionary/random?cefr=A1
```

---

#### `GET /api/dictionary/phraseology`

Поиск по фразеологизмам (устойчивым выражениям).

| Параметр | Тип | Описание |
|---|---|---|
| `q` | string | Поисковый запрос |
| `limit` | number | Кол-во результатов (по умолчанию 20) |
| `offset` | number | Смещение |

```
GET /api/dictionary/phraseology?q=дан
```

---

### Favorites — избранное (JWT required)

```
GET  /api/favorites                  — список избранных слов
POST /api/favorites/:entryId         — toggle (добавить / убрать)
GET  /api/favorites/:entryId/check   — проверить, в избранном ли
```

---

### Search History — история поиска (JWT required)

```
GET    /api/search-history?limit=20  — последние запросы
DELETE /api/search-history           — очистить историю
```

---

### Suggestions — предложения правок

```
POST /api/suggestions                — предложить правку (JWT, любой пользователь)
GET  /api/suggestions/my             — мои предложения (JWT)
GET  /api/suggestions?status=PENDING — все предложения (JWT + CAN_EDIT_ENTRIES)
POST /api/suggestions/:id/review     — одобрить/отклонить (JWT + CAN_EDIT_ENTRIES)
```

**Body для POST /api/suggestions:**

```json
{
  "entryId": 42,
  "field": "meanings",
  "newValue": "[{\"translation\": \"исправленный перевод\"}]",
  "comment": "Перевод неточный"
}
```

**Body для POST /api/suggestions/:id/review:**

```json
{
  "decision": "approve",
  "comment": "Принято, спасибо"
}
```

---

### Admin — управление (JWT + соответствующие разрешения)

#### API-ключи (`/api/admin/api-keys`, CAN_MANAGE_API_KEYS)

```
GET    /api/admin/api-keys           — список ключей
POST   /api/admin/api-keys           — создать { name, role? }
PATCH  /api/admin/api-keys/:id       — обновить { name?, isActive?, role? }
DELETE /api/admin/api-keys/:id       — удалить
```

#### Пользователи (`/api/admin/users`, CAN_MANAGE_USERS)

```
GET   /api/admin/users               — список пользователей с ролями
PATCH /api/admin/users/:id/role      — назначить роль { role: "EDITOR" }
DELETE /api/admin/users/:id/role     — снять роль { role: "EDITOR" }
PATCH /api/admin/users/:id/block     — заблокировать
PATCH /api/admin/users/:id/unblock   — разблокировать
```

#### Pipeline (`/api/admin/pipeline`, CAN_RUN_PIPELINE)

```
POST /api/admin/pipeline/parse/:slug
POST /api/admin/pipeline/unify-step/:slug
POST /api/admin/pipeline/load
POST /api/admin/pipeline/improve
POST /api/admin/pipeline/rollback/:step
POST /api/admin/pipeline/reset
```

#### Качество данных (`/api/admin/quality`, CAN_EDIT_ENTRIES)

```
GET /api/admin/quality/stats         — статистика: сколько без примеров, без класса, без POS
GET /api/admin/quality/problems?type=no-class&limit=50
```

Типы проблем: `no-meanings`, `no-class`, `no-pos`, `no-examples`.

#### Аудит-лог (`/api/admin/audit`, CAN_EDIT_ENTRIES)

```
GET /api/admin/audit/entries/:entryId  — история изменений записи
GET /api/admin/audit/recent?limit=50   — последние правки
```

---

### Dictionary — редактирование (JWT + CAN_EDIT_ENTRIES)

#### `GET /api/dictionary/:id`

Получить запись по ID. Публичный эндпоинт.

---

#### `PATCH /api/dictionary/:id`

Обновить одну запись. Требует JWT + разрешение `CAN_EDIT_ENTRIES`.

**Headers:** `Authorization: Bearer <token>`

**Body (все поля опциональны):**

```json
{
  "word": "исправленное слово",
  "meanings": [
    {
      "translation": "перевод",
      "examples": [{ "nah": "Пример на чеченском.", "ru": "Перевод примера." }]
    }
  ],
  "nounClass": "ду",
  "styleLabel": "Устар."
}
```

При изменении `word` автоматически пересчитывается `wordNormalized`.

**Ответ:** обновлённый объект `UnifiedEntry`.

---

#### `PATCH /api/dictionary/bulk/update`

Обновить несколько записей за один запрос (до 100). Выполняется в транзакции.

**Headers:** `Authorization: Bearer <token>`

**Body:**

```json
{
  "entries": [
    { "id": 42, "data": { "word": "исправленное" } },
    { "id": 99, "data": { "meanings": [{ "translation": "новый перевод" }] } },
    { "id": 150, "data": { "cefrLevel": "B2", "domain": "computer" } }
  ]
}
```

**Ответ:**

```json
{
  "total": 3,
  "updated": 3,
  "failed": 0,
  "results": [
    { "id": 42, "success": true },
    { "id": 99, "success": true },
    { "id": 150, "success": true }
  ]
}
```

---

### Merge — мониторинг пайплайна

Базовый путь: `/api/merge`

Эти эндпоинты — только для чтения (GET). Все операции записи выполняются через CLI-команды (см. ниже).

#### `GET /api/merge/status`

Общий статус пайплайна: сколько словарей распарсено, сколько записей в unified.json, сколько записей в БД.

**Пример:**

```
GET /api/merge/status
```

**Ответ:**

```json
{
  "parsed": {
    "files": [
      { "slug": "maciev", "entries": 20500 },
      { "slug": "baisultanov-nah-ru", "entries": 12800 }
    ],
    "total": 33300
  },
  "unified": {
    "entries": 28400,
    "file": "dictionaries/unified.json"
  },
  "database": {
    "entries": 28400
  }
}
```

**Когда использовать:** чтобы быстро проверить, на каком этапе пайплайн — что распарсено, что объединено, что загружено в БД.

---

#### `GET /api/merge/preview/:slug`

Превью первых N записей из распарсенного файла словаря. Позволяет проверить качество парсинга без скачивания всего файла.

**Query-параметры:**

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `limit` | number | 5 | Количество записей для превью |

**Примеры:**

```
GET /api/merge/preview/maciev
GET /api/merge/preview/maciev?limit=20
GET /api/merge/preview/baisultanov-nah-ru?limit=3
```

**Ответ:**

```json
{
  "slug": "maciev",
  "total": 20500,
  "sample": [
    {
      "word": "а",
      "meanings": [
        { "translation": "а; ведь, же" }
      ],
      "partOfSpeech": "межд."
    }
  ]
}
```

**Когда использовать:** после `npm run pipeline -- parse <slug>`, чтобы убедиться, что парсер отработал корректно, перед тем как запускать слияние.

---

#### `GET /api/merge/unified-log`

История пошагового слияния: какие словари добавлены, в каком порядке, сколько записей на каждом шаге. Также показывает оставшиеся словари и рекомендацию, какой добавлять следующим.

**Пример:**

```
GET /api/merge/unified-log
```

**Ответ:**

```json
{
  "steps": [
    {
      "step": 1,
      "slug": "maciev",
      "title": "Мациев. Чеченско-русский словарь",
      "timestamp": "2026-04-05T10:30:00.000Z",
      "entriesFromDict": 20500,
      "newWords": 20500,
      "enrichedWords": 0,
      "totalUnifiedEntries": 20500,
      "snapshotFile": "dictionaries/unified/step_01_maciev.json"
    },
    {
      "step": 2,
      "slug": "baisultanov-nah-ru",
      "title": "Байсултанов. Чеченско-русский словарь",
      "timestamp": "2026-04-05T10:32:00.000Z",
      "entriesFromDict": 12800,
      "newWords": 3200,
      "enrichedWords": 9600,
      "totalUnifiedEntries": 23700,
      "snapshotFile": "dictionaries/unified/step_02_baisultanov-nah-ru.json"
    }
  ],
  "totalSteps": 2,
  "remaining": [
    "karasaev-maciev-ru-nah",
    "aslahanov-ru-nah",
    "ismailov-nah-ru",
    "ismailov-ru-nah",
    "daukaev-ru-nah",
    "abdurashidov",
    "umarhadjiev-ahmatukaev",
    "nah-ru-anatomy",
    "ru-nah-anatomy",
    "nah-ru-computer"
  ],
  "nextRecommended": "karasaev-maciev-ru-nah"
}
```

**Когда использовать:** чтобы посмотреть прогресс слияния, понять какие словари уже добавлены, и узнать какой добавлять следующим.

---

## CLI-команды (пайплайн)

Все операции пайплайна (парсинг, слияние, загрузка) запускаются через терминал. Сервер запускать **не нужно** — CLI создаёт NestJS-контекст без HTTP.

**Базовая команда:**

```bash
npm run pipeline -- <command> [args]
```

Для частых операций есть шорткаты `npm run pipeline:<command>`.

---

### parse — парсинг словарей

Конвертирует исходные JSON-файлы словарей (`dictionaries/*.json`) в стандартизированный формат и сохраняет в `dictionaries/parsed/<slug>.json`.

Каждый словарь имеет свой парсер, который понимает формат именно этого источника. Парсер извлекает: слово, ударение, часть речи, грамматику, значения, примеры, фразеологию, цитаты.

```bash
# Парсинг одного словаря
npm run pipeline -- parse maciev
npm run pipeline -- parse baisultanov-nah-ru
npm run pipeline -- parse ismailov-nah-ru

# Парсинг всех 12 словарей
npm run pipeline -- parse all
npm run pipeline:parse-all          # шорткат
```

**Результат:** файлы `dictionaries/parsed/<slug>.json`

**Выходной JSON:**

```json
{
  "slug": "maciev",
  "title": "Мациев. Чеченско-русский словарь",
  "sourceCount": 21000,
  "parsedCount": 20500,
  "outputFile": "dictionaries/parsed/maciev.json"
}
```

**Что проверить после:** используй `GET /api/merge/preview/<slug>` чтобы убедиться, что парсинг прошёл корректно.

---

### clean — дедупликация оригиналов

Очищает исходные файлы словарей: удаляет дублирующиеся записи (по id) и сортирует по id. Перезаписывает оригинальный файл.

```bash
# Очистка одного словаря
npm run pipeline -- clean maciev
npm run pipeline -- clean ismailov-nah-ru

# Очистка всех
npm run pipeline -- clean all
npm run pipeline:clean-all          # шорткат
```

**Результат:** обновлённые файлы `dictionaries/<name>.json` (дубликаты удалены, записи отсортированы)

**Когда использовать:** перед парсингом, если подозреваешь дубли в исходных данных (например, после ручного редактирования JSON).

---

### unify-step — пошаговое слияние

Добавляет один словарь в единый файл `dictionaries/unified.json`. При каждом шаге:

1. Загружает распарсенный файл (`dictionaries/parsed/<slug>.json`)
2. Мержит его с текущим `unified.json` (новые слова добавляются, существующие обогащаются новыми значениями/примерами)
3. Сохраняет снэпшот (`dictionaries/unified/step_XX_<slug>.json`)
4. Записывает шаг в лог (`dictionaries/unified/merge_log.json`)

```bash
# Рекомендуемый порядок (от базовых к специализированным):
npm run pipeline -- unify-step maciev
npm run pipeline -- unify-step baisultanov-nah-ru
npm run pipeline -- unify-step karasaev-maciev-ru-nah
npm run pipeline -- unify-step aslahanov-ru-nah
npm run pipeline -- unify-step ismailov-nah-ru
npm run pipeline -- unify-step ismailov-ru-nah
npm run pipeline -- unify-step daukaev-ru-nah
npm run pipeline -- unify-step abdurashidov
npm run pipeline -- unify-step umarhadjiev-ahmatukaev
npm run pipeline -- unify-step nah-ru-anatomy
npm run pipeline -- unify-step ru-nah-anatomy
npm run pipeline -- unify-step nah-ru-computer
npm run pipeline -- unify-step collected
npm run pipeline -- unify-step neologisms
```

**Результат:**

```json
{
  "step": 3,
  "slug": "karasaev-maciev-ru-nah",
  "title": "Карасаев-Мациев. Русско-чеченский словарь",
  "entriesFromDict": 15000,
  "newWords": 4200,
  "enrichedWords": 10800,
  "totalUnifiedEntries": 28400,
  "snapshotFile": "dictionaries/unified/step_03_karasaev-maciev-ru-nah.json",
  "nextRecommended": "aslahanov-ru-nah"
}
```

**Защита от дублей:** если словарь уже добавлен — команда выдаст ошибку. Используй `reset` и начни заново.

**Что проверить после:** `GET /api/merge/unified-log` покажет все шаги и оставшиеся словари.

---

### rollback — откат слияния

Откатывает `unified.json` к состоянию на указанном шаге. Восстанавливает снэпшот и обрезает лог.

```bash
# Откатиться к шагу 5 (отменить шаги 6, 7, ...)
npm run pipeline -- rollback 5

# Откатиться к шагу 1 (оставить только первый словарь)
npm run pipeline -- rollback 1

# Откатиться до пустого состояния (удалить unified.json)
npm run pipeline -- rollback 0
```

**Результат:**

```json
{
  "rolledBackTo": 5,
  "currentEntries": 35000,
  "stepsRemoved": 3,
  "nextRecommended": "daukaev-ru-nah"
}
```

**Когда использовать:** если после добавления словаря обнаружились проблемы в данных — откатись, исправь парсер, перепарси и добавь заново.

---

### reset — полный сброс

Удаляет `unified.json`, все снэпшоты и лог слияния. После этого можно начать весь процесс слияния с нуля.

```bash
npm run pipeline -- reset
npm run pipeline:reset              # шорткат
```

**Результат:**

```json
{
  "reset": true,
  "message": "unified.json, снэпшоты и лог удалены"
}
```

**Что удаляется:**
- `dictionaries/unified.json`
- `dictionaries/unified/` (вся папка со снэпшотами и логом)

**Что НЕ удаляется:**
- Распарсенные файлы (`dictionaries/parsed/*.json`) — их перепарсивать не нужно
- Исходные словари (`dictionaries/*.json`)
- Данные в БД

---

### improve — улучшение данных

Очищает и нормализует `unified.json`:

- Удаляет значения без перевода (пустые `translation`)
- Удаляет битые примеры (пустые `nah`/`ru`, или одинаковые)
- Нормализует стилевые пометы (`прост` → `Прост.`, `устар` → `Устар.`, и т.д.)
- Удаляет битую фразеологию (пустые `nah`/`ru`)
- Удаляет битые цитаты (пустой `text`)

```bash
npm run pipeline -- improve
npm run pipeline:improve            # шорткат
```

**Результат:**

```json
{
  "total": 48532,
  "removedEmptyMeanings": 42,
  "removedBrokenExamples": 150,
  "normalizedStyleLabels": 320,
  "cleanedPhraseology": 15,
  "cleanedCitations": 8
}
```

**Когда использовать:** после завершения слияния всех словарей (`unify-step`), но до загрузки в БД (`load`).

---

### load — загрузка в БД

Загружает `unified.json` в таблицу `UnifiedEntry` в PostgreSQL. Операция атомарная (транзакция):

1. Валидирует записи (пропускает без слова или без значений)
2. Нормализует слова, оценивает CEFR-уровень
3. Очищает таблицу и вставляет все записи заново (чанками по 500)
4. Создаёт GIN-индекс для триграммного поиска

```bash
npm run pipeline -- load
npm run pipeline:load               # шорткат
```

**Результат:**

```json
{
  "loaded": 48490,
  "skipped": 42,
  "skippedSample": [
    { "word": "", "reason": "пустое слово" },
    { "word": "ка", "reason": "нет значений" }
  ],
  "totalInFile": 48532,
  "elapsedSeconds": 12.5
}
```

**Важно:** команда **полностью перезаписывает** таблицу. Старые данные удаляются и заменяются новыми в рамках одной транзакции. Если произойдёт ошибка — старые данные останутся нетронутыми.

---

## Полный пайплайн: от нуля до рабочей БД

Пошаговая инструкция для полной сборки словаря с нуля.

### Шаг 1. Убедись, что исходные словари на месте

Файлы должны лежать в `dictionaries/`:

```
dictionaries/
├── maciev.json
├── baisultanov_ce_ru.json
├── karasaev_maciev_ru_ce.json
├── aslahanov_ru_ce.json
├── ismailov_ce_ru.json
├── ismailov_ru_ce.json
├── daukaev_ru_ce.json
├── abdurashidov_ce_ru_ru_ce.json
├── umarhadjiev_ahmatukaev_ce_ru_ru_ce.json
├── ce_ru_anatomy.json
├── ru_ce_anatomy.json
├── ru_ce_ce_ru_computer.json
├── collected.json              # ручной сборник (собранные слова)
└── neologisms.json             # неологизмы (авторские)
```

### Шаг 2. (Опционально) Очистка оригиналов

```bash
npm run pipeline:clean-all
```

### Шаг 3. Парсинг всех словарей

```bash
npm run pipeline:parse-all
```

Проверь качество парсинга (запусти сервер и открой):

```
GET /api/merge/preview/maciev?limit=10
GET /api/merge/preview/baisultanov-nah-ru?limit=10
```

### Шаг 4. Пошаговое слияние

Добавляй словари один за другим в рекомендуемом порядке:

```bash
npm run pipeline -- unify-step maciev
npm run pipeline -- unify-step baisultanov-nah-ru
npm run pipeline -- unify-step karasaev-maciev-ru-nah
npm run pipeline -- unify-step aslahanov-ru-nah
npm run pipeline -- unify-step ismailov-nah-ru
npm run pipeline -- unify-step ismailov-ru-nah
npm run pipeline -- unify-step daukaev-ru-nah
npm run pipeline -- unify-step abdurashidov
npm run pipeline -- unify-step umarhadjiev-ahmatukaev
npm run pipeline -- unify-step nah-ru-anatomy
npm run pipeline -- unify-step ru-nah-anatomy
npm run pipeline -- unify-step nah-ru-computer
npm run pipeline -- unify-step collected
npm run pipeline -- unify-step neologisms
```

После каждого шага команда показывает:
- Сколько новых слов добавлено
- Сколько существующих слов обогащено
- Общее количество записей
- Какой словарь добавлять следующим

Если что-то пошло не так — откатись:

```bash
npm run pipeline -- rollback 5    # вернуться к шагу 5
```

### Шаг 5. Улучшение данных

```bash
npm run pipeline:improve
```

### Шаг 6. Загрузка в БД

```bash
npm run pipeline:load
```

### Шаг 7. Проверка

Запусти сервер и проверь:

```bash
npm run start:dev
```

```
GET /api/dictionary/stats              — общая статистика
GET /api/dictionary/search?q=стаг      — поиск по-чеченски
GET /api/dictionary/search?q=человек   — поиск по-русски
GET /api/dictionary/lookup/стаг        — карточка слова
GET /api/dictionary/declension/стаг    — склонение
GET /api/dictionary/lemmatize/стагана  — лемматизация
GET /api/merge/status                  — статус пайплайна
```

---

## Доступные словари (slug)

| Slug | Название | Направление |
|---|---|---|
| `maciev` | Мациев. Чеченско-русский словарь | nah → ru |
| `baisultanov-nah-ru` | Байсултанов. Чеченско-русский словарь | nah → ru |
| `karasaev-maciev-ru-nah` | Карасаев-Мациев. Русско-чеченский словарь | ru → nah |
| `aslahanov-ru-nah` | Аслаханов. Русско-чеченский словарь | ru → nah |
| `ismailov-nah-ru` | Исмаилов. Чеченско-русский словарь | nah → ru |
| `ismailov-ru-nah` | Исмаилов. Русско-чеченский словарь | ru → nah |
| `daukaev-ru-nah` | Даукаев. Русско-чеченский геологический словарь | ru → nah |
| `abdurashidov` | Абдурашидов. Чеченско-русский / русско-чеченский юридический словарь | both |
| `umarhadjiev-ahmatukaev` | Умархаджиев-Ахматукаев. Математический словарь | both |
| `nah-ru-anatomy` | Чеченско-русский анатомический словарь | nah → ru |
| `ru-nah-anatomy` | Русско-чеченский анатомический словарь | ru → nah |
| `nah-ru-computer` | Чеченско-русский / русско-чеченский компьютерный словарь | both |
| `collected` | Ручной сборник (собранные слова) | both |
| `neologisms` | Неологизмы (авторские) | both |
