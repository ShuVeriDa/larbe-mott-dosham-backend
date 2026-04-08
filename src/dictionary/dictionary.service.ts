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
import {
  UpdateEntryDto,
  BulkUpdateItemDto,
} from "./dto/update-entry.dto";

const CACHE_TTL = 300; // 5 минут
const CACHE_PREFIX = "dict";

@Injectable()
export class DictionaryService {
  private readonly logger = new Logger(DictionaryService.name);

  constructor(
    private prisma: PrismaService,
    private declensionService: DeclensionService,
    private redis: RedisService,
  ) {}

  async search(dto: SearchEntryDto) {
    const cacheKey = `${CACHE_PREFIX}:search:${JSON.stringify(dto)}`;
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;

    const { q, cefr, pos, nounClass, entryType, limit = 20, offset = 0 } = dto;

    const raw = q.trim();
    const normalized = normalizeWord(raw);
    const lang = detectLanguage(raw);
    const ruQuery = normalizeTranslate(raw);

    // Full-text search по переводам через tsvector (GIN-индекс),
    // fallback на ILIKE если tsvector-колонка ещё не создана
    const ruTsQuery = ruQuery.replace(/[^\wа-яёА-ЯЁ\s]/g, "").trim().split(/\s+/).join(" & ");

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
    if (cefr) filters.push(Prisma.sql`e."cefrLevel" = ${cefr}`);
    if (pos) filters.push(Prisma.sql`e."partOfSpeech" = ${pos}`);
    if (nounClass) filters.push(Prisma.sql`e."nounClass" = ${nounClass}`);
    if (entryType) filters.push(Prisma.sql`e."entryType" = ${entryType}`);

    const searchCondition = filters.reduce(
      (acc, f) => Prisma.sql`${acc} AND ${f}`,
    );

    const results = await this.prisma.$queryRaw<UnifiedSearchResult[]>`
      SELECT
        e.id,
        e.word,
        e."wordAccented",
        e."partOfSpeech",
        e."partOfSpeechNah",
        e."nounClass",
        e.grammar,
        e.meanings,
        e.phraseology,
        e.domain,
        e."cefrLevel",
        e.sources,
        similarity(e."wordNormalized", ${normalized}) AS score
      FROM "UnifiedEntry" e
      WHERE ${searchCondition}
      ORDER BY score DESC, length(e.word) ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const total = await this.countSearch(searchCondition);

    // Если по чеченскому слову ничего не нашли — пробуем лемматизацию
    // (пользователь мог ввести косвенную форму: стагана → стаг)
    let lemmaHint: string[] | undefined;
    if (
      results.length === 0 &&
      (lang === "nah" || lang === "unknown") &&
      offset === 0
    ) {
      lemmaHint = await this.declensionService.lemmatize(raw);
    }

    const response = {
      data: results,
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
        OR: [
          { wordNormalized: normalized },
          { variants: { has: normalized } },
        ],
      },
      orderBy: { id: "asc" },
    });
    await this.setCache(cacheKey, results);
    return results;
  }

  async stats() {
    const total = await this.prisma.unifiedEntry.count();
    const domains = await this.prisma.$queryRaw<
      { domain: string | null; count: bigint }[]
    >`
      SELECT domain, COUNT(*) as count
      FROM "UnifiedEntry"
      GROUP BY domain
      ORDER BY count DESC
    `;
    const cefrLevels = await this.prisma.$queryRaw<
      { cefrLevel: string | null; count: bigint }[]
    >`
      SELECT "cefrLevel", COUNT(*) as count
      FROM "UnifiedEntry"
      GROUP BY "cefrLevel"
      ORDER BY "cefrLevel" ASC
    `;

    return {
      total,
      domains: domains.map((d) => ({
        domain: d.domain ?? "general",
        count: Number(d.count),
      })),
      cefrLevels: cefrLevels.map((c) => ({
        level: c.cefrLevel ?? "unknown",
        count: Number(c.count),
      })),
    };
  }

  async random(cefr?: string) {
    const where = cefr ? Prisma.sql`WHERE e."cefrLevel" = ${cefr}` : Prisma.empty;
    const results = await this.prisma.$queryRaw<UnifiedSearchResult[]>`
      SELECT e.* FROM "UnifiedEntry" e
      ${where}
      ORDER BY RANDOM()
      LIMIT 1
    `;
    return results[0] ?? null;
  }

  async phraseologySearch(q: string, limit = 20, offset = 0) {
    const pattern = `%${q.toLowerCase()}%`;
    const results = await this.prisma.$queryRaw<UnifiedSearchResult[]>`
      SELECT e.* FROM "UnifiedEntry" e
      WHERE e."phraseology"::text ILIKE ${pattern}
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    const countResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM "UnifiedEntry" e
      WHERE e."phraseology"::text ILIKE ${pattern}
    `;
    return {
      data: results,
      meta: { total: Number(countResult[0].count), limit, offset, q },
    };
  }

  // -----------------------------------------------------------------------
  // CRUD: чтение / обновление / bulk
  // -----------------------------------------------------------------------

  async getById(id: number) {
    const entry = await this.prisma.unifiedEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException(`Entry #${id} not found`);
    return entry;
  }

  async updateEntry(id: number, dto: UpdateEntryDto) {
    await this.getById(id);
    const data = this.buildUpdateData(dto);
    const result = await this.prisma.unifiedEntry.update({ where: { id }, data });
    await this.invalidateCache();
    return result;
  }

  async bulkUpdate(items: BulkUpdateItemDto[]) {
    const results: { id: number; success: boolean; error?: string }[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const entry = await tx.unifiedEntry.findUnique({
          where: { id: item.id },
        });
        if (!entry) {
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
    return {
      total: items.length,
      updated: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
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
    if (dto.partOfSpeechNah !== undefined) data.partOfSpeechNah = dto.partOfSpeechNah;
    if (dto.nounClass !== undefined) data.nounClass = dto.nounClass;
    if (dto.nounClassPlural !== undefined) data.nounClassPlural = dto.nounClassPlural;
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

    return data;
  }

  private async countSearch(searchCondition: Prisma.Sql) {
    const res = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM "UnifiedEntry" e
      WHERE ${searchCondition}
    `;
    return Number(res[0].count);
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
      const keys = await this.redis.keys(`${CACHE_PREFIX}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        this.logger.log(`Cache invalidated: ${keys.length} keys`);
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
  grammar: unknown;
  meanings: unknown;
  phraseology: unknown;
  domain: string | null;
  cefrLevel: string | null;
  sources: string[];
  score?: number;
}
