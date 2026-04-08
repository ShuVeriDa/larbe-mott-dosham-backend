import type { ParsedEntry, RawDictEntry } from "./types";
import { cleanText, stripHtml } from "./utils";

/**
 * Парсер для ручного сборника (collected.json).
 *
 * Формат записей — упрощённый, контролируемый автором:
 *   word: чеченское слово
 *   translate: русский перевод (основной)
 *
 * Поддерживает также расширенный формат (поля ParsedEntry напрямую),
 * если запись содержит поле `meanings` — она передаётся как есть.
 */
export function parseCollectedEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const results: ParsedEntry[] = [];

  for (const raw of raws) {
    // Расширенный формат: если запись уже содержит meanings — передаём как есть
    if ("meanings" in raw && Array.isArray((raw as any).meanings)) {
      const entry = raw as unknown as ParsedEntry;
      if (entry.word?.trim() && entry.meanings?.length) {
        results.push(entry);
      }
      continue;
    }

    // Простой формат: word + translate
    const word = stripHtml(cleanText(raw.word?.trim() ?? ""));
    const translate = stripHtml(cleanText(raw.translate?.trim() ?? ""));

    if (!word || !translate) continue;

    results.push({
      word,
      meanings: [{ translation: translate }],
    });
  }

  return results;
}
