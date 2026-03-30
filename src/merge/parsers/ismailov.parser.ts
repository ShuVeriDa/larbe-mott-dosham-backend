import type { ParsedEntry, Phrase, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  extractPartOfSpeech,
  normalizePos,
  posToNah,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для словарей Исмаилова:
 * - ismailov_ce_ru.json (737 записей, ~376 уникальных) — чеченско-русский
 * - ismailov_ru_ce.json (135 записей, ~68 уникальных) — русско-чеченский
 *
 * CE→RU формат:
 *   word может иметь числовой суффикс: "а1", "а2" — убираем
 *   translate начинается с " – " (53%) или "<i>(бу)</i> – "
 *   Части речи: <i>(союз)</i>, <i>(частица)</i> и т.п.
 *   Примеры: *Къолам <b>а</b>, кехат <b>а</b> – карандаш и бумага (редко, 24 записи)
 *   <br/> разделитель (только 2 записи)
 *   Классы: <i>(бу)</i>, <i>(ду)</i>, <i>(йу)</i>, <i>(ву)</i> — полная форма
 *   3 сломанные записи (id=8915: полная запись в word)
 *
 * RU→CE формат:
 *   translate начинается с " – " в основном
 *   Аннотации: <i>(сказ.)</i> перед тире
 *   Суффиксы множественного числа: ; -аш <i>(йу)</i>
 *   Классы как в ce→ru
 */

/** Парсит ismailov_ce_ru.json: word = чеченский, перевод = русский */
export function parseIsmailovCeRuEntries(
  raws: RawDictEntry[],
): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const wordRaw = raw.word?.trim();
    const translate = raw.translate?.trim();

    if (!wordRaw || !translate) continue;

    // Пропускаем сломанные записи (полная запись в word)
    if (wordRaw.includes(" – ") && wordRaw.length > 50) continue;

    // Убираем числовой суффикс: "а1" → "а"
    let word = stripHtml(cleanText(wordRaw))
      .replace(/\d+$/, "")
      .trim();

    if (!word) continue;

    let remaining = translate;

    // Извлекаем класс: <i>(бу)</i>, <i>(ду)</i>, <i>(йу)</i>, <i>(ву)</i>
    let nounClass: string | undefined;
    const classMatch = remaining.match(/<i>\((бу|ду|йу|ву)\)<\/i>/);
    if (classMatch) {
      nounClass = classMatch[1];
      remaining = remaining.replace(classMatch[0], "").trim();
    }

    // Убираем начальное тире " – "
    remaining = remaining.replace(/^\s*–\s*/, "").trim();

    // Извлекаем часть речи
    const partOfSpeech = extractPartOfSpeech(remaining);
    if (partOfSpeech) {
      remaining = remaining.replace(/<i>\([^)]*\)<\/i>\s*/, "").trim();
    }

    // Разбиваем по <br/> или <br />
    const parts = remaining.split(/<br\s*\/?>/);
    remaining = parts.join(" ").trim();

    // Извлекаем примеры: *Текст <b>слово</b>, текст – перевод
    const examples: Phrase[] = [];
    const exampleRegex = /\*([^*]+?)(?=\*|$)/g;
    let exMatch: RegExpExecArray | null;
    while ((exMatch = exampleRegex.exec(remaining)) !== null) {
      const exText = exMatch[1].trim();
      // Разделяем по тире " – "
      const dashIdx = exText.indexOf(" – ");
      if (dashIdx !== -1) {
        const nah = stripHtml(exText.substring(0, dashIdx)).trim();
        const ru = stripHtml(exText.substring(dashIdx + 3)).trim();
        if (nah && ru) {
          examples.push({
            nah: stripStressMarks(nah),
            ru: stripStressMarks(ru),
          });
        }
      }
    }

    // Убираем примеры из основного текста
    let mainText = remaining.replace(/\*[^*]+/g, "").trim();

    // Финальная очистка
    const translation = stripStressMarks(
      stripHtml(mainText)
        .replace(/\s+/g, " ")
        .replace(/[;,]+$/, "")
        .trim(),
    );

    if (!translation) continue;

    results.push({
      word: stripStressMarks(word),
      partOfSpeech: normalizePos(partOfSpeech),
      partOfSpeechNah: posToNah(normalizePos(partOfSpeech)),
      nounClass,
      meanings: [
        {
          translation,
          examples: examples.length > 0 ? examples : undefined,
        },
      ],
    });
  }

  return results;
}

/** Парсит ismailov_ru_ce.json: word = русский, перевод = чеченский */
export function parseIsmailovRuCeEntries(
  raws: RawDictEntry[],
): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const wordRaw = raw.word?.trim();
    const translate = raw.translate?.trim();

    if (!wordRaw || !translate) continue;

    const word = stripHtml(cleanText(wordRaw)).trim();
    if (!word) continue;

    let remaining = translate;

    // Извлекаем аннотации перед тире: <i>(сказ.)</i>
    remaining = remaining.replace(/<i>\([^)]*\.<\/i>\)?\s*/g, "").trim();
    // Также формат <i>(сказ.)</i>
    remaining = remaining.replace(/<i>\([^)]*\.\)<\/i>\s*/g, "").trim();

    // Убираем начальное тире " – "
    remaining = remaining.replace(/^\s*–\s*/, "").trim();

    // Извлекаем класс: <i>(бу)</i>, <i>(ду)</i>, <i>(йу)</i>, <i>(ву)</i>
    let nounClass: string | undefined;
    const classMatch = remaining.match(/<i>\((бу|ду|йу|ву)\)<\/i>/);
    if (classMatch) {
      nounClass = classMatch[1];
      remaining = remaining.replace(classMatch[0], "").trim();
    }

    // Извлекаем суффикс множественного числа: ; -аш <i>(йу)</i>
    let pluralSuffix: string | undefined;
    let nounClassPlural: string | undefined;
    const pluralMatch = remaining.match(
      /;\s*(-\S+)\s*<i>\((бу|ду|йу|ву)\)<\/i>/,
    );
    if (pluralMatch) {
      pluralSuffix = pluralMatch[1];
      nounClassPlural = pluralMatch[2];
      remaining = remaining.replace(pluralMatch[0], "").trim();
    }

    // Финальная очистка
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
      nounClassPlural,
      meanings: [{ translation }],
    });
  }

  return results;
}
