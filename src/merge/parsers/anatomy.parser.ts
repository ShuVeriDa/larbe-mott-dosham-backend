import type { ParsedEntry, RawDictEntry } from "./types";
import { cleanText, dedup, stripHtml, stripStressMarks } from "./utils";

/**
 * Парсер для анатомических словарей:
 * - ce_ru_anatomy.json (чеченско-русский)
 * - ru_ce_anatomy.json (русско-чеченский)
 *
 * Формат translate:
 *   "Перевод (Latin.name)     <i>Описание на чеченском</i>\r\n"
 *
 * Между закрывающей `)` и `<i>` — 5 пробелов.
 * 100% записей содержат латинское название в скобках.
 * ~90% содержат описание в `<i>...</i>`.
 * Массивная дедупликация (записи утроены).
 */

/**
 * Парсит запись анатомического словаря.
 * @param word — термин на исходном языке (уже очищен)
 * @param translate — строка перевода
 * @returns ParsedEntry или null
 */
function parseAnatomyEntry(
  word: string,
  translate: string,
): Omit<ParsedEntry, "word"> | null {
  if (!translate) return null;

  let remaining = cleanText(translate);

  // Извлекаем латинское название: (Latin.name)
  let latinName: string | undefined;
  const latinMatch = remaining.match(/\(([^)]+)\)/);
  if (latinMatch) {
    latinName = latinMatch[1].trim();
    remaining = remaining.replace(/\([^)]+\)/, "").trim();
  }

  // Извлекаем описание: <i>...</i>
  let description: string | undefined;
  const descMatch = remaining.match(/<i>([^<]*)<\/i>/);
  if (descMatch) {
    description = descMatch[1].trim();
    remaining = remaining.replace(/<i>[^<]*<\/i>/, "").trim();
  }

  // Основной перевод — то, что осталось (без HTML)
  const translation = stripHtml(remaining).replace(/\s+/g, " ").trim();
  if (!translation) return null;

  // Собираем полный перевод с описанием
  const fullTranslation = description
    ? `${translation} — ${description}`
    : translation;

  return {
    latinName,
    meanings: [{ translation: fullTranslation }],
    domain: "anatomy",
  };
}

/** Парсит ce_ru_anatomy.json: word = чеченский термин, перевод = русский */
export function parseAnatomyCeRuEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const word = stripHtml(cleanText(raw.word)).trim();
    if (!word) continue;

    const translate = raw.translate?.trim();
    if (!translate) continue;

    const parsed = parseAnatomyEntry(word, translate);
    if (!parsed) continue;

    results.push({
      word: stripStressMarks(word),
      ...parsed,
    });
  }

  return results;
}

/** Парсит ru_ce_anatomy.json: word = русский термин, перевод = чеченский */
export function parseAnatomyRuCeEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const word = stripHtml(cleanText(raw.word)).trim();
    if (!word) continue;

    const translate = raw.translate?.trim();
    if (!translate) continue;

    const parsed = parseAnatomyEntry(word, translate);
    if (!parsed) continue;

    results.push({
      word: stripStressMarks(word),
      ...parsed,
    });
  }

  return results;
}
