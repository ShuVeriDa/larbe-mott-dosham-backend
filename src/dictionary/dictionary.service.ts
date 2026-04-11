import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  detectLanguage,
  normalizeTranslate,
  normalizeWord,
} from "src/common/utils/normalize_util";
import { PrismaService } from "src/prisma.service";
import { RedisService } from "src/redis/redis.service";
import { DeclensionService } from "./declension.service";
import { SearchEntryDto } from "./dto/search-entry.dto";
import { UpdateEntryDto, BulkUpdateItemDto } from "./dto/update-entry.dto";

const CACHE_TTL = 300; // 5 минут
const CACHE_PREFIX = "dict";

export interface AuditActor {
  userId?: string;
  apiKeyId?: string;
  actorType: "admin" | "api";
}

type SourceDirection = "nah→ru" | "ru→nah" | "оба";

interface SourceMeta {
  name: string;
  direction: SourceDirection;
}

const SOURCE_MAP: Record<string, SourceMeta> = {
  "maciev":                   { name: "Мациев А.Г. Чеченско-русский словарь (1961)",       direction: "nah→ru" },
  "baisultanov-nah-ru":       { name: "Байсултанов Д. Чеченско-русский словарь",            direction: "nah→ru" },
  "baisultanov-ru-nah":       { name: "Байсултанов Д. Русско-чеченский словарь",            direction: "ru→nah" },
  "ismailov-nah-ru":          { name: "Исмаилов Ш. Чеченско-русский словарь",              direction: "nah→ru" },
  "karasaev-ru-nah":          { name: "Карасаев А.Т. Русско-чеченский словарь",            direction: "ru→nah" },
  "karasaev-nah-ru":          { name: "Карасаев А.Т. Чеченско-русский словарь",            direction: "nah→ru" },
  "vagapov":                  { name: "Вагапов А.Д. Этимологический словарь",              direction: "nah→ru" },
  "aliev":                    { name: "Алиев Х.О. Чеченско-русский словарь",               direction: "nah→ru" },
  "malsagov":                 { name: "Мальсагов З.К. Грамматика чеченского языка",        direction: "nah→ru" },
  "taimiev":                  { name: "Таймиев А. Чеченско-русский словарь",               direction: "nah→ru" },
  "sulejmanov":               { name: "Сулейманов А. Чеченско-русский словарь",            direction: "nah→ru" },
  "natsieva":                 { name: "Нацаева С. Чеченско-русский фразеологический словарь", direction: "nah→ru" },
  "collected":                { name: "Ручной сборник (авторский)",                        direction: "оба"    },
  "neologisms":               { name: "Неологизмы чеченского языка",                       direction: "оба"    },
};

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  constructor(
    private prisma: PrismaService,
    private declensionService: DeclensionService,
    private redis: RedisService,
  ) {}

  async search(dto: SearchEntryDto) {
    const stableKey = JSON.stringify(
      Object.fromEntries(Object.entries(dto).sort(([a], [b]) => a.localeCompare(b))),
    );
    const cacheKey = `${CACHE_PREFIX}:search:${stableKey}`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const { q, cefr, pos, nounClass, entryType, source, sort = "relevance", limit = 20, offset = 0 } = dto;

    const raw = q.trim();
    const normalized = normalizeWord(raw);
    const lang = detectLanguage(raw);
    const ruQuery = normalizeTranslate(raw);

    // Full-text search по переводам через tsvector (GIN-индекс),
    // fallback на ILIKE если tsvector-колонка ещё не создана
    const ruTsQuery = ruQuery
      .replace(/[^\wа-яёА-ЯЁ\s]/g, "")
      .trim()
      .split(/\s+/)
      .join(" & ");

    const langCondition =
      lang === "ru"
        ? Prisma.sql`(
            e."meaningsTsv" @@ to_tsquery('russian', ${ruTsQuery || ruQuery})
            OR e."meanings"::text ILIKE ${"%" + ruQuery + "%"}
          )`
        : lang === "nah"
          ? Prisma.sql`e."wordNormalized" ILIKE ${"%" + normalized + "%"}`
          : Prisma.sql`(
              e."wordNormalized" ILIKE ${"%" + normalized + "%"}
              OR e."meaningsTsv" @@ to_tsquery('russian', ${ruTsQuery || ruQuery})
              OR e."meanings"::text ILIKE ${"%" + ruQuery + "%"}
            )`;

    // Дополнительные фильтры
    const filters = [langCondition];
    if (cefr && cefr.length > 0)
      filters.push(Prisma.sql`e."cefrLevel" = ANY(${cefr}::text[])`);
    if (pos) filters.push(Prisma.sql`e."partOfSpeech" = ${pos}`);
    if (nounClass) filters.push(Prisma.sql`e."nounClass" = ${nounClass}`);
    if (entryType) filters.push(Prisma.sql`e."entryType" = ${entryType}`);
    if (source) filters.push(Prisma.sql`${source} = ANY(e.sources::text[])`);

    const searchCondition = filters.reduce(
      (acc, f) => Prisma.sql`${acc} AND ${f}`,
    );

    const orderByClause =
      sort === "asc"
        ? Prisma.sql`e.word ASC`
        : sort === "desc"
          ? Prisma.sql`e.word DESC`
          : sort === "updatedAt_desc"
            ? Prisma.sql`e."updatedAt" DESC`
            : sort === "updatedAt_asc"
              ? Prisma.sql`e."updatedAt" ASC`
              : sort === "createdAt_desc"
                ? Prisma.sql`e."createdAt" DESC`
                : sort === "meaningsCount_desc"
                  ? Prisma.sql`jsonb_array_length(e.meanings::jsonb) DESC, e.word ASC`
                  : Prisma.sql`score DESC, length(e.word) ASC`;

    const results = await this.prisma.$queryRaw<
      (UnifiedSearchResult & { total_count: bigint })[]
    >`
      SELECT
        e.id,
        e.word,
        e."wordAccented",
        e."partOfSpeech",
        e."partOfSpeechNah",
        e."nounClass",
        e."entryType",
        e.variants,
        e.grammar,
        e.meanings,
        e.phraseology,
        e.domain,
        e."cefrLevel",
        e.sources,
        e."updatedAt",
        e."createdAt",
        similarity(e."wordNormalized", ${normalized}) AS score,
        COUNT(*) OVER() AS total_count
      FROM "UnifiedEntry" e
      WHERE ${searchCondition}
      ORDER BY ${orderByClause}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const total = results.length > 0 ? Number(results[0].total_count) : 0;

    // Убираем total_count из результатов
    const data = results.map(({ total_count, ...rest }) => rest);

    // Если по чеченскому слову ничего не нашли — пробуем лемматизацию
    // (пользователь мог ввести косвенную форму: стагана → стаг)
    let lemmaHint: string[] | undefined;
    if (
      data.length === 0 &&
      (lang === "nah" || lang === "unknown") &&
      offset === 0
    ) {
      lemmaHint = await this.declensionService.lemmatize(raw);
    }

    const response = {
      data,
      meta: { total, limit, offset, q, cefr, lang, lemmaHint },
    };
    await this.setCache(cacheKey, response);
    return response;
  }

  async lookup(word: string) {
    const cacheKey = `${CACHE_PREFIX}:lookup:${word}`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;
    const normalized = normalizeWord(word.trim());

    const results = await this.prisma.unifiedEntry.findMany({
      where: {
        OR: [{ wordNormalized: normalized }, { variants: { has: normalized } }],
      },
      orderBy: { id: "asc" },
    });
    await this.setCache(cacheKey, results);
    return results;
  }

  async sources() {
    const cacheKey = `${CACHE_PREFIX}:sources`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const counts = await this.prisma.$queryRaw<{ src: string; count: bigint }[]>`
      SELECT src, COUNT(*) AS count
      FROM "UnifiedEntry", unnest(sources) AS src
      GROUP BY src
    `;
    const countMap = Object.fromEntries(counts.map((c) => [c.src, Number(c.count)]));

    const result = Object.entries(SOURCE_MAP).map(([slug, meta]) => ({
      slug,
      name: meta.name,
      direction: meta.direction,
      count: countMap[slug] ?? 0,
    }));

    await this.setCache(cacheKey, result);
    return result;
  }

  async posValues() {
    const cacheKey = `${CACHE_PREFIX}:pos-values`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const rows = await this.prisma.$queryRaw<{ pos: string }[]>`
      SELECT DISTINCT "partOfSpeech" AS pos
      FROM "UnifiedEntry"
      WHERE "partOfSpeech" IS NOT NULL
      ORDER BY pos ASC
    `;
    const result = rows.map((r) => r.pos);
    await this.setCache(cacheKey, result);
    return result;
  }

  async popularQueries() {
    // Топ-10 запросов за последние 7 дней из таблицы SearchHistory
    const cacheKey = `${CACHE_PREFIX}:popular-queries`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<{ query: string; count: bigint }[]>`
      SELECT query, COUNT(*) AS count
      FROM "SearchHistory"
      WHERE "createdAt" >= ${since}
      GROUP BY query
      ORDER BY count DESC
      LIMIT 10
    `;
    const result = rows.map((r) => ({ query: r.query, count: Number(r.count) }));
    await this.setCache(cacheKey, result);
    return result;
  }

  async stats() {
    const cacheKey = `${CACHE_PREFIX}:stats`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const [total, domains, cefrLevels, sourcesResult, posDistribution] =
      await Promise.all([
        this.prisma.unifiedEntry.count(),
        this.prisma.$queryRaw<{ domain: string | null; count: bigint }[]>`
          SELECT domain, COUNT(*) AS count
          FROM "UnifiedEntry"
          GROUP BY domain
          ORDER BY count DESC
        `,
        this.prisma.$queryRaw<{ cefrLevel: string | null; count: bigint }[]>`
          SELECT "cefrLevel", COUNT(*) AS count
          FROM "UnifiedEntry"
          GROUP BY "cefrLevel"
        `,
        this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(DISTINCT src) AS count
          FROM "UnifiedEntry", unnest(sources) AS src
        `,
        this.prisma.$queryRaw<{ pos: string; count: bigint }[]>`
          SELECT "partOfSpeech" AS pos, COUNT(*) AS count
          FROM "UnifiedEntry"
          WHERE "partOfSpeech" IS NOT NULL
          GROUP BY "partOfSpeech"
          ORDER BY count DESC
        `,
      ]);

    const totalSources = Number(sourcesResult[0].count);

    const cefrKnown = cefrLevels
      .filter((c) => c.cefrLevel !== null && c.cefrLevel !== "unknown")
      .map((c) => ({ level: c.cefrLevel as string, count: Number(c.count) }))
      .sort(
        (a, b) => CEFR_ORDER.indexOf(a.level) - CEFR_ORDER.indexOf(b.level),
      );
    const cefrUnclassified = cefrLevels
      .filter((c) => c.cefrLevel === null || c.cefrLevel === "unknown")
      .reduce((sum, c) => sum + Number(c.count), 0);

    const result = {
      total,
      totalSources,
      domains: domains.map((d) => ({
        domain: d.domain ?? "general",
        count: Number(d.count),
        percentage: Math.round((Number(d.count) / total) * 1000) / 10,
      })),
      cefrLevels: cefrKnown.map((c) => ({
        level: c.level,
        count: c.count,
        percentage: Math.round((c.count / total) * 1000) / 10,
      })),
      cefrUnclassified,
      posDistribution: posDistribution.map((p) => ({
        pos: p.pos,
        count: Number(p.count),
      })),
    };

    await this.setCache(cacheKey, result);
    return result;
  }

  async wordOfDay() {
    const cacheKey = `${CACHE_PREFIX}:wotd:${new Date().toISOString().slice(0, 10)}`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const total = await this.prisma.unifiedEntry.count();
    if (total === 0) return null;

    // Детерминированный индекс по дате: меняется раз в сутки
    const today = new Date().toISOString().slice(0, 10); // "2026-04-09"
    const seed = today
      .split("")
      .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const skip = seed % total;

    const entry = await this.prisma.unifiedEntry.findFirst({ skip });
    // TTL до конца суток (UTC)
    const now = new Date();
    const midnight = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const ttl = Math.floor((midnight.getTime() - now.getTime()) / 1000);

    try {
      await this.redis.set(
        cacheKey,
        JSON.stringify(entry),
        "EX",
        Math.max(ttl, 60),
      );
    } catch {
      // cache failure is not critical
    }

    return entry;
  }

  async random(cefr?: string) {
    const where = cefr ? { cefrLevel: cefr } : {};
    const count = await this.prisma.unifiedEntry.count({ where });
    if (count === 0) return null;

    const skip = Math.floor(Math.random() * count);
    return this.prisma.unifiedEntry.findFirst({ where, skip });
  }

  async phraseologySearch(q?: string, limit = 20, offset = 0) {
    const cacheKey = `${CACHE_PREFIX}:phraseology:${q ?? ""}:${limit}:${offset}`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    if (q && q.trim().length > 0) {
      const normalized = normalizeWord(q.trim());
      const pattern = '%' + q + '%';
      const results = await this.prisma.$queryRaw<
        (UnifiedSearchResult & { total_count: bigint })[]
      >`
        SELECT e.*,
          (
            SELECT MAX(similarity(ph->>'nah', ${normalized}))
            FROM jsonb_array_elements(e."phraseology") AS ph
          ) AS score,
          COUNT(*) OVER() AS total_count
        FROM "UnifiedEntry" e
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(e."phraseology") AS ph
          WHERE ph->>'nah' ILIKE ${pattern}
             OR ph->>'ru'  ILIKE ${pattern}
        )
        ORDER BY score DESC, e.word ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const total = results.length > 0 ? Number(results[0].total_count) : 0;
      const response = {
        data: results.map(({ total_count, ...e }) => ({
          ...e,
          phraseology: Array.isArray(e.phraseology) ? e.phraseology : [],
        })),
        meta: { total, limit, offset, q },
      };
      await this.setCache(cacheKey, response);
      return response;
    }

    // Browse-режим: записи у которых есть хотя бы одна фразеология
    const results = await this.prisma.$queryRaw<UnifiedSearchResult[]>`
      SELECT e.* FROM "UnifiedEntry" e
      WHERE jsonb_array_length(e."phraseology") > 0
      ORDER BY e.id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    const countResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM "UnifiedEntry" e
      WHERE jsonb_array_length(e."phraseology") > 0
    `;
    const response = {
      data: results.map((e) => ({
        ...e,
        phraseology: Array.isArray(e.phraseology) ? e.phraseology : [],
      })),
      meta: { total: Number(countResult[0].count), limit, offset, q: null },
    };
    await this.setCache(cacheKey, response);
    return response;
  }

  // -----------------------------------------------------------------------
  // CRUD: чтение / обновление / bulk
  // -----------------------------------------------------------------------

  async getById(id: number) {
    const entry = await this.prisma.unifiedEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException(`Entry #${id} not found`);
    return entry;
  }

  async deleteEntry(id: number, actor?: AuditActor) {
    const entry = await this.getById(id);
    await this.prisma.unifiedEntry.delete({ where: { id } });
    await this.invalidateCache();
    if (actor !== undefined) {
      void (this.prisma.entryEditLog as any)
        .create({
          data: {
            entryId: null,
            userId: actor.userId ?? null,
            apiKeyId: actor.apiKeyId ?? null,
            actorType: actor.actorType,
            action: "delete",
            changes: { deletedEntry: { id, word: entry.word } },
          },
        })
        .catch(() => {});
    }
    return { deleted: true, id };
  }

  async updateEntry(id: number, dto: UpdateEntryDto, actor?: AuditActor) {
    const before = await this.getById(id);
    const data = this.buildUpdateData(dto);
    const result = await this.prisma.unifiedEntry.update({
      where: { id },
      data,
    });
    await this.invalidateCache();
    if (actor !== undefined) {
      const changes: Record<string, { old: unknown; new: unknown }> = {};
      for (const key of Object.keys(dto)) {
        if ((dto as Record<string, unknown>)[key] !== undefined) {
          changes[key] = {
            old: (before as Record<string, unknown>)[key],
            new: (dto as Record<string, unknown>)[key],
          };
        }
      }
      void (this.prisma.entryEditLog as any)
        .create({
          data: {
            entryId: id,
            userId: actor.userId ?? null,
            apiKeyId: actor.apiKeyId ?? null,
            actorType: actor.actorType,
            action: "update",
            changes,
          },
        })
        .catch(() => {});
    }
    return result;
  }

  async bulkUpdate(items: BulkUpdateItemDto[], actor?: AuditActor) {
    const startTime = Date.now();
    const results: { id: number; success: boolean; error?: string }[] = [];

    await this.prisma.$transaction(async (tx) => {
      // Проверяем существование всех записей одним запросом
      const ids = items.map((i) => i.id);
      const existing = await tx.unifiedEntry.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((e) => e.id));

      for (const item of items) {
        if (!existingIds.has(item.id)) {
          results.push({
            id: item.id,
            success: false,
            error: `Entry #${item.id} not found`,
          });
          continue;
        }

        const data = this.buildUpdateData(item.data);
        await tx.unifiedEntry.update({ where: { id: item.id }, data });
        results.push({ id: item.id, success: true });
      }
    });

    await this.invalidateCache();

    if (actor !== undefined) {
      const successIds = results.filter((r) => r.success).map((r) => r.id);
      if (successIds.length > 0) {
        void (this.prisma.entryEditLog as any)
          .create({
            data: {
              entryId: null,
              userId: actor.userId ?? null,
              apiKeyId: actor.apiKeyId ?? null,
              actorType: actor.actorType,
              action: "bulk",
              changes: { _meta: { count: successIds.length, ids: successIds } },
            },
          })
          .catch(() => {});
      }
    }

    return {
      total: items.length,
      updated: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
      durationMs: Date.now() - startTime,
    };
  }

  private buildUpdateData(dto: UpdateEntryDto): Prisma.UnifiedEntryUpdateInput {
    const data: Prisma.UnifiedEntryUpdateInput = {};

    if (dto.word !== undefined) {
      data.word = dto.word;
      data.wordNormalized = normalizeWord(dto.word);
    }
    if (dto.wordAccented !== undefined) data.wordAccented = dto.wordAccented;
    if (dto.partOfSpeech !== undefined) data.partOfSpeech = dto.partOfSpeech;
    if (dto.partOfSpeechNah !== undefined)
      data.partOfSpeechNah = dto.partOfSpeechNah;
    if (dto.nounClass !== undefined) data.nounClass = dto.nounClass;
    if (dto.nounClassPlural !== undefined)
      data.nounClassPlural = dto.nounClassPlural;
    if (dto.grammar !== undefined) data.grammar = dto.grammar;
    if (dto.meanings !== undefined)
      data.meanings = JSON.parse(JSON.stringify(dto.meanings));
    if (dto.phraseology !== undefined)
      data.phraseology = JSON.parse(JSON.stringify(dto.phraseology));
    if (dto.citations !== undefined)
      data.citations = JSON.parse(JSON.stringify(dto.citations));
    if (dto.latinName !== undefined) data.latinName = dto.latinName;
    if (dto.styleLabel !== undefined) data.styleLabel = dto.styleLabel;
    if (dto.variants !== undefined) data.variants = dto.variants;
    if (dto.domain !== undefined) data.domain = dto.domain;
    if (dto.cefrLevel !== undefined) data.cefrLevel = dto.cefrLevel;
    if (dto.entryType !== undefined) data.entryType = dto.entryType;
    if (dto.sources !== undefined) data.sources = dto.sources;
    if (dto.homonymIndex !== undefined) data.homonymIndex = dto.homonymIndex;

    return data;
  }

  // -----------------------------------------------------------------------
  // Redis cache helpers
  // -----------------------------------------------------------------------

  private async getCache<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private async setCache(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "EX", CACHE_TTL);
    } catch {
      // cache failure is not critical
    }
  }

  /** Сброс кэша search/lookup при изменении записей */
  private async invalidateCache(): Promise<void> {
    try {
      let cursor = "0";
      let deleted = 0;
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          "MATCH",
          `${CACHE_PREFIX}:*`,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== "0");

      if (deleted > 0) {
        this.logger.log(`Cache invalidated: ${deleted} keys`);
      }
    } catch {
      // cache failure is not critical
    }
  }
}

export interface UnifiedSearchResult {
  id: number;
  word: string;
  wordAccented: string | null;
  partOfSpeech: string | null;
  partOfSpeechNah: string | null;
  nounClass: string | null;
  entryType: string | null;
  variants: string[];
  grammar: unknown;
  meanings: unknown;
  phraseology: unknown;
  domain: string | null;
  cefrLevel: string | null;
  sources: string[];
  updatedAt?: Date;
  createdAt?: Date;
  score?: number;
}
