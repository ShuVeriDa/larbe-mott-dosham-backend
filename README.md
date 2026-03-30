# Mott Larbe Dosham Backend

Бэкенд для проекта **Мотт Ларбе Дошам** — единый нохчийн (чеченский) словарь, собранный из 12 источников.

## Стек

- **NestJS** (TypeScript)
- **PostgreSQL** + **Prisma ORM**
- **Swagger** — документация API (`/api/docs`)

---

## Быстрый старт

```bash
# 1. Установка зависимостей
pnpm install

# 2. Настройка окружения
cp .env.example .env   # или создай .env вручную (см. раздел ниже)

# 3. Создание таблиц в БД
npx prisma db push

# 4. Запуск (dev)
pnpm start:dev
```

Сервер запустится на `http://localhost:9666`.
Swagger-документация: `http://localhost:9666/api/docs`.

---

## Переменные окружения (.env)

```env
DATABASE_URL=postgresql://postgres:123456@localhost:5432/larbe-mott-dosham?schema=public
IMPORT_API_KEY=K1ayleMottLarbeDosham
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:9555
PORT=9666
```

---

## Структура проекта

```
src/
  common/
    guards/api-key.guard.ts       # Защита merge-эндпоинтов по X-API-Key
    utils/normalize_util.ts       # Нормализация текста, определение языка (nah/ru)
  database/
    prisma.module.ts              # Глобальный Prisma-модуль
  dictionary/
    dictionary.controller.ts      # GET /api/dictionary/search, lookup, stats
    dictionary.service.ts         # Поиск по UnifiedEntry (similarity, ILIKE)
    dto/search-entry.dto.ts       # Валидация параметров поиска
    dictionary.module.ts
  merge/
    merge.controller.ts           # Эндпоинты сборки словаря (parse, unify, load)
    merge.service.ts              # Бизнес-логика 3-этапного pipeline
    merge.module.ts
    parsers/
      types.ts                    # ParsedEntry, GrammarInfo, Meaning, Phrase, Citation
      utils.ts                    # expandClass, dedup, stripHtml, extractExamples, ...
      maciev.parser.ts            # Парсер для словаря Мациева (эталонный)
      karasaev.parser.ts          # Парсер Карасаев-Мациев (ru→nah, стресс-марки)
      baisultanov.parser.ts       # Парсер Байсултанов (цитаты, стилевые метки)
      abdurashidov.parser.ts      # Парсер Абдурашидов (данные в word, парные записи)
      aslahanov.parser.ts         # Парсер Аслаханов (инлайн грамматика)
      anatomy.parser.ts           # Парсер анатомических словарей (латинские названия)
      computer.parser.ts          # Парсер компьютерного словаря (два класса)
      daukaev.parser.ts           # Парсер Даукаев (геологический)
      ismailov.parser.ts          # Парсер Исмаилов (ce↔ru)
      umarhadjiev.parser.ts       # Парсер Умархаджиев (математический)
      index.ts                    # getParser(slug) — маппинг slug → парсер
  import/
    dictionaries.ts               # Конфиг 12 словарей (slug, title, direction, file)
  prisma.service.ts               # Prisma-клиент с lifecycle hooks
  app.module.ts                   # Корневой модуль (Dictionary + Merge)
  main.ts                         # Bootstrap: порт, CORS, Swagger, ValidationPipe

scripts/
  test-parsers.ts                 # Тестовый скрипт проверки всех парсеров

prisma/
  schema.prisma                   # Модель UnifiedEntry

dictionaries/                     # Исходные JSON-файлы словарей (12 штук)
  parsed/                         # Результат парсинга (создаётся автоматически)
  unified.json                    # Итоговый единый словарь (создаётся автоматически)
```

---

## Модель данных (Prisma)

Единственная модель — **UnifiedEntry**:

| Поле | Тип | Описание |
|------|-----|----------|
| `word` | String | Слово без диакритики |
| `wordAccented` | String? | Слово с ударениями/тильдами |
| `wordNormalized` | String | Lowercase, без диакритики — для поиска |
| `partOfSpeech` | String? | Часть речи: сущ., гл., прил., нареч., ... |
| `nounClass` | String? | Грамм. класс ед.ч.: **ву**, **йу**, **ду**, **бу** |
| `nounClassPlural` | String? | Грамм. класс мн.ч. (если отличается от ед.ч.) |
| `grammar` | Json? | `{ genitive, dative, ergative, instrumental, plural, pluralClass, verbPresent, verbPast, verbParticiple }` |
| `meanings` | Json | `[{ translation, examples: [{ nah, ru }] }]` |
| `phraseology` | Json? | `[{ nah, ru }]` — фразеологизмы |
| `citations` | Json? | `[{ text, source? }]` — литературные цитаты с указанием произведения |
| `latinName` | String? | Латинское анатомическое название |
| `styleLabel` | String? | Стиль/регистр: Прост., Устар., Старин., Разг. |
| `domain` | String? | Предметная область: anatomy, computer, math, geology, law, sport |
| `sources` | String[] | Из каких словарей: `["maciev", "baisultanov-nah-ru", ...]` |

**Грамматические классы** хранятся в полной форме:
- `д` → `ду`, `в` → `ву`, `й` → `йу`, `б` → `бу`

**Язык** обозначается как `nah` (от **нахчийн мотт**), не `ce`.

---

## API-эндпоинты

### Словарь (поиск) — публичные

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/dictionary/search?q=бала&limit=20&offset=0` | Поиск по слову (автоопределение языка nah/ru) |
| GET | `/api/dictionary/lookup/:word` | Точный поиск слова |
| GET | `/api/dictionary/stats` | Статистика: кол-во записей, домены |

### Сборка словаря (merge) — защищены `X-API-Key`

Все POST/DELETE эндпоинты требуют заголовок:
```
X-API-Key: <значение IMPORT_API_KEY из .env>
```

#### Этап 1: Парсинг исходных JSON → `dictionaries/parsed/{slug}.json`

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/merge/parse/:slug` | Парсит один словарь → JSON файл |
| POST | `/api/merge/parse-all` | Парсит все 12 словарей |
| GET | `/api/merge/preview/:slug?limit=5` | Превью: первые N записей из распарсенного файла |

#### Этап 2: Объединение → `dictionaries/unified.json`

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/merge/unify/:slug` | Добавить один конкретный словарь в unified.json |
| POST | `/api/merge/unify-all` | Добавить все parsed JSON разом |
| DELETE | `/api/merge/reset` | Очистить unified.json (начать заново) |

#### Этап 3: Загрузка в БД

| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/merge/load` | Загрузить `unified.json` → таблица `UnifiedEntry` |

#### Мониторинг

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/merge/status` | Статус pipeline: файлы, записи на каждом этапе |

---

## Фича: сборка единого словаря (Merge Pipeline)

### Общая схема

```
Исходные JSON (12 файлов)
        │
        ▼  Этап 1: POST /api/merge/parse/:slug
dictionaries/parsed/{slug}.json    ← по одному или все сразу
        │
        ▼  Этап 2: POST /api/merge/unify/:slug
dictionaries/unified.json          ← добавляем словари по одному в единый файл
        │
        ▼  Этап 3: POST /api/merge/load
PostgreSQL → таблица UnifiedEntry  ← загружаем итоговый JSON в БД
```

Каждый этап независим. Можно остановиться, проверить результат, и продолжить.

### Подробная пошаговая инструкция

#### Подготовка

```bash
# Убедись что БД запущена и таблицы созданы
npx prisma db push

# Запусти сервер
pnpm start:dev
```

Все команды ниже используют `curl`. Замени `K1ayleMottLarbeDosham` на свой API-ключ из `.env`.

---

#### Этап 1: Парсинг

Каждый из 12 словарей имеет свой уникальный формат. Для каждого написан специализированный парсер, который извлекает:
- слово (без HTML, диакритики)
- грамматическую информацию (падежи, спряжения, мн. число)
- грамматический класс (ву/йу/ду/бу)
- значения с примерами
- фразеологизмы, цитаты, латинские названия, стилевые метки

Парсеры также выполняют **дедупликацию** (все словари содержат 2-3 копии каждой записи).

**Парсим один словарь:**

```bash
curl -X POST http://localhost:9666/api/merge/parse/maciev \
  -H "X-API-Key: K1ayleMottLarbeDosham"
```

Ответ:
```json
{
  "slug": "maciev",
  "title": "Мациев. Чеченско-русский словарь",
  "sourceCount": 8686,
  "parsedCount": 3247,
  "outputFile": "dictionaries/parsed/maciev.json"
}
```

**Проверяем результат:**

```bash
curl "http://localhost:9666/api/merge/preview/maciev?limit=2" \
  -H "X-API-Key: K1ayleMottLarbeDosham"
```

Ответ покажет первые 2 записи из распарсенного файла — можно убедиться, что парсер работает корректно.

**Парсим все 12 словарей разом:**

```bash
curl -X POST http://localhost:9666/api/merge/parse-all \
  -H "X-API-Key: K1ayleMottLarbeDosham"
```

**Список slug-ов для отдельного парсинга:**

```
maciev                    — Мациев (эталонный, nah→ru)
karasaev-maciev-ru-nah    — Карасаев-Мациев (ru→nah)
baisultanov-nah-ru        — Байсултанов (nah→ru, литературные цитаты)
aslahanov-ru-nah          — Аслаханов (ru→nah, спорт, инлайн грамматика)
daukaev-ru-nah            — Даукаев (ru→nah, геология)
abdurashidov              — Абдурашидов (юридический, данные в word)
umarhadjiev-ahmatukaev    — Умархаджиев (математический)
nah-ru-anatomy            — Анатомический (nah→ru, латинские названия)
ru-nah-anatomy            — Анатомический (ru→nah)
nah-ru-computer           — Компьютерный (два класса, примеры через тире)
ismailov-nah-ru           — Исмаилов (nah→ru)
ismailov-ru-nah           — Исмаилов (ru→nah)
```

---

#### Этап 2: Объединение

На этом этапе распарсенные JSON-файлы мержатся в один `unified.json`. Слова сопоставляются по нормализованному ключу. Если слово уже есть — к нему **добавляются** уникальные значения, примеры, грамматика, цитаты из нового словаря.

**Рекомендуемый порядок** (от самого богатого к простым):

```bash
# 1. Maciev — база, самый подробный
curl -X POST http://localhost:9666/api/merge/unify/maciev \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 2. Карасаев-Мациев — обратный, много примеров
curl -X POST http://localhost:9666/api/merge/unify/karasaev-maciev-ru-nah \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 3. Байсултанов — литературные цитаты
curl -X POST http://localhost:9666/api/merge/unify/baisultanov-nah-ru \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 4. Аслаханов — спортивная лексика с грамматикой
curl -X POST http://localhost:9666/api/merge/unify/aslahanov-ru-nah \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 5. Даукаев — геология
curl -X POST http://localhost:9666/api/merge/unify/daukaev-ru-nah \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 6. Абдурашидов — юриспруденция
curl -X POST http://localhost:9666/api/merge/unify/abdurashidov \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 7. Умархаджиев — математика
curl -X POST http://localhost:9666/api/merge/unify/umarhadjiev-ahmatukaev \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 8-9. Анатомия
curl -X POST http://localhost:9666/api/merge/unify/nah-ru-anatomy \
  -H "X-API-Key: K1ayleMottLarbeDosham"
curl -X POST http://localhost:9666/api/merge/unify/ru-nah-anatomy \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 10. Компьютерный
curl -X POST http://localhost:9666/api/merge/unify/nah-ru-computer \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# 11-12. Исмаилов
curl -X POST http://localhost:9666/api/merge/unify/ismailov-nah-ru \
  -H "X-API-Key: K1ayleMottLarbeDosham"
curl -X POST http://localhost:9666/api/merge/unify/ismailov-ru-nah \
  -H "X-API-Key: K1ayleMottLarbeDosham"
```

Каждый ответ покажет:
```json
{
  "slug": "baisultanov-nah-ru",
  "entriesFromDict": 1283,
  "newWords": 845,
  "enrichedWords": 438,
  "totalUnifiedEntries": 15230,
  "outputFile": "dictionaries/unified.json"
}
```

- `newWords` — слова, которых не было в unified.json
- `enrichedWords` — слова, которые уже были, но получили новые значения/примеры/грамматику

**Если нужно начать заново:**

```bash
curl -X DELETE http://localhost:9666/api/merge/reset \
  -H "X-API-Key: K1ayleMottLarbeDosham"
```

**Или всё сразу:**

```bash
curl -X POST http://localhost:9666/api/merge/unify-all \
  -H "X-API-Key: K1ayleMottLarbeDosham"
```

---

#### Этап 3: Загрузка в БД

```bash
curl -X POST http://localhost:9666/api/merge/load \
  -H "X-API-Key: K1ayleMottLarbeDosham"
```

Ответ:
```json
{ "loaded": 24507 }
```

---

#### Проверка результата

```bash
# Статус всего pipeline
curl "http://localhost:9666/api/merge/status" \
  -H "X-API-Key: K1ayleMottLarbeDosham"

# Поиск на нохчийн
curl "http://localhost:9666/api/dictionary/search?q=бала"

# Поиск на русском
curl "http://localhost:9666/api/dictionary/search?q=горе"

# Точный поиск слова
curl "http://localhost:9666/api/dictionary/lookup/бала"

# Статистика
curl "http://localhost:9666/api/dictionary/stats"
```

---

#### Тестирование парсеров (без сервера)

```bash
npx ts-node scripts/test-parsers.ts
```

Скрипт прогонит все 12 парсеров и выведет таблицу с результатами: сколько записей распарсено, с грамматикой, с классами, с примерами, с ошибками. Также покажет лучший пример из каждого словаря.

---

## Словари-источники

| Slug | Название | Направл. | Исходных | После парсинга | Домен |
|------|----------|----------|----------|----------------|-------|
| `maciev` | Мациев | nah→ru | 8 686 | 3 247 | общий |
| `karasaev-maciev-ru-nah` | Карасаев-Мациев | ru→nah | 26 532 | 9 196 | общий |
| `baisultanov-nah-ru` | Байсултанов | nah→ru | 3 570 | 1 283 | общий |
| `aslahanov-ru-nah` | Аслаханов | ru→nah | 8 205 | 3 224 | sport |
| `daukaev-ru-nah` | Даукаев | ru→nah | 5 379 | 2 386 | geology |
| `abdurashidov` | Абдурашидов | both | 2 951 | 461 | law |
| `umarhadjiev-ahmatukaev` | Умархаджиев | both | 1 756 | 587 | math |
| `nah-ru-anatomy` | Анатомический | nah→ru | 4 447 | 1 642 | anatomy |
| `ru-nah-anatomy` | Анатомический | ru→nah | 4 362 | 1 653 | anatomy |
| `nah-ru-computer` | Компьютерный | both | 1 092 | 398 | computer |
| `ismailov-nah-ru` | Исмаилов | nah→ru | 737 | 363 | общий |
| `ismailov-ru-nah` | Исмаилов | ru→nah | 135 | 67 | общий |
| **Итого** | | | **67 852** | **24 507** | |

Разница между "исходных" и "после парсинга" — это **дедупликация** (словари содержат 2-3 копии) + пропуск сломанных/пустых записей.

---

## Парсеры

| Парсер | Словари | Что извлекает |
|--------|---------|---------------|
| **maciev** | maciev | Грамматика `[падежи, класс; мн.]`, POS, значения `1) 2)`, примеры, фразеологизмы `◊` |
| **karasaev** | karasaev-maciev | RU→NAH, стресс-марки, стилевые метки (`рел.`, `перен.`), фразеологизмы |
| **baisultanov** | baisultanov | Мн.число из word, стилевые метки (Прост., Устар.), **литературные цитаты** с авторами, встроенные подстатьи |
| **abdurashidov** | abdurashidov | Парные записи (headword + sub-entry), класс из `<i>в,ю,б</i>`, граница `</b>` |
| **aslahanov** | aslahanov | **Инлайн грамматика** `(gen,dat,erg,instr,<i>class;мн.</i>plural)` прямо в переводе |
| **anatomy** | nah-ru/ru-nah anatomy | **Латинские названия** `(M. Transversus abdominis)`, описание функций |
| **computer** | nah-ru-computer | Два класса `(ед.,мн.)`, примеры через тире `–` |
| **daukaev** | daukaev | Аннотации `м-л/г.п.`, полные классы `(ду)` |
| **ismailov** | ismailov ce+ru | Числовые суффиксы `а1/а2`, POS `(союз)`, классы `(бу)` |
| **umarhadjiev** | umarhadjiev | Класс из word `ю;`, грамматика из `<b><i>формы</i></b>` |

Все парсеры выполняют **дедупликацию** внутри (словари содержат 2-3 копии каждой записи).

---

## Скрипты

```bash
pnpm start:dev                # Запуск в dev-режиме с hot-reload
pnpm build                    # Сборка
pnpm start:prod               # Запуск production
pnpm lint                     # ESLint
pnpm format                   # Prettier
pnpm test                     # Jest тесты
npx ts-node scripts/test-parsers.ts  # Тест всех парсеров
```
#   l a r b e - m o t t - d o s h a m - b a c k e n d  
 