import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { normalizeWord } from "src/common/utils/normalize_util";
import { DICTIONARIES } from "src/import/dictionaries";
import { type ParsedEntry } from "./parsers";
import { mergeInto } from "./merge-utils";

const PARSED_DIR = "dictionaries/parsed";
const UNIFIED_FILE = "dictionaries/unified.json";
const UNIFIED_DIR = "dictionaries/unified";
const MERGE_LOG_FILE = "dictionaries/unified/merge_log.json";

const NEOLOGISM_SLUGS = new Set(["neologisms"]);

const MERGE_ORDER: string[] = [
  "maciev",
  "baisultanov-nah-ru",
  "karasaev-maciev-ru-nah",
  "aslahanov-ru-nah",
  "ismailov-nah-ru",
  "ismailov-ru-nah",
  "daukaev-ru-nah",
  "abdurashidov",
  "umarhadjiev-ahmatukaev",
  "nah-ru-anatomy",
  "ru-nah-anatomy",
  "nah-ru-computer",
  "collected",
  "neologisms",
];

export interface MergeLogEntry {
  step: number;
  slug: string;
  title: string;
  timestamp: string;
  entriesFromDict: number;
  newWords: number;
  enrichedWords: number;
  totalUnifiedEntries: number;
  snapshotFile: string;
}

function entryKey(entry: ParsedEntry): string {
  const base = normalizeWord(entry.word);
  const parts = [base];
  if (entry.homonymIndex) parts.push(`#${entry.homonymIndex}`);
  if (entry.nounClass) parts.push(`|${entry.nounClass}`);
  return parts.join("");
}

@Injectable()
export class UnifyPipelineService {
  private readonly logger = new Logger(UnifyPipelineService.name);

  async unifyStep(slug: string) {
    const meta = DICTIONARIES.find((d) => d.slug === slug);
    if (!meta) throw new BadRequestException(`Словарь "${slug}" не найден`);

    const parsedPath = path.resolve(
      process.cwd(),
      PARSED_DIR,
      `${slug}.json`,
    );
    let raw: string;
    try {
      raw = await fs.readFile(parsedPath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Файл ${PARSED_DIR}/${slug}.json не найден. Сначала выполните: npm run pipeline -- parse ${slug}`,
      );
    }
    const newEntries: ParsedEntry[] = JSON.parse(raw);

    const { merged, existingSources } = await this.loadUnifiedMap();
    const log = await this.readMergeLog();

    if (existingSources.has(slug)) {
      throw new BadRequestException(
        `Словарь "${slug}" уже добавлен (шаг ${log.find((e) => e.slug === slug)?.step}). Для пересборки выполните: npm run pipeline -- reset`,
      );
    }

    const isNeologismSource = NEOLOGISM_SLUGS.has(slug);
    let added = 0;
    let enriched = 0;
    for (const entry of newEntries) {
      const key = entryKey(entry);
      if (!key) continue;

      if (isNeologismSource) {
        entry.entryType = "neologism";
      }

      const existing = merged.get(key);
      if (existing) {
        mergeInto(existing.entry, entry);
        existing.sources.add(slug);
        enriched++;
      } else {
        merged.set(key, { entry, sources: new Set([slug]) });
        added++;
      }
    }

    await this.saveUnifiedMap(merged);

    const step = log.length + 1;
    const stepStr = String(step).padStart(2, "0");
    const snapshotFile = `${UNIFIED_DIR}/step_${stepStr}_${slug}.json`;
    const snapshotPath = path.resolve(process.cwd(), snapshotFile);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.copyFile(
      path.resolve(process.cwd(), UNIFIED_FILE),
      snapshotPath,
    );

    const logEntry: MergeLogEntry = {
      step,
      slug,
      title: meta.title,
      timestamp: new Date().toISOString(),
      entriesFromDict: newEntries.length,
      newWords: added,
      enrichedWords: enriched,
      totalUnifiedEntries: merged.size,
      snapshotFile,
    };
    log.push(logEntry);
    await this.writeMergeLog(log);

    this.logger.log(
      `step ${step}/${MERGE_ORDER.length} [${slug}]: +${added} новых, ${enriched} обогащено → итого ${merged.size}`,
    );

    const addedSlugs = new Set(log.map((e) => e.slug));
    const nextSlug = MERGE_ORDER.find((s) => !addedSlugs.has(s)) ?? null;

    return {
      step,
      slug,
      title: meta.title,
      entriesFromDict: newEntries.length,
      newWords: added,
      enrichedWords: enriched,
      totalUnifiedEntries: merged.size,
      snapshotFile,
      nextRecommended: nextSlug,
    };
  }

  async getUnifiedLog() {
    const log = await this.readMergeLog();
    const addedSlugs = new Set(log.map((e) => e.slug));
    const remaining = MERGE_ORDER.filter((s) => !addedSlugs.has(s));
    return {
      steps: log,
      totalSteps: log.length,
      remaining,
      nextRecommended: remaining[0] ?? null,
    };
  }

  async rollback(step: number) {
    const log = await this.readMergeLog();

    if (step < 0 || step > log.length) {
      throw new BadRequestException(
        `Шаг ${step} не существует. Доступны: 0 (пустой) .. ${log.length}`,
      );
    }

    const unifiedPath = path.resolve(process.cwd(), UNIFIED_FILE);

    if (step === 0) {
      try {
        await fs.unlink(unifiedPath);
      } catch {
        /* нет файла */
      }
    } else {
      const target = log[step - 1];
      const snapshotPath = path.resolve(process.cwd(), target.snapshotFile);
      try {
        await fs.copyFile(snapshotPath, unifiedPath);
      } catch {
        throw new BadRequestException(
          `Снэпшот ${target.snapshotFile} не найден на диске`,
        );
      }
    }

    const trimmedLog = log.slice(0, step);
    await this.writeMergeLog(trimmedLog);

    const addedSlugs = new Set(trimmedLog.map((e) => e.slug));
    const nextSlug = MERGE_ORDER.find((s) => !addedSlugs.has(s)) ?? null;

    this.logger.log(
      `Откат к шагу ${step}${step > 0 ? ` (${log[step - 1].slug})` : " (пустой)"}`,
    );

    return {
      rolledBackTo: step,
      currentEntries: step > 0 ? log[step - 1].totalUnifiedEntries : 0,
      stepsRemoved: log.length - step,
      nextRecommended: nextSlug,
    };
  }

  async resetSteps() {
    const unifiedPath = path.resolve(process.cwd(), UNIFIED_FILE);
    try {
      await fs.unlink(unifiedPath);
    } catch {
      /* нет файла */
    }

    const unifiedDir = path.resolve(process.cwd(), UNIFIED_DIR);
    try {
      await fs.rm(unifiedDir, { recursive: true });
    } catch {
      /* нет папки */
    }

    return { reset: true, message: "unified.json, снэпшоты и лог удалены" };
  }

  // --- Private helpers ---

  private async readMergeLog(): Promise<MergeLogEntry[]> {
    const logPath = path.resolve(process.cwd(), MERGE_LOG_FILE);
    try {
      const raw = await fs.readFile(logPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  private async writeMergeLog(log: MergeLogEntry[]): Promise<void> {
    const logPath = path.resolve(process.cwd(), MERGE_LOG_FILE);
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, JSON.stringify(log, null, 2), "utf-8");
  }

  private async loadUnifiedMap(): Promise<{
    merged: Map<string, { entry: ParsedEntry; sources: Set<string> }>;
    existingSources: Set<string>;
  }> {
    const merged = new Map<
      string,
      { entry: ParsedEntry; sources: Set<string> }
    >();
    const existingSources = new Set<string>();
    const outPath = path.resolve(process.cwd(), UNIFIED_FILE);

    try {
      const raw = await fs.readFile(outPath, "utf-8");
      const entries: (ParsedEntry & { sources: string[] })[] = JSON.parse(raw);

      for (const entry of entries) {
        const key = entryKey(entry);
        if (!key) continue;
        const sources = new Set(entry.sources ?? []);
        sources.forEach((s) => existingSources.add(s));
        const { sources: _, ...rest } = entry;
        merged.set(key, { entry: rest, sources });
      }
    } catch {
      // файла нет — начинаем с пустого
    }

    return { merged, existingSources };
  }

  private async saveUnifiedMap(
    merged: Map<string, { entry: ParsedEntry; sources: Set<string> }>,
  ) {
    const unified = [...merged.entries()]
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB, "ru"))
      .map(([, { entry, sources }]) => ({
        ...entry,
        sources: [...sources],
      }));
    const outPath = path.resolve(process.cwd(), UNIFIED_FILE);
    await fs.writeFile(outPath, JSON.stringify(unified, null, 2), "utf-8");
  }
}
