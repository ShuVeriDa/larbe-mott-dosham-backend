import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { normalizeWord } from "src/common/utils/normalize_util";
import { PrismaService } from "src/prisma.service";
import { type ParsedEntry } from "./parsers";
import { estimateCefr, normalizeStyleLabel } from "./merge-utils";

const UNIFIED_FILE = "dictionaries/unified.json";
const CHUNK = 500;

@Injectable()
export class LoadPipelineService {
  private readonly logger = new Logger(LoadPipelineService.name);

  constructor(private prisma: PrismaService) {}

  async load() {
    const filePath = path.resolve(process.cwd(), UNIFIED_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Файл ${UNIFIED_FILE} не найден. Сначала выполните слияние.`,
      );
    }

    const unified: (ParsedEntry & { sources: string[] })[] = JSON.parse(raw);

    if (unified.length === 0) {
      throw new BadRequestException("unified.json пуст — нечего загружать");
    }

    const skipped: { word: string; reason: string }[] = [];
    const valid: typeof unified = [];
    for (const e of unified) {
      if (!e.word?.trim()) {
        skipped.push({ word: e.word ?? "(пусто)", reason: "пустое слово" });
      } else if (!e.meanings?.length) {
        skipped.push({ word: e.word, reason: "нет значений" });
      } else {
        valid.push(e);
      }
    }

    if (skipped.length > 0) {
      this.logger.warn(`Пропущено ${skipped.length} записей при валидации`);
    }

    const dbEntries = valid.map((e) => ({
      word: e.word,
      wordAccented: e.wordAccented ?? null,
      wordNormalized: normalizeWord(e.word),
      partOfSpeech: e.partOfSpeech ?? null,
      partOfSpeechNah: e.partOfSpeechNah ?? null,
      nounClass: e.nounClass ?? null,
      nounClassPlural: e.nounClassPlural ?? null,
      grammar: e.grammar ? JSON.parse(JSON.stringify(e.grammar)) : undefined,
      meanings: JSON.parse(JSON.stringify(e.meanings)),
      phraseology: e.phraseology
        ? JSON.parse(JSON.stringify(e.phraseology))
        : undefined,
      citations: e.citations
        ? JSON.parse(JSON.stringify(e.citations))
        : undefined,
      variants: e.variants ?? [],
      latinName: e.latinName ?? null,
      styleLabel: e.styleLabel ?? null,
      domain: e.domain ?? null,
      cefrLevel: estimateCefr(e),
      entryType: e.entryType ?? "standard",
      sources: e.sources,
    }));

    const totalChunks = Math.ceil(dbEntries.length / CHUNK);
    const startTime = Date.now();

    await this.prisma.$executeRawUnsafe(
      `CREATE EXTENSION IF NOT EXISTS pg_trgm`,
    );

    await this.prisma.$transaction(
      async (tx) => {
        await tx.unifiedEntry.deleteMany();
        this.logger.log(
          `Таблица очищена. Загружаю ${dbEntries.length} записей (${totalChunks} чанков по ${CHUNK})...`,
        );

        for (let i = 0; i < dbEntries.length; i += CHUNK) {
          const chunk = dbEntries.slice(i, i + CHUNK);
          await tx.unifiedEntry.createMany({ data: chunk });
          const chunkNum = Math.floor(i / CHUNK) + 1;
          if (chunkNum % 10 === 0 || chunkNum === totalChunks) {
            this.logger.log(
              `  чанк ${chunkNum}/${totalChunks} (${i + chunk.length} записей)`,
            );
          }
        }
      },
      { timeout: 120_000 },
    );

    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "UnifiedEntry_wordNormalized_trgm"
       ON "UnifiedEntry" USING gin ("wordNormalized" gin_trgm_ops)`,
    );

    this.logger.log("Создаю tsvector-колонку для полнотекстового поиска...");
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE "UnifiedEntry" ADD COLUMN IF NOT EXISTS "meaningsTsv" tsvector`,
    );
    await this.prisma.$executeRawUnsafe(`
      UPDATE "UnifiedEntry" SET "meaningsTsv" = to_tsvector('russian',
        COALESCE(
          (SELECT string_agg(elem->>'translation', ' ')
           FROM jsonb_array_elements(meanings::jsonb) AS elem),
          ''
        )
      )
    `);
    await this.prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "UnifiedEntry_meaningsTsv_gin"
       ON "UnifiedEntry" USING gin ("meaningsTsv")`,
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    this.logger.log(
      `Загрузка завершена: ${dbEntries.length} записей за ${elapsed}с`,
    );

    return {
      loaded: dbEntries.length,
      skipped: skipped.length,
      skippedSample: skipped.slice(0, 20),
      totalInFile: unified.length,
      elapsedSeconds: Number(elapsed),
    };
  }

  async improve() {
    const filePath = path.resolve(process.cwd(), UNIFIED_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Файл ${UNIFIED_FILE} не найден. Сначала выполните слияние.`,
      );
    }

    const entries = JSON.parse(raw) as (ParsedEntry & { sources: string[] })[];
    const report = {
      total: entries.length,
      removedEmptyMeanings: 0,
      removedBrokenExamples: 0,
      normalizedStyleLabels: 0,
      cleanedPhraseology: 0,
      cleanedCitations: 0,
    };

    for (const entry of entries) {
      if (entry.meanings?.length) {
        const beforeLen = entry.meanings.length;
        entry.meanings = entry.meanings.filter(
          (m) => m.translation?.trim() || m.note?.trim(),
        );
        report.removedEmptyMeanings += beforeLen - entry.meanings.length;
      }

      for (const m of entry.meanings ?? []) {
        if (!m.examples) continue;
        const beforeExLen = m.examples.length;
        m.examples = m.examples.filter((ex) => {
          if (!ex.ru?.trim() || !ex.nah?.trim()) return false;
          if (ex.nah.trim().toLowerCase() === ex.ru.trim().toLowerCase())
            return false;
          return true;
        });
        report.removedBrokenExamples += beforeExLen - m.examples.length;
        if (m.examples.length === 0) delete m.examples;
      }

      if (entry.styleLabel) {
        const normalized = normalizeStyleLabel(entry.styleLabel);
        if (normalized !== entry.styleLabel) {
          report.normalizedStyleLabels++;
          entry.styleLabel = normalized;
        }
      }

      if (entry.phraseology) {
        const beforeLen = entry.phraseology.length;
        entry.phraseology = entry.phraseology.filter(
          (p) => p.nah?.trim() && p.ru?.trim(),
        );
        report.cleanedPhraseology += beforeLen - entry.phraseology.length;
        if (entry.phraseology.length === 0) delete entry.phraseology;
      }

      if (entry.citations) {
        const beforeLen = entry.citations.length;
        entry.citations = entry.citations.filter((c) => c.text?.trim());
        report.cleanedCitations += beforeLen - entry.citations.length;
        if (entry.citations.length === 0) delete entry.citations;
      }
    }

    await fs.writeFile(filePath, JSON.stringify(entries, null, 2), "utf-8");

    this.logger.log(`improve: обработано ${entries.length} записей`);

    return report;
  }
}
