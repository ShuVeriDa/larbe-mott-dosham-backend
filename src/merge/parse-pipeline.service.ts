import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { DICTIONARIES, type DictionaryMeta } from "src/import/dictionaries";
import { getParser, type ParsedEntry } from "./parsers";
import { deduplicateAndSort } from "./parsers/original.parser";

const PARSED_DIR = "dictionaries/parsed";

@Injectable()
export class ParsePipelineService {
  private readonly logger = new Logger(ParsePipelineService.name);

  async parseOne(slug: string) {
    const meta = DICTIONARIES.find((d) => d.slug === slug);
    if (!meta) throw new BadRequestException(`Словарь "${slug}" не найден`);

    const result = await this.parseDictionary(meta);
    const outPath = this.resolvedParsedPath(slug);

    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(
      outPath,
      JSON.stringify(result.entries, null, 2),
      "utf-8",
    );

    this.logger.log(
      `${slug}: ${result.sourceCount} → ${result.parsedCount} → ${outPath}`,
    );

    return {
      slug: meta.slug,
      title: meta.title,
      sourceCount: result.sourceCount,
      parsedCount: result.parsedCount,
      outputFile: `${PARSED_DIR}/${slug}.json`,
    };
  }

  async parseAll() {
    const results: Awaited<ReturnType<ParsePipelineService["parseOne"]>>[] = [];
    for (const meta of DICTIONARIES) {
      results.push(await this.parseOne(meta.slug));
    }
    return { dictionaries: results };
  }

  async cleanOriginal(slug: string) {
    const meta = DICTIONARIES.find((d) => d.slug === slug);
    if (!meta) throw new BadRequestException(`Словарь "${slug}" не найден`);

    const absPath = path.resolve(process.cwd(), meta.file);
    const rawEntries = await this.readDictionaryJson(meta.file);
    const cleaned = deduplicateAndSort(rawEntries);

    await fs.writeFile(absPath, JSON.stringify(cleaned, null, 2), "utf-8");

    this.logger.log(
      `clean/${slug}: ${rawEntries.length} → ${cleaned.length} (удалено ${rawEntries.length - cleaned.length} дубликатов)`,
    );

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
    const results: Awaited<
      ReturnType<ParsePipelineService["cleanOriginal"]>
    >[] = [];
    for (const meta of DICTIONARIES) {
      results.push(await this.cleanOriginal(meta.slug));
    }
    return { dictionaries: results };
  }

  async preview(slug: string, limit = 5) {
    const filePath = this.resolvedParsedPath(slug);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new BadRequestException(
        `Файл ${PARSED_DIR}/${slug}.json не найден. Сначала выполните: npm run pipeline -- parse ${slug}`,
      );
    }
    const entries: ParsedEntry[] = JSON.parse(raw);
    return { slug, total: entries.length, sample: entries.slice(0, limit) };
  }

  private async parseDictionary(meta: DictionaryMeta) {
    const rawEntries = await this.readDictionaryJson(meta.file);
    const parser = getParser(meta.slug);
    const entries = parser(rawEntries);
    return {
      entries,
      sourceCount: rawEntries.length,
      parsedCount: entries.length,
    };
  }

  private async readDictionaryJson(file: string): Promise<any[]> {
    const absPath = path.resolve(process.cwd(), file);
    const raw = await fs.readFile(absPath, "utf-8");
    const json = JSON.parse(raw);
    return Array.isArray(json) ? json : (json.entries ?? []);
  }

  resolvedParsedPath(slug: string): string {
    return path.resolve(process.cwd(), PARSED_DIR, `${slug}.json`);
  }
}
