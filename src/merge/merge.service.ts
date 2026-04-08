import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PrismaService } from "src/prisma.service";
import { ParsePipelineService } from "./parse-pipeline.service";
import { UnifyPipelineService } from "./unify-pipeline.service";
import { LoadPipelineService } from "./load-pipeline.service";

const PARSED_DIR = "dictionaries/parsed";
const UNIFIED_FILE = "dictionaries/unified.json";

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly parsePipeline: ParsePipelineService,
    private readonly unifyPipeline: UnifyPipelineService,
    private readonly loadPipeline: LoadPipelineService,
  ) {}

  // --- Parse ---
  parseOne(slug: string) {
    return this.parsePipeline.parseOne(slug);
  }
  parseAll() {
    return this.parsePipeline.parseAll();
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
    return this.unifyPipeline.unifyStep(slug);
  }
  getUnifiedLog() {
    return this.unifyPipeline.getUnifiedLog();
  }
  rollback(step: number) {
    return this.unifyPipeline.rollback(step);
  }
  resetSteps() {
    return this.unifyPipeline.resetSteps();
  }

  // --- Load ---
  load() {
    return this.loadPipeline.load();
  }
  improve() {
    return this.loadPipeline.improve();
  }

  // --- Status ---
  async status() {
    const parsedDir = path.resolve(process.cwd(), PARSED_DIR);
    let parsedFiles: { slug: string; entries: number }[] = [];
    try {
      const files = (await fs.readdir(parsedDir)).filter((f) =>
        f.endsWith(".json"),
      );
      for (const f of files) {
        const content = await fs.readFile(path.join(parsedDir, f), "utf-8");
        const arr = JSON.parse(content);
        parsedFiles.push({
          slug: f.replace(/\.json$/, ""),
          entries: arr.length,
        });
      }
    } catch {
      // папки нет — ок
    }

    let unifiedCount = 0;
    try {
      const raw = await fs.readFile(
        path.resolve(process.cwd(), UNIFIED_FILE),
        "utf-8",
      );
      unifiedCount = JSON.parse(raw).length;
    } catch {
      // файла нет — ок
    }

    const dbCount = await this.prisma.unifiedEntry.count();

    return {
      parsed: {
        files: parsedFiles,
        total: parsedFiles.reduce((s, f) => s + f.entries, 0),
      },
      unified: {
        entries: unifiedCount,
        file: unifiedCount > 0 ? UNIFIED_FILE : null,
      },
      database: { entries: dbCount },
    };
  }
}
