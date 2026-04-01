import type { Meaning, ParsedEntry, Phrase, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  extractPartOfSpeech,
  normalizePos,
  posToNah,
  splitMeanings,
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
 *   Составные классы: <i>(ву-йу-бу)</i>, <i>(бу-ду)</i>
 *   Формы мн. числа: ", – наш <i>(ду)</i> – перевод"
 *   3 сломанные записи (id=8915: полная запись в word)
 *
 * RU→CE формат:
 *   translate начинается с " – " в основном
 *   Аннотации: <i>(сказ.)</i> перед тире
 *   Суффиксы множественного числа: ; -аш <i>(йу)</i> или ; -аш (без класса)
 *   Классы как в ce→ru
 *   Нумерованные значения: "1. xxx; 2. yyy"
 */

// Regex для одиночных и составных классов: (бу), (ду), (ву-йу-бу), (бу-ду) и т.д.
const CLASS_RE = /<i>\(((?:(?:бу|ду|йу|ву)(?:-(?:бу|ду|йу|ву))*))\)<\/i>/;

/**
 * Извлекает и удаляет форму мн. числа из начала translate.
 * Паттерн: ", – СУФФИКС (КЛАСС) – ПЕРЕВОД" или ", ВАРИАНТ – ПЕРЕВОД"
 * Перед вызовом нужно снять <b> теги из начала (они иногда оборачивают plural).
 */
function extractPluralPrefix(text: string): {
  remaining: string;
  plural?: string;
  pluralClass?: string;
  variant?: string;
} {
  // Снимаем <b>...</b> теги: "<b>, – лоьраш</b> ..." → ", – лоьраш ..."
  // и ", <b>Лурвоьлларг</b> – ..." → ", Лурвоьлларг – ..."
  let clean = text.replace(/<b>/g, "").replace(/<\/b>/g, "");

  // Формат: ", – СУФФИКС <i>(CLASS)</i> – ПЕРЕВОД"
  const m1 = clean.match(
    /^,\s*–?\s*(.+?)\s*<i>\(((?:(?:бу|ду|йу|ву)(?:-(?:бу|ду|йу|ву))*))\)<\/i>\s*–\s*/,
  );
  if (m1) {
    return {
      remaining: clean.substring(m1[0].length),
      plural: stripHtml(m1[1]).trim(),
      pluralClass: m1[2],
    };
  }

  // Формат: ", – СУФФИКС – ПЕРЕВОД" (без класса, суффикс — короткий: -наш, -еш, -ий и т.п.)
  const m2 = clean.match(/^,\s*–?\s*(-?\S{1,6})\s+–\s*/);
  if (m2) {
    return {
      remaining: clean.substring(m2[0].length),
      plural: stripHtml(m2[1]).trim(),
    };
  }

  // Формат: ", ВАРИАНТ – ПЕРЕВОД" (альтернативная форма, напр. ", Лурвоьлларг – кровник")
  // Отличие от plural: слово длиннее 6 символов и/или начинается с заглавной
  const m3 = clean.match(/^,\s*([А-ЯЁӀа-яёӀ]\S+)\s+–\s*/);
  if (m3) {
    return {
      remaining: clean.substring(m3[0].length),
      variant: stripHtml(m3[1]).trim(),
    };
  }

  return { remaining: text };
}

/**
 * Извлекает составной класс из текста (ву-йу-бу), (бу-ду) и т.д.
 * и удаляет его из строки.
 */
function extractCompoundClass(text: string): {
  remaining: string;
  nounClass?: string;
} {
  const m = text.match(CLASS_RE);
  if (m) {
    return {
      remaining: text.replace(m[0], "").trim(),
      nounClass: m[1],
    };
  }
  // Также ловим составные классы без <i> тегов в тексте: "(бу-ду)", "(ву-йу-бу)"
  const m2 = text.match(
    /\(((?:(?:бу|ду|йу|ву)-)+(?:бу|ду|йу|ву))\)/,
  );
  if (m2) {
    return {
      remaining: text.replace(m2[0], "").trim(),
      nounClass: m2[1],
    };
  }
  return { remaining: text };
}

/** Парсит ismailov_ce_ru.json: word = чеченский, перевод = русский */
export function parseIsmailovCeRuEntries(
  raws: RawDictEntry[],
): ParsedEntry[] {
  const unique = dedup(raws);
  const entryMap = new Map<string, ParsedEntry>();

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

    // Извлекаем класс (одиночный или составной)
    let nounClass: string | undefined;
    const classResult = extractCompoundClass(remaining);
    remaining = classResult.remaining;
    nounClass = classResult.nounClass;

    // Убираем начальное тире " – "
    remaining = remaining.replace(/^\s*–\s*/, "").trim();

    // Извлекаем часть речи: <i>(союз)</i> или <i>прил.</i>
    const partOfSpeech = extractPartOfSpeech(remaining);
    if (partOfSpeech) {
      remaining = remaining.replace(/<i>\(?[^<]*?\)?\s*<\/i>\s*/, "").trim();
    }

    // Разбиваем по <br/> или <br />
    const parts = remaining.split(/<br\s*\/?>/);
    remaining = parts.join(" ").trim();

    // Извлекаем формы мн. числа / варианты из начала: ", – наш (ду) – перевод"
    let plural: string | undefined;
    let pluralClass: string | undefined;
    let variants: string[] | undefined;
    const pluralResult = extractPluralPrefix(remaining);
    if (pluralResult.plural || pluralResult.variant) {
      remaining = pluralResult.remaining;
      if (pluralResult.plural) {
        plural = pluralResult.plural;
        pluralClass = pluralResult.pluralClass;
      }
      if (pluralResult.variant) {
        variants = [pluralResult.variant];
      }
    }

    // Извлекаем составной класс из оставшегося текста (если не был найден ранее)
    if (!nounClass) {
      const compResult = extractCompoundClass(remaining);
      if (compResult.nounClass) {
        nounClass = compResult.nounClass;
        remaining = compResult.remaining;
      }
    }

    // Извлекаем примеры: *Текст <b>слово</b>, текст – перевод
    const examples: Phrase[] = [];
    const exampleRegex = /\*([^*]+?)(?=\*|$)/g;
    let exMatch: RegExpExecArray | null;
    while ((exMatch = exampleRegex.exec(remaining)) !== null) {
      const exText = exMatch[1].trim();
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

    // Финальная очистка — stripHtml ПЕРЕД чисткой артефактов
    let translation = stripStressMarks(
      stripHtml(mainText)
        .replace(/\s+/g, " ")
        .replace(/^[!?]\s*–\s*/, "") // "! – текст" → "текст"
        .replace(/^[!?]\s+(?=[А-ЯЁа-яёA-Za-z])/, "") // "! текст" → "текст"
        .replace(/^[,–\s]+/, "") // убираем оставшиеся ", –" в начале
        .replace(/[;,]+$/, "")
        .trim(),
    );

    // Если перевод пустой, но есть POS и/или примеры — не пропускаем
    if (!translation && !partOfSpeech && examples.length === 0) continue;

    // Формируем grammar с plural
    const grammar =
      plural
        ? { plural: plural.startsWith("-") ? plural : `-${plural}`, pluralClass }
        : undefined;

    const normPos = normalizePos(partOfSpeech);
    const meaning: Meaning = {
      translation,
      partOfSpeech: normPos,
      partOfSpeechNah: posToNah(normPos),
      examples: examples.length > 0 ? examples : undefined,
    };

    const cleanWord = stripStressMarks(word);

    // Дедупликация по слову: мержим значения
    const existing = entryMap.get(cleanWord);
    if (existing) {
      // Добавляем значение только если перевод отличается
      const isDuplicate = translation &&
        existing.meanings.some((m) => m.translation === translation);
      if (!isDuplicate) {
        existing.meanings.push(meaning);
      } else if (examples.length > 0) {
        // Перевод совпадает, но есть новые примеры — добавляем их
        const target = existing.meanings.find((m) => m.translation === translation);
        if (target) {
          target.examples = [...(target.examples ?? []), ...examples];
        }
      }
      // Обновляем поля если у существующей записи нет
      if (!existing.nounClass && nounClass) existing.nounClass = nounClass;
      if (!existing.grammar && grammar) existing.grammar = grammar;
      if (variants) {
        existing.variants = [...(existing.variants ?? []), ...variants];
      }
      continue;
    }

    const entry: ParsedEntry = {
      word: cleanWord,
      nounClass,
      grammar,
      variants,
      meanings: [meaning],
    };

    entryMap.set(cleanWord, entry);
  }

  return Array.from(entryMap.values());
}

/** Парсит ismailov_ru_ce.json: word = русский, перевод = чеченский */
export function parseIsmailovRuCeEntries(
  raws: RawDictEntry[],
): ParsedEntry[] {
  const unique = dedup(raws);
  const entryMap = new Map<string, ParsedEntry>();

  for (const raw of unique) {
    const wordRaw = raw.word?.trim();
    const translate = raw.translate?.trim();

    if (!wordRaw || !translate) continue;

    const word = stripHtml(cleanText(wordRaw)).trim();
    if (!word) continue;

    let remaining = translate;

    // Извлекаем аннотации перед тире: <i>(сказ.)</i>
    remaining = remaining.replace(/<i>\([^)]*\.<\/i>\)?\s*/g, "").trim();
    remaining = remaining.replace(/<i>\([^)]*\.\)<\/i>\s*/g, "").trim();

    // Убираем начальное тире " – "
    remaining = remaining.replace(/^\s*–\s*/, "").trim();

    // Извлекаем суффикс мн. числа С классом ПЕРЕД извлечением основного класса
    // (иначе <i>(класс)</i> после суффикса будет удалён раньше)
    let pluralSuffix: string | undefined;
    let nounClassPlural: string | undefined;
    const pluralWithClassMatch = remaining.match(
      /;\s*(-\s*\S+)\s*<i>\(((?:(?:бу|ду|йу|ву)(?:-(?:бу|ду|йу|ву))*))\)<\/i>/,
    );
    if (pluralWithClassMatch) {
      pluralSuffix = pluralWithClassMatch[1].replace(/\s+/g, "");
      nounClassPlural = pluralWithClassMatch[2];
      remaining = remaining.replace(pluralWithClassMatch[0], "").trim();
    }

    // Извлекаем класс (одиночный или составной)
    let nounClass: string | undefined;
    const classResult = extractCompoundClass(remaining);
    remaining = classResult.remaining;
    nounClass = classResult.nounClass;

    // Извлекаем суффикс мн. числа без класса: "; -аш", "; – наш", "; - ш"
    // NB: \b не работает с кириллицей в JS, поэтому не используем
    if (!pluralSuffix) {
      const pluralNoClassMatch = remaining.match(
        /;\s*[-–]\s*([а-яёӀ]+)/,
      );
      if (pluralNoClassMatch) {
        pluralSuffix = `-${pluralNoClassMatch[1]}`;
        remaining = remaining.replace(pluralNoClassMatch[0], "").trim();
      }
    }

    // Извлекаем составной класс из текста (без <i> тегов): "сирсай (бу-ду)"
    if (!nounClass) {
      const compResult = extractCompoundClass(remaining);
      if (compResult.nounClass) {
        nounClass = compResult.nounClass;
        remaining = compResult.remaining;
      }
    }

    // Извлекаем контекстные пометки: "(на теле) – " или "<i>(на теле)</i> – " в начале
    let note: string | undefined;
    const noteMatch = remaining.match(/^(?:<i>)?\(([^)]+)\)(?:<\/i>)?\s*–\s*/);
    if (noteMatch) {
      note = noteMatch[1].trim();
      remaining = remaining.substring(noteMatch[0].length).trim();
    }

    // Финальная очистка HTML
    remaining = stripHtml(remaining)
      .replace(/\s+/g, " ")
      .replace(/[;,]+$/, "")
      .trim();

    if (!remaining) continue;

    // Разбиваем нумерованные значения: "1. xxx; 2. yyy"
    const meaningTexts = splitMeanings(remaining);
    const meanings: Meaning[] = meaningTexts.map((t) => {
      // Убираем оставшиеся суффиксы мн. числа из отдельных значений
      const cleaned = stripStressMarks(
        t.replace(/;\s*[-–]\s*[а-яёӀ]+$/, "")
          .replace(/[;,]+$/, "")
          .trim(),
      );
      return {
        translation: cleaned,
        ...(note ? { note } : {}),
      };
    });

    // Убираем пустые значения
    const validMeanings = meanings.filter((m) => m.translation);
    if (validMeanings.length === 0) continue;

    // Если основной класс не найден, берём из pluralClass
    // (в данных класс часто указан только при суффиксе мн. числа)
    if (!nounClass && nounClassPlural) {
      nounClass = nounClassPlural;
    }

    const cleanWord = stripStressMarks(word);
    const grammar = pluralSuffix
      ? { plural: pluralSuffix, pluralClass: nounClassPlural }
      : undefined;

    // Дедупликация по слову
    const existing = entryMap.get(cleanWord);
    if (existing) {
      for (const m of validMeanings) {
        if (!existing.meanings.some((em) => em.translation === m.translation)) {
          existing.meanings.push(m);
        }
      }
      if (!existing.nounClass && nounClass) existing.nounClass = nounClass;
      if (!existing.nounClassPlural && nounClassPlural)
        existing.nounClassPlural = nounClassPlural;
      if (!existing.grammar && grammar) existing.grammar = grammar;
      continue;
    }

    const entry: ParsedEntry = {
      word: cleanWord,
      nounClass,
      nounClassPlural,
      grammar,
      meanings: validMeanings,
    };

    entryMap.set(cleanWord, entry);
  }

  return Array.from(entryMap.values());
}
