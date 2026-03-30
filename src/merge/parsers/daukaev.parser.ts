import type { ParsedEntry, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для геологического словаря Даукаева (daukaev_ru_ce.json).
 * 5379 записей, ~1793 уникальных. Русско-чеченский.
 *
 * Формат word:
 *   Русский термин, иногда с аннотацией: <i>м-л</i>, <i>г.п.</i>, <i>(река)</i>
 *
 * Формат translate:
 *   ВСЕГДА начинается с " – ", затем чеченский перевод.
 *   Может содержать класс: <i>(ду/бу/йу/ву)</i> — уже в полной форме!
 *   Может содержать аннотации: <i>м-л (ю)</i>
 *
 * 3 пустые записи — пропускаем.
 */
export function parseDaukaevEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const wordRaw = raw.word?.trim();
    const translate = raw.translate?.trim();

    if (!wordRaw || !translate) continue;

    // Очищаем word от аннотаций: <i>м-л</i>, <i>г.п.</i>, <i>(река)</i>
    const word = stripHtml(cleanText(wordRaw))
      .replace(/\s+/g, " ")
      .trim();

    if (!word) continue;

    // Убираем начальное " – "
    let remaining = translate.replace(/^\s*–\s*/, "").trim();

    if (!remaining) continue;

    // Извлекаем класс из translate: <i>(ду)</i>, <i>(бу)</i>, <i>(йу)</i>, <i>(ву)</i>
    // Также формат: <i>м-л (ю)</i> — класс внутри аннотации
    let nounClass: string | undefined;

    // Полная форма класса в скобках: (ду), (бу), (йу), (ву)
    const fullClassMatch = remaining.match(
      /<i>[^<]*\((ду|бу|йу|ву)\)[^<]*<\/i>/,
    );
    if (fullClassMatch) {
      nounClass = fullClassMatch[1];
      remaining = remaining.replace(fullClassMatch[0], "").trim();
    }

    // Также проверяем краткую форму (ю) внутри аннотаций
    if (!nounClass) {
      const shortClassMatch = remaining.match(
        /<i>[^<]*\((ю)\)[^<]*<\/i>/,
      );
      if (shortClassMatch) {
        nounClass = "йу"; // ю → йу
        remaining = remaining.replace(shortClassMatch[0], "").trim();
      }
    }

    // Убираем оставшиеся аннотации <i>...</i>
    remaining = remaining.replace(/<i>[^<]*<\/i>/g, "").trim();

    // Финальная очистка перевода
    const translation = stripStressMarks(
      stripHtml(remaining)
        .replace(/\s+/g, " ")
        .replace(/[;,]+$/, "")
        .trim(),
    );

    if (!translation) continue;

    results.push({
      word: stripStressMarks(word),
      nounClass,
      meanings: [{ translation }],
      domain: "geology",
    });
  }

  return results;
}
