import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PrismaService } from "src/prisma.service";
import { DICTIONARIES } from "src/import/dictionaries";
import { ParsePipelineService } from "./parse-pipeline.service";
import { UnifyPipelineService } from "./unify-pipeline.service";
import { LoadPipelineService } from "./load-pipeline.service";

const PARSED_DIR = "dictionaries/parsed";
const UNIFIED_FILE = "dictionaries/unified.json";
const MERGE_LOG_FILE = "dictionaries/unified/merge_log.json";
const PIPELINE_LOG_MAX = 100;

/**
 * MergeService — оркестратор ETL-пайплайна.
 * Делегирует работу трём специализированным сервисам:
 *   - ParsePipelineService  — парсинг и очистка словарей
 *   - UnifyPipelineService  — слияние, rollback, reset
 *   - LoadPipelineService   — загрузка в БД, improve
 */
@Injectable()
export class MergeService {
  private readonly logger = new Logger(MergeService.name);

  // In-memory состояние выполнения пайплайна
  private _isRunning = false;
  private _currentOperation: string | null = null;
  private _lastRun: { operation: string; timestamp: string; durationSeconds: number } | null = null;

  // In-memory лог последних операций пайплайна
  private _log: Array<{
    timestamp: string;
    level: "info" | "ok" | "warn" | "error";
    operation: string;
    message: string;
    durationSeconds?: number;
  }> = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly parsePipeline: ParsePipelineService,
    private readonly unifyPipeline: UnifyPipelineService,
    private readonly loadPipeline: LoadPipelineService,
  ) {}

  // --- Pipeline state helpers ---

  get isRunning() {
    return this._isRunning;
  }

  private pushLog(
    level: "info" | "ok" | "warn" | "error",
    operation: string,
    message: string,
    durationSeconds?: number,
  ) {
    this._log.unshift({ timestamp: new Date().toISOString(), level, operation, message, durationSeconds });
    if (this._log.length > PIPELINE_LOG_MAX) this._log.length = PIPELINE_LOG_MAX;
  }

  private async runOp<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    if (this._isRunning) {
      throw new BadRequestException(
        `Пайплайн занят: выполняется "${this._currentOperation}". Дождитесь завершения.`,
      );
    }
    this._isRunning = true;
    this._currentOperation = operation;
    const start = Date.now();
    this.pushLog("info", operation, `Начато: ${operation}`);
    try {
      const result = await fn();
      const durationSeconds = Number(((Date.now() - start) / 1000).toFixed(2));
      this._lastRun = { operation, timestamp: new Date().toISOString(), durationSeconds };
      this.pushLog("ok", operation, `Завершено: ${operation}`, durationSeconds);
      return result;
    } catch (err) {
      const durationSeconds = Number(((Date.now() - start) / 1000).toFixed(2));
      this._lastRun = { operation, timestamp: new Date().toISOString(), durationSeconds };
      const message = err instanceof Error ? err.message : String(err);
      this.pushLog("error", operation, `Ошибка: ${operation} — ${message}`, durationSeconds);
      throw err;
    } finally {
      this._isRunning = false;
      this._currentOperation = null;
    }
  }

  getPipelineLog() {
    return this._log;
  }

  clearPipelineLog() {
    this._log = [];
    return { cleared: true };
  }

  // --- Parse ---
  parseOne(slug: string) {
    return this.runOp(`parse:${slug}`, () => this.parsePipeline.parseOne(slug));
  }
  parseAll() {
    return this.runOp("parse:all", () => this.parsePipeline.parseAll());
  }
  cleanOriginal(slug: string) {
    return this.parsePipeline.cleanOriginal(slug);
  }
  cleanAllOriginals() {
    return this.parsePipeline.cleanAllOriginals();
  }
  preview(slug: string, limit?: number) {
    return this.parsePipeline.preview(slug, limit);
  }

  // --- Unify ---
  unifyStep(slug: string) {
    return this.runOp(`unify-step:${slug}`, () => this.unifyPipeline.unifyStep(slug));
  }
  getUnifiedLog() {
    return this.unifyPipeline.getUnifiedLog();
  }
  rollback(step: number) {
    return this.runOp(`rollback:${step}`, () => this.unifyPipeline.rollback(step));
  }
  resetSteps() {
    return this.runOp("reset", () => this.unifyPipeline.resetSteps());
  }

  // --- Load ---
  load() {
    return this.runOp("load", () => this.loadPipeline.load());
  }
  improve() {
    return this.runOp("improve", () => this.loadPipeline.improve());
  }

  // --- Parsed files list ---
  async parsedFiles() {
    const parsedDir = path.resolve(process.cwd(), PARSED_DIR);
    try {
      const files = (await fs.readdir(parsedDir)).filter((f) => f.endsWith(".json"));
      const items = await Promise.all(
        files.map(async (filename) => {
          const stat = await fs.stat(path.join(parsedDir, filename));
          return {
            slug: filename.replace(/\.json$/, ""),
            filename,
            sizeMb: Number((stat.size / 1024 / 1024).toFixed(2)),
            updatedAt: stat.mtime.toISOString(),
          };
        }),
      );
      items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return { dir: PARSED_DIR + "/", count: items.length, files: items };
    } catch {
      return { dir: PARSED_DIR + "/", count: 0, files: [] };
    }
  }

  // --- Status ---
  async status() {
    const parsedDir = path.resolve(process.cwd(), PARSED_DIR);
    const bySlug: Record<string, { count: number }> = {};

    try {
      const files = (await fs.readdir(parsedDir)).filter((f) => f.endsWith(".json"));
      await Promise.all(
        files.map(async (f) => {
          const content = await fs.readFile(path.join(parsedDir, f), "utf-8");
          const arr = JSON.parse(content) as unknown[];
          bySlug[f.replace(/\.json$/, "")] = { count: arr.length };
        }),
      );
    } catch {
      // папки нет — ок
    }

    // Читаем merge_log чтобы определить статус каждого словаря
    const mergedSlugs = new Set<string>();
    try {
      const logRaw = await fs.readFile(path.resolve(process.cwd(), MERGE_LOG_FILE), "utf-8");
      const log = JSON.parse(logRaw) as Array<{ slug: string }>;
      log.forEach((e) => mergedSlugs.add(e.slug));
    } catch {
      // лога нет — ок
    }

    // Строим per-slug статус для всех известных словарей
    const dictionaries = DICTIONARIES.map((d) => {
      const parsedData = bySlug[d.slug];
      let status: "pending" | "parsed" | "merged" = "pending";
      if (mergedSlugs.has(d.slug)) status = "merged";
      else if (parsedData) status = "parsed";

      return {
        slug: d.slug,
        title: d.title,
        direction: d.direction,
        count: parsedData?.count ?? null,
        status,
      };
    });

    let unifiedCount = 0;
    let unifiedFileSizeMb: number | null = null;
    let unifiedUpdatedAt: string | null = null;
    try {
      const unifiedPath = path.resolve(process.cwd(), UNIFIED_FILE);
      const [raw, stat] = await Promise.all([
        fs.readFile(unifiedPath, "utf-8"),
        fs.stat(unifiedPath),
      ]);
      unifiedCount = (JSON.parse(raw) as unknown[]).length;
      unifiedFileSizeMb = Number((stat.size / 1024 / 1024).toFixed(1));
      unifiedUpdatedAt = stat.mtime.toISOString();
    } catch {
      // файла нет — ок
    }

    const dbCount = await this.prisma.unifiedEntry.count();

    return {
      isRunning: this._isRunning,
      currentOperation: this._currentOperation,
      lastRun: this._lastRun,
      parsed: {
        files: dictionaries.filter((d) => d.status !== "pending").length,
        total: Object.values(bySlug).reduce((s, d) => s + d.count, 0),
        bySlug: dictionaries,
      },
      unified: {
        entries: unifiedCount,
        file: unifiedCount > 0 ? UNIFIED_FILE : null,
        fileSizeMb: unifiedFileSizeMb,
        updatedAt: unifiedUpdatedAt,
      },
      database: { entries: dbCount },
    };
  }
}
