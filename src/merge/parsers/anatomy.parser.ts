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

  // 1. Извлекаем описание: <i>...</i> → отдельное поле note
  let description: string | undefined;
  const descMatch = remaining.match(/<i>([^<]*)<\/i>/);
  if (descMatch) {
    description = descMatch[1].trim() || undefined;
    remaining = remaining.replace(/<i>[^<]*<\/i>/, "").trim();
  }

  // 2. Извлекаем латинское название: скобочная группа с латинскими буквами [a-zA-Z]
  //    Поддерживаем один уровень вложенных скобок: (Costa (VӀӀӀ – X))
  //    Берём последнюю подходящую группу — она всегда идёт после чеченских пояснений.
  let latinName: string | undefined;
  const parenRegex = /\(([^()]*(?:\([^()]*\))*[^()]*)\)/g;
  const allParens: { full: string; content: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = parenRegex.exec(remaining)) !== null) {
    allParens.push({ full: m[0], content: m[1] });
  }
  for (let i = allParens.length - 1; i >= 0; i--) {
    if (/[a-zA-Z]/.test(allParens[i].content)) {
      latinName = allParens[i].content.trim();
      remaining = remaining.replace(allParens[i].full, "").trim();
      break;
    }
  }

  // 3. Основной перевод — то, что осталось (без HTML)
  const translation = stripHtml(remaining).replace(/\s+/g, " ").trim();
  if (!translation) return null;

  return {
    latinName,
    meanings: [{ translation, note: description }],
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

    const wordClean = stripStressMarks(word);
    results.push({
      word: wordClean ? wordClean[0].toLowerCase() + wordClean.slice(1) : wordClean,
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

    const wordClean = stripStressMarks(word);
    results.push({
      word: wordClean ? wordClean[0].toLowerCase() + wordClean.slice(1) : wordClean,
      ...parsed,
    });
  }

  return results;
}
