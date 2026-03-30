import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  detectLanguage,
  normalizeTranslate,
  normalizeWord,
} from "src/common/utils/normalize_util";
import { PrismaService } from "src/prisma.service";
import { SearchEntryDto } from "./dto/search-entry.dto";

@Injectable()
export class DictionaryService {
  constructor(private prisma: PrismaService) {}

  async search(dto: SearchEntryDto) {
    const { q, limit = 20, offset = 0 } = dto;

    const raw = q.trim();
    const normalized = normalizeWord(raw);
    const lang = detectLanguage(raw); // 'ru' | 'nah' | 'unknown'
    const ruQuery = normalizeTranslate(raw);

    // Условие поиска зависит от языка ввода:
    // ru  → ищем в meanings (JSON) по русскому переводу
    // nah → ищем по wordNormalized
    // unknown → ищем везде
    const searchCondition =
      lang === "ru"
        ? Prisma.sql`e."meanings"::text ILIKE ${"%" + ruQuery + "%"}`
        : lang === "nah"
          ? Prisma.sql`e."wordNormalized" ILIKE ${"%" + normalized + "%"}`
          : Prisma.sql`(
              e."wordNormalized" ILIKE ${"%" + normalized + "%"}
              OR e."meanings"::text ILIKE ${"%" + ruQuery + "%"}
            )`;

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
        e.sources,
        similarity(e."wordNormalized", ${normalized}) AS score
      FROM "UnifiedEntry" e
      WHERE ${searchCondition}
      ORDER BY score DESC, length(e.word) ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const total = await this.countSearch(searchCondition);

    return {
      data: results,
      meta: { total, limit, offset, q, lang },
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

    return {
      total,
      domains: domains.map((d) => ({
        domain: d.domain ?? "general",
        count: Number(d.count),
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
  sources: string[];
  score?: number;
}
