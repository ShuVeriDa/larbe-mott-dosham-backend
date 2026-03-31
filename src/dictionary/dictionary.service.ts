import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  detectLanguage,
  normalizeTranslate,
  normalizeWord,
} from "src/common/utils/normalize_util";
import { PrismaService } from "src/prisma.service";
import { DeclensionService } from "./declension.service";
import { SearchEntryDto } from "./dto/search-entry.dto";

@Injectable()
export class DictionaryService {
  constructor(
    private prisma: PrismaService,
    private declensionService: DeclensionService,
  ) {}

  async search(dto: SearchEntryDto) {
    const { q, cefr, limit = 20, offset = 0 } = dto;

    const raw = q.trim();
    const normalized = normalizeWord(raw);
    const lang = detectLanguage(raw); // 'ru' | 'nah' | 'unknown'
    const ruQuery = normalizeTranslate(raw);

    // Условие поиска зависит от языка ввода:
    // ru  → ищем в meanings (JSON) по русскому переводу
    // nah → ищем по wordNormalized
    // unknown → ищем везде
    const langCondition =
      lang === "ru"
        ? Prisma.sql`e."meanings"::text ILIKE ${"%" + ruQuery + "%"}`
        : lang === "nah"
          ? Prisma.sql`e."wordNormalized" ILIKE ${"%" + normalized + "%"}`
          : Prisma.sql`(
              e."wordNormalized" ILIKE ${"%" + normalized + "%"}
              OR e."meanings"::text ILIKE ${"%" + ruQuery + "%"}
            )`;

    // Опциональный фильтр по CEFR уровню
    const searchCondition = cefr
      ? Prisma.sql`${langCondition} AND e."cefrLevel" = ${cefr}`
      : langCondition;

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

    return {
      data: results,
      meta: { total, limit, offset, q, cefr, lang, lemmaHint },
    };
  }

  async lookup(word: string) {
    const normalized = normalizeWord(word.trim());

    return this.prisma.unifiedEntry.findMany({
      where: { wordNormalized: normalized },
      orderBy: { id: "asc" },
    });
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

  private async countSearch(searchCondition: Prisma.Sql) {
    const res = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count
      FROM "UnifiedEntry" e
      WHERE ${searchCondition}
    `;
    return Number(res[0].count);
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
