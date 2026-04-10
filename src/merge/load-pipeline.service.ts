import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
    const seenKeys = new Set<string>();

    for (const e of unified) {
      if (!e.word?.trim()) {
        skipped.push({ word: e.word ?? "(пусто)", reason: "no word" });
      } else if (!e.meanings?.length) {
        skipped.push({ word: e.word, reason: "no meanings" });
      } else if (!e.nounClass && e.partOfSpeech === "сущ.") {
        skipped.push({ word: e.word, reason: "no nounClass" });
      } else {
        const key = `${e.word}__${(e as unknown as Record<string, unknown>).homonymIndex ?? 0}`;
        if (seenKeys.has(key)) {
          skipped.push({ word: e.word, reason: "duplicate" });
        } else {
          seenKeys.add(key);
          valid.push(e);
        }
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

    try {
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
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(`Ошибка загрузки: ${errorMessage}`);
      await this.prisma.loadRun.create({
        data: {
          loaded: 0,
          skipped: skipped.length,
          totalInFile: unified.length,
          elapsedSeconds: Number(elapsed),
          status: "error",
          errorMessage,
        },
      });
      throw err;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    this.logger.log(
      `Загрузка завершена: ${dbEntries.length} записей за ${elapsed}с`,
    );

    await this.prisma.loadRun.create({
      data: {
        loaded: dbEntries.length,
        skipped: skipped.length,
        totalInFile: unified.length,
        elapsedSeconds: Number(elapsed),
        status: "ok",
      },
    });

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

    const startTime = Date.now();
    const entries = JSON.parse(raw) as (ParsedEntry & { sources: string[] })[];
    const report = {
      total: entries.length,
      removedEmptyMeanings: 0,
      removedBrokenExamples: 0,
      normalizedStyleLabels: 0,
      normalizedWords: 0,
      truncatedFields: 0,
      deduplicatedMeanings: 0,
      cleanedPhraseology: 0,
      cleanedCitations: 0,
    };

    const MAX_TRANSLATION_LEN = 2000;
    const MAX_CITATION_LEN = 500;
    const affectedEntries: Array<{ word: string; action: string; source: string }> = [];

    for (const entry of entries) {
      const source = entry.sources?.[0] ?? "";

      // 1. Нормализация слова: trim + Unicode NFC + невидимые символы
      if (entry.word) {
        const normalized = entry.word.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        if (normalized !== entry.word) {
          entry.word = normalized;
          report.normalizedWords++;
          affectedEntries.push({ word: normalized, action: "normalized word", source });
        }
      }

      // 2. Удаление meanings без текста
      if (entry.meanings?.length) {
        const beforeLen = entry.meanings.length;
        entry.meanings = entry.meanings.filter(
          (m) => m.translation?.trim() || m.note?.trim(),
        );
        const removed = beforeLen - entry.meanings.length;
        if (removed > 0) {
          report.removedEmptyMeanings += removed;
          affectedEntries.push({ word: entry.word, action: "removed empty", source });
        }
      }

      // 3. Дедупликация meanings (точное совпадение translation)
      if (entry.meanings?.length) {
        const seen = new Set<string>();
        const beforeLen = entry.meanings.length;
        entry.meanings = entry.meanings.filter((m) => {
          const key = m.translation?.trim() ?? "";
          if (!key) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const deduped = beforeLen - entry.meanings.length;
        if (deduped > 0) {
          report.deduplicatedMeanings += deduped;
          affectedEntries.push({ word: entry.word, action: "dedup meanings", source });
        }
      }

      // 4. Исправление битых примеров
      for (const m of entry.meanings ?? []) {
        if (!m.examples) continue;
        const beforeExLen = m.examples.length;
        m.examples = m.examples.filter((ex) => {
          if (!ex.ru?.trim() || !ex.nah?.trim()) return false;
          if (ex.nah.trim().toLowerCase() === ex.ru.trim().toLowerCase())
            return false;
          return true;
        });
        const removedEx = beforeExLen - m.examples.length;
        if (removedEx > 0) {
          report.removedBrokenExamples += removedEx;
          affectedEntries.push({ word: entry.word, action: "fixed example", source });
        }
        if (m.examples.length === 0) delete m.examples;
      }

      // 5. Обрезка длинных полей (translation > 2000, citation.text > 500)
      for (const m of entry.meanings ?? []) {
        if (m.translation && m.translation.length > MAX_TRANSLATION_LEN) {
          m.translation = m.translation.slice(0, MAX_TRANSLATION_LEN);
          report.truncatedFields++;
          affectedEntries.push({ word: entry.word, action: "truncated field", source });
        }
      }

      // 6. Нормализация стилевых помет
      if (entry.styleLabel) {
        const normalized = normalizeStyleLabel(entry.styleLabel);
        if (normalized !== entry.styleLabel) {
          report.normalizedStyleLabels++;
          entry.styleLabel = normalized;
          affectedEntries.push({ word: entry.word, action: "cleaned style", source });
        }
      }

      // 7. Очистка фразеологии
      if (entry.phraseology) {
        const beforeLen = entry.phraseology.length;
        entry.phraseology = entry.phraseology.filter(
          (p) => p.nah?.trim() && p.ru?.trim(),
        );
        report.cleanedPhraseology += beforeLen - entry.phraseology.length;
        if (entry.phraseology.length === 0) delete entry.phraseology;
      }

      // 8. Очистка цитат (пустые + обрезка длинных)
      if (entry.citations) {
        const beforeLen = entry.citations.length;
        entry.citations = entry.citations.filter((c) => c.text?.trim());
        report.cleanedCitations += beforeLen - entry.citations.length;
        for (const c of entry.citations) {
          if (c.text.length > MAX_CITATION_LEN) {
            c.text = c.text.slice(0, MAX_CITATION_LEN);
            report.truncatedFields++;
          }
        }
        if (entry.citations.length === 0) delete entry.citations;
      }
    }

    await fs.writeFile(filePath, JSON.stringify(entries, null, 2), "utf-8");

    const elapsedSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));

    this.logger.log(
      `improve: обработано ${entries.length} записей за ${elapsedSeconds}с`,
    );

    await this.prisma.improveRun.create({
      data: {
        total: report.total,
        normalizedStyleLabels: report.normalizedStyleLabels,
        removedEmptyMeanings: report.removedEmptyMeanings,
        removedBrokenExamples: report.removedBrokenExamples,
        normalizedWords: report.normalizedWords,
        truncatedFields: report.truncatedFields,
        deduplicatedMeanings: report.deduplicatedMeanings,
        cleanedPhraseology: report.cleanedPhraseology,
        cleanedCitations: report.cleanedCitations,
        elapsedSeconds,
        status: "ok",
      },
    });

    return {
      ...report,
      elapsedSeconds,
      // алиасы для UI
      cleaned: report.normalizedStyleLabels,
      fixedExamples: report.removedBrokenExamples,
      removedEmpty: report.removedEmptyMeanings,
      affectedEntries: affectedEntries.slice(0, 200),
    };
  }

  async improveEntries(ids: number[]) {
    if (ids.length === 0) return { processed: 0, updated: 0 };
    if (ids.length > 500) {
      throw new BadRequestException("Максимум 500 записей за один запрос");
    }

    const entries = await this.prisma.unifiedEntry.findMany({
      where: { id: { in: ids } },
      select: { id: true, word: true, meanings: true, phraseology: true, citations: true, styleLabel: true },
    });

    const report = {
      processed: entries.length,
      updated: 0,
      removedEmptyMeanings: 0,
      removedBrokenExamples: 0,
      normalizedStyleLabels: 0,
      normalizedWords: 0,
      truncatedFields: 0,
      deduplicatedMeanings: 0,
      cleanedPhraseology: 0,
      cleanedCitations: 0,
    };

    const MAX_TRANSLATION_LEN = 2000;
    const MAX_CITATION_LEN = 500;

    for (const entry of entries) {
      const updateData: Prisma.UnifiedEntryUpdateInput = {};
      let changed = false;

      // 1. Нормализация слова
      const normalizedWord = entry.word.normalize("NFC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
      if (normalizedWord !== entry.word) {
        updateData.word = normalizedWord;
        updateData.wordNormalized = normalizeWord(normalizedWord);
        report.normalizedWords++;
        changed = true;
      }

      // 2–5. Обработка meanings
      if (Array.isArray(entry.meanings)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let meanings = entry.meanings as any[];

        // 2. Удаление meanings без текста
        const beforeLen = meanings.length;
        meanings = meanings.filter((m) => m.translation?.trim() || m.note?.trim());
        report.removedEmptyMeanings += beforeLen - meanings.length;
        if (beforeLen !== meanings.length) changed = true;

        // 3. Дедупликация
        const seen = new Set<string>();
        const beforeDedup = meanings.length;
        meanings = meanings.filter((m) => {
          const key = m.translation?.trim() ?? "";
          if (!key) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        report.deduplicatedMeanings += beforeDedup - meanings.length;
        if (beforeDedup !== meanings.length) changed = true;

        // 4. Исправление битых примеров
        for (const m of meanings) {
          if (!m.examples) continue;
          const exBefore = m.examples.length;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          m.examples = m.examples.filter((ex: any) => {
            if (!ex.ru?.trim() || !ex.nah?.trim()) return false;
            if (ex.nah.trim().toLowerCase() === ex.ru.trim().toLowerCase()) return false;
            return true;
          });
          const removedEx = exBefore - m.examples.length;
          if (removedEx > 0) {
            report.removedBrokenExamples += removedEx;
            changed = true;
            if (m.examples.length === 0) delete m.examples;
          }

          // 5. Обрезка длинных translation
          if (m.translation && m.translation.length > MAX_TRANSLATION_LEN) {
            m.translation = m.translation.slice(0, MAX_TRANSLATION_LEN);
            report.truncatedFields++;
            changed = true;
          }
        }

        if (changed) updateData.meanings = meanings as unknown as Prisma.InputJsonValue;
      }

      // 6. Нормализация стилевых помет
      if (entry.styleLabel) {
        const normalized = normalizeStyleLabel(entry.styleLabel);
        if (normalized !== entry.styleLabel) {
          updateData.styleLabel = normalized;
          report.normalizedStyleLabels++;
          changed = true;
        }
      }

      // 7. Очистка фразеологии
      if (Array.isArray(entry.phraseology)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ph = entry.phraseology as any[];
        const before = ph.length;
        const cleaned = ph.filter((p) => p.nah?.trim() && p.ru?.trim());
        report.cleanedPhraseology += before - cleaned.length;
        if (before !== cleaned.length) {
          updateData.phraseology = cleaned.length > 0
            ? (cleaned as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull;
          changed = true;
        }
      }

      // 8. Очистка цитат
      if (Array.isArray(entry.citations)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cits = entry.citations as any[];
        const before = cits.length;
        const cleaned = cits.filter((c) => c.text?.trim());
        report.cleanedCitations += before - cleaned.length;
        for (const c of cleaned) {
          if (c.text.length > MAX_CITATION_LEN) {
            c.text = c.text.slice(0, MAX_CITATION_LEN);
            report.truncatedFields++;
            changed = true;
          }
        }
        if (before !== cleaned.length) {
          updateData.citations = cleaned.length > 0
            ? (cleaned as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull;
          changed = true;
        }
      }

      if (changed) {
        await this.prisma.unifiedEntry.update({ where: { id: entry.id }, data: updateData });
        report.updated++;
      }
    }

    this.logger.log(`improve-entries: обработано ${entries.length}, обновлено ${report.updated}`);

    return report;
  }
}
