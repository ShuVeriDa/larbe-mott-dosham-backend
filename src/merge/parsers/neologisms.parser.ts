import type { ParsedEntry, RawDictEntry } from "./types";
import { cleanText, stripHtml } from "./utils";

/**
 * Парсер для неологизмов (neologisms.json).
 *
 * Формат идентичен collected.parser, но все записи автоматически
 * получают styleLabel "Неол." если он не задан.
 *
 * Поддерживает простой (word + translate) и расширенный (ParsedEntry) формат.
 */
export function parseNeologismEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const results: ParsedEntry[] = [];

  for (const raw of raws) {
    // Расширенный формат
    if ("meanings" in raw && Array.isArray((raw as any).meanings)) {
      const entry = raw as unknown as ParsedEntry;
      if (entry.word?.trim() && entry.meanings?.length) {
        if (!entry.styleLabel) entry.styleLabel = "Неол.";
        results.push(entry);
      }
      continue;
    }

    // Простой формат
    const word = stripHtml(cleanText(raw.word?.trim() ?? ""));
    const translate = stripHtml(cleanText(raw.translate?.trim() ?? ""));

    if (!word || !translate) continue;

    results.push({
      word,
      meanings: [{ translation: translate }],
      styleLabel: "Неол.",
    });
  }

  return results;
}
