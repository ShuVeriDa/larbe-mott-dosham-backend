import type { Meaning, ParsedEntry, Phrase, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  normalizePos,
  posToNah,
  splitMeanings,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для словарей Исмаилова:
 * - ismailov_ce_ru.json (~15654 записей) — чеченско-русский
 * - ismailov_ru_ce.json — русско-чеченский
 *
 * CE→RU формат (plain text, без HTML):
 *   word: "Абат (Абаташ) [ду]" — слово (форма мн.ч.) [класс]
 *         "Авсал [ду]" — слово [класс] (без мн.ч.)
 *         "АвгIан (авхан)" — слово (вариант) (без класса)
 *         "Аганан" — простое слово
 *   translate: plain text
 *     POS в скобках: "(глаг.) текст", "(прил.) текст", "текст (нареч.)"
 *     Класс+множ. в начале: "лоьраш (ву-ю-бу) – окулист"
 *     Примеры через \n: "перевод\n* Нах текст – Рус текст"
 *   Классы в word: [ду], [ю], [бу], [ву], [бу-ду], [ву-ю-бу] и т.д.
 *   Составной класс [X-Y-Z]: последний = plural, остальные = singular (через /)
 *     [ву-ю-бу] → nounClass: "ву/йу", nounClassPlural: "бу"
 *     [бу-ду]   → nounClass: "бу",    nounClassPlural: "ду"
 *   ю → йу, б → бу при нормализации
 *
 * RU→CE формат:
 *   translate начинается с " – " в основном
 *   Аннотации: <i>(сказ.)</i> перед тире
 *   Суффиксы множественного числа: ; -аш <i>(йу)</i> или ; -аш (без класса)
 *   Классы как в ce→ru
 *   Нумерованные значения: "1. xxx; 2. yyy"
 */

/** Нормализует одиночную часть класса: ю→йу, б→бу */
function normalizeSingleClass(p: string): string {
  const t = p.trim().toLowerCase();
  if (t === "ю") return "йу";
  if (t === "б") return "бу";
  return t;
}

/**
 * Разбирает составной класс из формата "X-Y-Z":
 * - Одиночный [ду] → nounClass: "ду", nounClassPlural: "ду"
 * - Составной [ву-ю-бу] → nounClass: "ву/йу", nounClassPlural: "бу"
 *   (последний элемент = plural, остальные = singular через "/")
 */
function parseClassBracket(raw: string): {
  nounClass: string;
  nounClassPlural: string;
} {
  const parts = raw.split("-").map(normalizeSingleClass);
  if (parts.length === 1) {
    return { nounClass: parts[0], nounClassPlural: parts[0] };
  }
  const pluralClass = parts[parts.length - 1];
  const singulars = parts.slice(0, -1).join("/");
  return { nounClass: singulars, nounClassPlural: pluralClass };
}

/**
 * Regex для POS в plain text: (глаг.), (прил.), (союз), (частица) и т.п.
 */
const PLAIN_POS_RE =
  /\((?:глаг\.[^)]*|прил\.|прилаг\.|прилагат\.|прилагательное|сущ\.|существ\.|нареч\.?|наречие|числ\.|мест\.|местоимение|межд\.|междомет\.|междометие|прич\.|дееприч\.|собир\.|звукоподр\.|звукоподраж\.|союз|предлог|послелог|частица)\)/;

/** Извлекает POS из plain text и возвращает нормализованную форму */
function extractPlainPos(text: string): string | undefined {
  const m = text.match(PLAIN_POS_RE);
  if (!m) return undefined;
  const raw = m[0].slice(1, -1).trim();
  const normMap: Record<string, string> = {
    "прилаг.": "прил.",
    "прилагат.": "прил.",
    прилагательное: "прил.",
    "существ.": "сущ.",
    наречие: "нареч.",
    нареч: "нареч.",
    местоимение: "мест.",
    "междомет.": "межд.",
    междометие: "межд.",
    "звукоподраж.": "звукоподр.",
    "глаг.": "гл.",
  };
  const base = raw.replace(/\s+.*$/, ""); // "глаг. соверш.вида" → "глаг."
  const normalized = normMap[base] ?? base;
  return normalizePos(normalized);
}


/** Парсит ismailov_ce_ru.json: word = чеченский, перевод = русский */
export function parseIsmailovCeRuEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const entryMap = new Map<string, ParsedEntry>();

  for (const raw of unique) {
    const wordRaw = raw.word?.trim();
    const translate = raw.translate?.trim();

    if (!wordRaw || !translate) continue;

    // --- Парсим word: "Абат (Абаташ) [ду]" ---
    let wordText = wordRaw;

    // Извлекаем класс из квадратных скобок: [ду], [бу-ду], [ю]
    let nounClass: string | undefined;
    let nounClassPlural: string | undefined;
    const classMatch = wordText.match(/\[([^\]]+)\]/);
    if (classMatch) {
      const parsed = parseClassBracket(classMatch[1]);
      nounClass = parsed.nounClass;
      nounClassPlural = parsed.nounClassPlural;
      wordText = wordText.replace(classMatch[0], "").trim();
    }

    // Извлекаем все скобки: (Абаташ) = plural, (авхан) = variant
    // Формат с классом: "Word (Plural) [class]" или "Word (Plural) [class] (variant)"
    // Формат без класса: "Word (variant)"
    let plural: string | undefined;
    let variants: string[] | undefined;
    const allParens = [...wordText.matchAll(/\(([^)]+)\)/g)];
    if (allParens.length > 0) {
      if (nounClass) {
        // Первые скобки = мн. число, остальные = варианты
        plural = allParens[0][1].trim();
        for (let pi = 1; pi < allParens.length; pi++) {
          variants = variants ?? [];
          variants.push(allParens[pi][1].trim());
        }
      } else {
        // Без класса — все скобки = варианты
        variants = allParens.map((m) => m[1].trim());
      }
      // Удаляем все скобки из wordText
      wordText = wordText.replace(/\([^)]+\)/g, "").trim();
    }

    const wordClean = stripStressMarks(stripHtml(cleanText(wordText)).trim());
    const word = wordClean ? wordClean[0].toLowerCase() + wordClean.slice(1) : wordClean;
    if (!word) continue;

    // --- Парсим translate ---
    const lines = translate.split("\n");
    let mainLine = lines[0].trim();

    // Извлекаем plural+class из начала translate: "лоьраш (ву-ю-бу) – окулист"
    // Формат: "суффикс (класс) – перевод" или "суффикс(класс)– перевод"
    if (!nounClass) {
      const translateClassMatch = mainLine.match(
        /^(\S+)\s*\(((?:(?:бу|ду|йу|ву|ю|б)(?:-(?:бу|ду|йу|ву|ю|б))*))\)\s*–\s*/,
      );
      if (translateClassMatch) {
        const pluralSuffix = translateClassMatch[1].trim();
        const clsParsed = parseClassBracket(translateClassMatch[2]);
        nounClass = clsParsed.nounClass;
        nounClassPlural = clsParsed.nounClassPlural;
        // Для многословных: суффикс заменяет последнее слово
        // "БIаьргийн лор" + "лоьраш" → "БIаьргийн лоьраш"
        const wordParts = word.split(/\s+/);
        if (wordParts.length > 1) {
          plural = [...wordParts.slice(0, -1), pluralSuffix].join(" ");
        } else {
          plural = pluralSuffix;
        }
        mainLine = mainLine.substring(translateClassMatch[0].length).trim();
      }
    }

    // Извлекаем класс из translate без plural: "(ду) – перевод" (для entries без [class])
    if (!nounClass) {
      const simpleClassMatch = mainLine.match(
        /\(((?:(?:бу|ду|йу|ву|ю|б)(?:-(?:бу|ду|йу|ву|ю|б))*))\)/,
      );
      if (simpleClassMatch) {
        const clsParsed = parseClassBracket(simpleClassMatch[1]);
        nounClass = clsParsed.nounClass;
        nounClassPlural = clsParsed.nounClassPlural;
        mainLine = mainLine.replace(simpleClassMatch[0], "").trim();
      }
    }

    // Извлекаем POS из перевода: "(глаг.) долбить" или "бегом (нареч.)"
    const partOfSpeech = extractPlainPos(mainLine);
    if (partOfSpeech) {
      mainLine = mainLine.replace(PLAIN_POS_RE, "").trim();
    }

    // Убираем двоеточие в конце основной строки (перед примерами)
    mainLine = mainLine.replace(/:$/, "").trim();

    // Собираем примеры из строк, начинающихся с *
    const examples: Phrase[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.startsWith("*")) continue;

      // Собираем многострочный пример (до следующего * или конца)
      let exText = line.substring(1).trim();
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (next.startsWith("*")) break;
        // Пропускаем длинные статьи/эссе (>3 строк подряд без тире)
        if (j - i > 3 && !exText.includes(" – ")) break;
        exText += " " + next;
        i = j;
      }

      const dashIdx = exText.indexOf(" – ");
      if (dashIdx !== -1) {
        const nah = stripStressMarks(stripHtml(exText.substring(0, dashIdx)).trim());
        const ru = stripStressMarks(stripHtml(exText.substring(dashIdx + 3)).trim());
        if (nah && ru) {
          examples.push({ nah, ru });
        }
      }
    }

    // Финальная очистка перевода
    const translation = stripStressMarks(
      stripHtml(mainLine)
        .replace(/\s+/g, " ")
        .replace(/^[,–\s]+/, "")
        .replace(/[;,]+$/, "")
        .trim(),
    );

    if (!translation && !partOfSpeech && examples.length === 0) continue;

    // Формируем grammar
    const grammar = plural
      ? { plural, pluralClass: nounClassPlural }
      : undefined;

    const normPos = normalizePos(partOfSpeech);
    const meaning: Meaning = {
      translation,
      partOfSpeech: normPos,
      partOfSpeechNah: posToNah(normPos),
      examples: examples.length > 0 ? examples : undefined,
    };

    // Дедупликация: мержим только если совместимые грам. свойства
    // "Мала" (глагол, без класса) и "Мала [ву-ю-бу]" (сущ.) = разные записи
    const dedupeKey = `${word}|${nounClass ?? ""}`;
    const existing = entryMap.get(dedupeKey);
    if (existing) {
      const isDuplicate =
        translation &&
        existing.meanings.some((m) => m.translation === translation);
      if (!isDuplicate) {
        existing.meanings.push(meaning);
      } else if (examples.length > 0) {
        const target = existing.meanings.find(
          (m) => m.translation === translation,
        );
        if (target) {
          target.examples = [...(target.examples ?? []), ...examples];
        }
      }
      if (!existing.nounClass && nounClass) existing.nounClass = nounClass;
      if (!existing.nounClassPlural && nounClassPlural)
        existing.nounClassPlural = nounClassPlural;
      if (!existing.grammar && grammar) existing.grammar = grammar;
      if (variants) {
        existing.variants = [...(existing.variants ?? []), ...variants];
      }
      continue;
    }

    const entry: ParsedEntry = {
      word,
      nounClass,
      nounClassPlural,
      grammar,
      variants,
      meanings: [meaning],
    };

    entryMap.set(dedupeKey, entry);
  }

  return Array.from(entryMap.values());
}

/**
 * Regex для класса в plain text translate: (ду), (ю), (ву-бу), (ву-ю-бу)
 * Одиночные и составные, без HTML тегов.
 */
const RU_CE_CLASS_RE =
  /\((?:(?:бу|ду|йу|ву|ю|б)(?:-(?:бу|ду|йу|ву|ю|б))*)\)/;

/** POS в word поле: 'а (союз)', 'бдительный (прилаг.)' */
const WORD_POS_RE =
  /\((?:союз|частица|предлог|послелог|прилаг\.|прич\.|нареч\.?|межд\.|числ\.|мест\.|глаг\.?|сущ\.)\)/;

/**
 * Парсит одно значение из translate: "пайда; -наш (бу)" →
 * { translation: "пайда", nounClass: "бу", plural: "-наш", ... }
 */
function parseSingleMeaning(text: string): {
  translation: string;
  nounClass?: string;
  nounClassPlural?: string;
  pluralSuffix?: string;
} {
  let remaining = text.trim();
  let nounClass: string | undefined;
  let nounClassPlural: string | undefined;
  let pluralSuffix: string | undefined;

  // Извлекаем суффикс + класс: "; -аш (ву-бу)" или "- наш (ю)"
  const suffixClassMatch = remaining.match(
    /;\s*(-\s*\S+)\s*\(((?:(?:бу|ду|йу|ву|ю|б)(?:-(?:бу|ду|йу|ву|ю|б))*))\)/,
  );
  if (suffixClassMatch) {
    pluralSuffix = suffixClassMatch[1].replace(/\s+/g, "");
    const cls = parseClassBracket(suffixClassMatch[2]);
    nounClass = cls.nounClass;
    nounClassPlural = cls.nounClassPlural;
    remaining = remaining.replace(suffixClassMatch[0], "").trim();
  }

  // Извлекаем класс без суффикса: "(ду)", "(ву-бу)"
  if (!nounClass) {
    const classMatch = remaining.match(RU_CE_CLASS_RE);
    if (classMatch) {
      const cls = parseClassBracket(classMatch[0].slice(1, -1));
      nounClass = cls.nounClass;
      nounClassPlural = cls.nounClassPlural;
      remaining = remaining.replace(classMatch[0], "").trim();
    }
  }

  // Извлекаем суффикс без класса: "; -аш"
  if (!pluralSuffix) {
    const pluralMatch = remaining.match(/;\s*(-[а-яёӀА-ЯЁ]\S*)/);
    if (pluralMatch) {
      pluralSuffix = pluralMatch[1].replace(/\s+/g, "");
      remaining = remaining.replace(pluralMatch[0], "").trim();
    }
  }

  // Очистка
  const translation = stripStressMarks(
    stripHtml(remaining)
      .replace(/\s+/g, " ")
      .replace(/^[;,.\s]+/, "")
      .replace(/[;,]+$/, "")
      .trim(),
  );

  return { translation, nounClass, nounClassPlural, pluralSuffix };
}

/**
 * Строит полную форму множественного числа из чеченского слова и суффикса.
 * Суффикс формата "-аш", "-ш", "-наш" и т.д.
 * Для многословных выражений суффикс применяется к последнему слову.
 */
function buildPluralForm(word: string, suffix: string): string {
  const clean = suffix.replace(/;+$/, "").trim();
  if (!clean.startsWith("-")) return clean;
  const ending = clean.slice(1);
  const parts = word.split(/\s+/);
  parts[parts.length - 1] = parts[parts.length - 1] + ending;
  return parts.join(" ");
}

/** Парсит ismailov_ru_ce.json: word = русский, перевод = чеченский
 *
 * Формат (plain text, без HTML):
 *   word: "абрек" или "а (союз)" или "бабушка (мать матери)"
 *   translate: "обарг; -аш (ву-бу)" — перевод; -суффикс_мн (класс)
 *              "обаргалла (ду)" — перевод (класс) без суффикса
 *              "1.пайда; -наш (бу); 2.тӀедогӀург; 3. тӀедаьлларг; -ш (ду)"
 *                — нумерованные значения, каждое со своим классом
 *
 * Каждое значение с отличающимся классом → отдельный ParsedEntry.
 */
export function parseIsmailovRuCeEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const entryMap = new Map<string, ParsedEntry>();

  for (const raw of unique) {
    const wordRaw = raw.word?.trim();
    const translate = raw.translate?.trim();

    if (!wordRaw || !translate) continue;

    // --- Парсим word ---
    let wordText = cleanText(wordRaw);

    // Извлекаем POS из word: "а (союз)" → word="а", partOfSpeech="союз"
    let partOfSpeech: string | undefined;
    const posMatch = wordText.match(WORD_POS_RE);
    if (posMatch) {
      const posRaw = posMatch[0].slice(1, -1).trim();
      const normMap: Record<string, string> = {
        "прилаг.": "прил.",
        "глаг.": "гл.",
        глаг: "гл.",
        нареч: "нареч.",
      };
      partOfSpeech = normalizePos(normMap[posRaw] ?? posRaw);
      wordText = wordText.replace(posMatch[0], "").trim();
    }

    const word = stripStressMarks(stripHtml(wordText).trim());
    if (!word) continue;

    const normPos = normalizePos(partOfSpeech);

    // --- Парсим translate: сначала split по значениям, потом класс для каждого ---
    const meaningTexts = splitMeanings(translate);

    for (const mt of meaningTexts) {
      const parsed = parseSingleMeaning(mt);
      if (!parsed.translation) continue;

      const { nounClass, nounClassPlural, pluralSuffix } = parsed;

      const meaning: Meaning = {
        translation: parsed.translation,
        partOfSpeech: normPos,
        partOfSpeechNah: posToNah(normPos),
      };

      const grammar = pluralSuffix
        ? { plural: buildPluralForm(parsed.translation, pluralSuffix), pluralClass: nounClassPlural }
        : undefined;

      // Дедупликация: ключ = word + nounClass
      const dedupeKey = `${word}|${nounClass ?? ""}`;
      const existing = entryMap.get(dedupeKey);
      if (existing) {
        if (!existing.meanings.some((em) => em.translation === meaning.translation)) {
          existing.meanings.push(meaning);
        }
        if (!existing.nounClass && nounClass) existing.nounClass = nounClass;
        if (!existing.nounClassPlural && nounClassPlural)
          existing.nounClassPlural = nounClassPlural;
        if (!existing.grammar && grammar) existing.grammar = grammar;
        continue;
      }

      entryMap.set(dedupeKey, {
        word,
        nounClass,
        nounClassPlural,
        grammar,
        meanings: [meaning],
      });
    }
  }

  return Array.from(entryMap.values());
}
