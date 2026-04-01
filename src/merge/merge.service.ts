import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { normalizeWord } from "src/common/utils/normalize_util";
import { PrismaService } from "src/prisma.service";
import {
  DICTIONARIES,
  type DictionaryMeta,
} from "src/import/dictionaries";
import {
  getParser,
  type ParsedEntry,
  type GrammarInfo,
  type Meaning,
  type Phrase,
  type Citation,
} from "./parsers";
import { deduplicateAndSort } from "./parsers/original.parser";

/** Папка для распарсенных JSON */
const PARSED_DIR = "dictionaries/parsed";
/** Итоговый единый файл */
const UNIFIED_FILE = "dictionaries/unified.json";
/** Папка для версионных снэпшотов */
const UNIFIED_DIR = "dictionaries/unified";
/** Лог слияния */
const MERGE_LOG_FILE = "dictionaries/unified/merge_log.json";

const CHUNK = 500;

/** Рекомендуемый порядок слияния: сначала общие → потом специализированные */
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

@Injectable()
export class MergeService {
  private readonly logger = new Logger(MergeService.name);

  constructor(private prisma: PrismaService) {}

  // -----------------------------------------------------------------------
  // Этап 1: Парсинг одного словаря → dictionaries/parsed/{slug}.json
  // -----------------------------------------------------------------------
  async parseOne(slug: string) {
    const meta = DICTIONARIES.find((d) => d.slug === slug);
    if (!meta) throw new BadRequestException(`Словарь "${slug}" не найден`);

    const result = await this.parseDictionary(meta);
    const outPath = this.resolvedParsedPath(slug);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(result.entries, null, 2), "utf-8");

    this.logger.log(`${slug}: ${result.sourceCount} → ${result.parsedCount} → ${outPath}`);

    return {
      slug: meta.slug,
      title: meta.title,
      sourceCount: result.sourceCount,
      parsedCount: result.parsedCount,
      outputFile: `${PARSED_DIR}/${slug}.json`,
    };
  }

  // -----------------------------------------------------------------------
  // Этап 1б: Парсинг всех словарей → отдельные JSON
  // -----------------------------------------------------------------------
  async parseAll() {
    const results: Awaited<ReturnType<MergeService["parseOne"]>>[] = [];
    for (const meta of DICTIONARIES) {
      results.push(await this.parseOne(meta.slug));
    }
    return { dictionaries: results };
  }

  // -----------------------------------------------------------------------
  // Очистка оригинальных словарей: дедупликация + сортировка по id
  // -----------------------------------------------------------------------
  async cleanOriginal(slug: string) {
    const meta = DICTIONARIES.find((d) => d.slug === slug);
    if (!meta) throw new BadRequestException(`Словарь "${slug}" не найден`);

    const absPath = path.resolve(process.cwd(), meta.file);
    const rawEntries = await this.readDictionaryJson(meta.file);
    const cleaned = deduplicateAndSort(rawEntries);

    await fs.writeFile(absPath, JSON.stringify(cleaned, null, 2), "utf-8");

    this.logger.log(`clean/${slug}: ${rawEntries.length} → ${cleaned.length} (удалено ${rawEntries.length - cleaned.length} дубликатов)`);

    return {
      slug: meta.slug,
      title: meta.title,
      sourceCount: rawEntries.length,
      cleanedCount: cleaned.length,
      removedDuplicates: rawEntries.length - cleaned.length,
      file: meta.file,
    };
  }

  async cleanAllOriginals() {
    const results: Awaited<ReturnType<MergeService["cleanOriginal"]>>[] = [];
    for (const meta of DICTIONARIES) {
      results.push(await this.cleanOriginal(meta.slug));
    }
    return { dictionaries: results };
  }

  // -----------------------------------------------------------------------
  // Этап 2а: Добавить один словарь в unified.json
  // Читает существующий unified.json (или создаёт пустой), мержит в него.
  // -----------------------------------------------------------------------
  async unifyOne(slug: string) {
    // Проверяем что parsed файл есть
    const parsedPath = this.resolvedParsedPath(slug);
    let raw: string;
    try {
      raw = await fs.readFile(parsedPath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Файл ${PARSED_DIR}/${slug}.json не найден. Сначала вызовите POST /api/merge/parse/${slug}`,
      );
    }
    const newEntries: ParsedEntry[] = JSON.parse(raw);

    // Загружаем существующий unified.json (или пустой массив)
    const { merged, existingSources } = await this.loadUnifiedMap();

    // Проверяем не был ли уже добавлен
    if (existingSources.has(slug)) {
      throw new BadRequestException(
        `Словарь "${slug}" уже в unified.json. Для пересборки используйте POST /api/merge/reset и добавьте заново`,
      );
    }

    // Мержим
    let added = 0;
    let enriched = 0;
    for (const entry of newEntries) {
      const key = normalizeWord(entry.word);
      if (!key) continue;

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

    // Сохраняем
    await this.saveUnifiedMap(merged);

    const totalEntries = merged.size;
    this.logger.log(
      `unify/${slug}: +${added} новых, ${enriched} обогащено → итого ${totalEntries}`,
    );

    return {
      slug,
      entriesFromDict: newEntries.length,
      newWords: added,
      enrichedWords: enriched,
      totalUnifiedEntries: totalEntries,
      outputFile: UNIFIED_FILE,
    };
  }

  // -----------------------------------------------------------------------
  // Этап 2б: Объединить все распарсенные JSON сразу → unified.json
  // -----------------------------------------------------------------------
  async unifyAll() {
    const parsedDir = path.resolve(process.cwd(), PARSED_DIR);

    let files: string[];
    try {
      files = (await fs.readdir(parsedDir)).filter((f) => f.endsWith(".json"));
    } catch {
      throw new BadRequestException(
        `Папка ${PARSED_DIR} не найдена. Сначала вызовите POST /api/merge/parse-all`,
      );
    }
    if (files.length === 0) {
      throw new BadRequestException(`В ${PARSED_DIR} нет JSON файлов`);
    }

    const merged = new Map<string, { entry: ParsedEntry; sources: Set<string> }>();
    let totalParsed = 0;

    for (const file of files) {
      const slug = file.replace(/\.json$/, "");
      const raw = await fs.readFile(path.join(parsedDir, file), "utf-8");
      const entries: ParsedEntry[] = JSON.parse(raw);
      totalParsed += entries.length;

      for (const entry of entries) {
        const key = normalizeWord(entry.word);
        if (!key) continue;

        const existing = merged.get(key);
        if (existing) {
          mergeInto(existing.entry, entry);
          existing.sources.add(slug);
        } else {
          merged.set(key, { entry, sources: new Set([slug]) });
        }
      }
      this.logger.log(`  unify-all: ${slug} — ${entries.length} записей`);
    }

    await this.saveUnifiedMap(merged);

    this.logger.log(`Unified all: ${totalParsed} → ${merged.size} уникальных`);

    return {
      parsedFiles: files.length,
      totalParsedEntries: totalParsed,
      unifiedEntries: merged.size,
      outputFile: UNIFIED_FILE,
    };
  }

  // -----------------------------------------------------------------------
  // Сброс unified.json (чтобы начать заново)
  // -----------------------------------------------------------------------
  async reset() {
    const outPath = path.resolve(process.cwd(), UNIFIED_FILE);
    try {
      await fs.unlink(outPath);
    } catch {
      // файла не было — ок
    }
    return { reset: true };
  }

  // -----------------------------------------------------------------------
  // Этап 2в: Пошаговое слияние с версионированием
  // -----------------------------------------------------------------------

  /** Добавить один словарь → сохранить снэпшот + лог */
  async unifyStep(slug: string) {
    const meta = DICTIONARIES.find((d) => d.slug === slug);
    if (!meta) throw new BadRequestException(`Словарь "${slug}" не найден`);

    // Читаем parsed файл
    const parsedPath = this.resolvedParsedPath(slug);
    let raw: string;
    try {
      raw = await fs.readFile(parsedPath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Файл ${PARSED_DIR}/${slug}.json не найден. Сначала вызовите POST /api/merge/parse/${slug}`,
      );
    }
    const newEntries: ParsedEntry[] = JSON.parse(raw);

    // Загружаем текущий unified + лог
    const { merged, existingSources } = await this.loadUnifiedMap();
    const log = await this.readMergeLog();

    // Проверяем не был ли уже добавлен
    if (existingSources.has(slug)) {
      throw new BadRequestException(
        `Словарь "${slug}" уже добавлен (шаг ${log.find((e) => e.slug === slug)?.step}). Для пересборки используйте DELETE /api/merge/reset-steps`,
      );
    }

    // Мержим
    let added = 0;
    let enriched = 0;
    for (const entry of newEntries) {
      const key = normalizeWord(entry.word);
      if (!key) continue;

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

    // Сохраняем unified.json
    await this.saveUnifiedMap(merged);

    // Сохраняем снэпшот
    const step = log.length + 1;
    const stepStr = String(step).padStart(2, "0");
    const snapshotFile = `${UNIFIED_DIR}/step_${stepStr}_${slug}.json`;
    const snapshotPath = path.resolve(process.cwd(), snapshotFile);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.copyFile(
      path.resolve(process.cwd(), UNIFIED_FILE),
      snapshotPath,
    );

    // Пишем лог
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

    // Следующий рекомендуемый словарь
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

  /** Посмотреть лог слияния */
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

  /** Откатиться к указанному шагу (восстановить снэпшот) */
  async rollback(step: number) {
    const log = await this.readMergeLog();

    if (step < 0 || step > log.length) {
      throw new BadRequestException(
        `Шаг ${step} не существует. Доступны: 0 (пустой) .. ${log.length}`,
      );
    }

    const unifiedPath = path.resolve(process.cwd(), UNIFIED_FILE);

    if (step === 0) {
      // Откат до начала — пустой unified
      try { await fs.unlink(unifiedPath); } catch { /* нет файла */ }
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

    // Обрезаем лог до указанного шага
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

  /** Полный сброс: unified.json + снэпшоты + лог */
  async resetSteps() {
    // Удаляем unified.json
    const unifiedPath = path.resolve(process.cwd(), UNIFIED_FILE);
    try { await fs.unlink(unifiedPath); } catch { /* нет файла */ }

    // Удаляем папку со снэпшотами
    const unifiedDir = path.resolve(process.cwd(), UNIFIED_DIR);
    try {
      await fs.rm(unifiedDir, { recursive: true });
    } catch { /* нет папки */ }

    return { reset: true, message: "unified.json, снэпшоты и лог удалены" };
  }

  // -----------------------------------------------------------------------
  // Этап 3: Загрузка unified.json → БД (UnifiedEntry)
  // -----------------------------------------------------------------------
  async load() {
    const filePath = path.resolve(process.cwd(), UNIFIED_FILE);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Файл ${UNIFIED_FILE} не найден. Сначала вызовите POST /api/merge/unify`,
      );
    }

    const unified: (ParsedEntry & { sources: string[] })[] = JSON.parse(raw);

    await this.prisma.unifiedEntry.deleteMany();

    const dbEntries = unified.map((e) => ({
      word: e.word,
      wordAccented: e.wordAccented ?? null,
      wordNormalized: normalizeWord(e.word),
      partOfSpeech: e.partOfSpeech ?? null,
      partOfSpeechNah: e.partOfSpeechNah ?? null,
      nounClass: e.nounClass ?? null,
      nounClassPlural: e.nounClassPlural ?? null,
      grammar: e.grammar ? JSON.parse(JSON.stringify(e.grammar)) : undefined,
      meanings: JSON.parse(JSON.stringify(e.meanings)),
      phraseology: e.phraseology ? JSON.parse(JSON.stringify(e.phraseology)) : undefined,
      citations: e.citations ? JSON.parse(JSON.stringify(e.citations)) : undefined,
      latinName: e.latinName ?? null,
      styleLabel: e.styleLabel ?? null,
      domain: e.domain ?? null,
      cefrLevel: estimateCefr(e),
      sources: e.sources,
    }));

    let saved = 0;
    for (let i = 0; i < dbEntries.length; i += CHUNK) {
      const chunk = dbEntries.slice(i, i + CHUNK);
      await this.prisma.unifiedEntry.createMany({ data: chunk });
      saved += chunk.length;
    }

    this.logger.log(`Загружено в БД: ${saved} записей`);
    return { loaded: saved };
  }

  // -----------------------------------------------------------------------
  // Статус: что есть на каждом этапе
  // -----------------------------------------------------------------------
  async status() {
    const parsedDir = path.resolve(process.cwd(), PARSED_DIR);
    let parsedFiles: { slug: string; entries: number }[] = [];
    try {
      const files = (await fs.readdir(parsedDir)).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const content = await fs.readFile(path.join(parsedDir, f), "utf-8");
        const arr = JSON.parse(content);
        parsedFiles.push({ slug: f.replace(/\.json$/, ""), entries: arr.length });
      }
    } catch {
      // папки нет — ок
    }

    let unifiedCount = 0;
    try {
      const raw = await fs.readFile(path.resolve(process.cwd(), UNIFIED_FILE), "utf-8");
      unifiedCount = JSON.parse(raw).length;
    } catch {
      // файла нет — ок
    }

    const dbCount = await this.prisma.unifiedEntry.count();

    return {
      parsed: { files: parsedFiles, total: parsedFiles.reduce((s, f) => s + f.entries, 0) },
      unified: { entries: unifiedCount, file: unifiedCount > 0 ? UNIFIED_FILE : null },
      database: { entries: dbCount },
    };
  }

  // -----------------------------------------------------------------------
  // Превью: показать первые N записей из распарсенного файла
  // -----------------------------------------------------------------------
  async preview(slug: string, limit = 5) {
    const filePath = this.resolvedParsedPath(slug);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Файл ${PARSED_DIR}/${slug}.json не найден. Сначала вызовите POST /api/merge/parse/${slug}`,
      );
    }
    const entries: ParsedEntry[] = JSON.parse(raw);
    return {
      slug,
      total: entries.length,
      sample: entries.slice(0, limit),
    };
  }

  // -----------------------------------------------------------------------
  // Внутренние методы
  // -----------------------------------------------------------------------

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

  private async parseDictionary(meta: DictionaryMeta) {
    const rawEntries = await this.readDictionaryJson(meta.file);
    const parser = getParser(meta.slug);
    const entries = parser(rawEntries);
    return { entries, sourceCount: rawEntries.length, parsedCount: entries.length };
  }

  /** Загружает unified.json в Map (или пустой Map если файла нет) */
  private async loadUnifiedMap(): Promise<{
    merged: Map<string, { entry: ParsedEntry; sources: Set<string> }>;
    existingSources: Set<string>;
  }> {
    const merged = new Map<string, { entry: ParsedEntry; sources: Set<string> }>();
    const existingSources = new Set<string>();
    const outPath = path.resolve(process.cwd(), UNIFIED_FILE);

    try {
      const raw = await fs.readFile(outPath, "utf-8");
      const entries: (ParsedEntry & { sources: string[] })[] = JSON.parse(raw);

      for (const entry of entries) {
        const key = normalizeWord(entry.word);
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

  /** Сохраняет Map в unified.json */
  private async saveUnifiedMap(
    merged: Map<string, { entry: ParsedEntry; sources: Set<string> }>,
  ) {
    const unified = [...merged.values()].map(({ entry, sources }) => ({
      ...entry,
      sources: [...sources],
    }));
    const outPath = path.resolve(process.cwd(), UNIFIED_FILE);
    await fs.writeFile(outPath, JSON.stringify(unified, null, 2), "utf-8");
  }

  private async readDictionaryJson(file: string): Promise<any[]> {
    const absPath = path.resolve(process.cwd(), file);
    const raw = await fs.readFile(absPath, "utf-8");
    const json = JSON.parse(raw);
    return Array.isArray(json) ? json : json.entries ?? [];
  }

  private resolvedParsedPath(slug: string): string {
    return path.resolve(process.cwd(), PARSED_DIR, `${slug}.json`);
  }
}

// ---------------------------------------------------------------------------
// Логика слияния двух записей одного слова
// ---------------------------------------------------------------------------
function mergeInto(target: ParsedEntry, source: ParsedEntry): void {
  if (!target.wordAccented && source.wordAccented) {
    target.wordAccented = source.wordAccented;
  }
  if (!target.partOfSpeech && source.partOfSpeech) {
    target.partOfSpeech = source.partOfSpeech;
  }
  if (!target.partOfSpeechNah && source.partOfSpeechNah) {
    target.partOfSpeechNah = source.partOfSpeechNah;
  }
  if (!target.nounClass && source.nounClass) {
    target.nounClass = source.nounClass;
  }
  if (!target.nounClassPlural && source.nounClassPlural) {
    target.nounClassPlural = source.nounClassPlural;
  }
  if (source.grammar) {
    if (!target.grammar) {
      target.grammar = source.grammar;
    } else {
      mergeGrammar(target.grammar, source.grammar);
    }
  }
  mergeMeanings(target.meanings, source.meanings);
  if (source.phraseology?.length) {
    if (!target.phraseology) {
      target.phraseology = [...source.phraseology];
    } else {
      mergePhrases(target.phraseology, source.phraseology);
    }
  }
  if (source.citations?.length) {
    if (!target.citations) {
      target.citations = [...source.citations];
    } else {
      mergeCitations(target.citations, source.citations);
    }
  }
  if (!target.latinName && source.latinName) {
    target.latinName = source.latinName;
  }
  if (!target.styleLabel && source.styleLabel) {
    target.styleLabel = source.styleLabel;
  }
  if (!target.domain && source.domain) {
    target.domain = source.domain;
  }
}

function mergeGrammar(target: GrammarInfo, source: GrammarInfo): void {
  for (const key of Object.keys(source) as (keyof GrammarInfo)[]) {
    if (!target[key] && source[key]) {
      (target as any)[key] = source[key];
    }
  }
}

function mergeMeanings(target: Meaning[], source: Meaning[]): void {
  const existing = new Set(target.map((m) => m.translation.toLowerCase().trim()));
  for (const sm of source) {
    const key = sm.translation.toLowerCase().trim();
    if (!key) continue;
    if (existing.has(key)) {
      const match = target.find((m) => m.translation.toLowerCase().trim() === key);
      if (match && sm.examples?.length) {
        if (!match.examples) {
          match.examples = [...sm.examples];
        } else {
          mergePhrases(match.examples, sm.examples);
        }
      }
    } else {
      target.push(sm);
      existing.add(key);
    }
  }
}

function mergePhrases(target: Phrase[], source: Phrase[]): void {
  const existing = new Set(target.map((p) => p.nah.toLowerCase()));
  for (const sp of source) {
    if (!existing.has(sp.nah.toLowerCase())) {
      target.push(sp);
      existing.add(sp.nah.toLowerCase());
    }
  }
}

function mergeCitations(target: Citation[], source: Citation[]): void {
  const existing = new Set(target.map((c) => c.text.toLowerCase().substring(0, 50)));
  for (const sc of source) {
    const key = sc.text.toLowerCase().substring(0, 50);
    if (!existing.has(key)) {
      target.push(sc);
      existing.add(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Оценка уровня CEFR (A1–C2)
// ---------------------------------------------------------------------------

/** Домены, указывающие на высокий уровень сложности */
const SPECIALIZED_DOMAINS: Record<string, "B2" | "C1"> = {
  sport: "B2",
  computer: "B2",
  law: "C1",
  math: "C1",
  anatomy: "C1",
  geology: "C1",
};

/** Стилевые пометы → базовый уровень */
const STYLE_CEFR: Record<string, string> = {
  // Простые / разговорные → низкий уровень
  "Прост.": "A2",
  "Разг.": "A2",
  // Книжные / формальные → средний
  "Книжн.": "B2",
  "Религ.": "B2",
  "Диал.": "B2",
  "Ирон.": "B2",
  "Жарг.": "B1",
  "Шутл.-ирон.": "B2",
  "Шутл-ирон.": "B2",
  "Бран.": "B1",
  "Груб.": "B1",
  "Презр.": "B2",
  "Пренебр.": "B2",
  // Архаичные / поэтические → высокий
  "Устар.": "C1",
  "Уст.": "C1",
  "Старин.": "C2",
  "Поэт.": "C2",
};

/** Части речи повышенной сложности */
const COMPLEX_POS = new Set(["прич.", "дееприч.", "масд."]);

const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

function cefrMax(a: string, b: string): string {
  const ia = CEFR_ORDER.indexOf(a as (typeof CEFR_ORDER)[number]);
  const ib = CEFR_ORDER.indexOf(b as (typeof CEFR_ORDER)[number]);
  return ia >= ib ? a : b;
}

/**
 * Оценка уровня CEFR на основе косвенных сигналов.
 *
 * Факторы (от самого весомого):
 *   1. sources.length — сколько словарей содержат слово (прокси частотности)
 *   2. domain — специализированная область = высокий уровень
 *   3. styleLabel — стилевая помета
 *   4. partOfSpeech — морфологическая сложность
 */
function estimateCefr(entry: ParsedEntry & { sources: string[] }): string {
  const srcCount = entry.sources.length;

  // 1. Базовый уровень по количеству источников (основной фактор)
  let level: string;
  if (srcCount >= 6) {
    level = "A1";
  } else if (srcCount >= 4) {
    level = "A2";
  } else if (srcCount >= 2) {
    level = "B1";
  } else {
    level = "B2";
  }

  // 2. Домен может повысить уровень
  if (entry.domain && entry.domain in SPECIALIZED_DOMAINS) {
    level = cefrMax(level, SPECIALIZED_DOMAINS[entry.domain]);
  }

  // 3. Стилевая помета может повысить уровень
  if (entry.styleLabel && entry.styleLabel in STYLE_CEFR) {
    level = cefrMax(level, STYLE_CEFR[entry.styleLabel]);
  }

  // 4. Сложные части речи (причастия, деепричастия) → минимум B1
  if (entry.partOfSpeech && COMPLEX_POS.has(entry.partOfSpeech)) {
    level = cefrMax(level, "B1");
  }

  return level;
}
