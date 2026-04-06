import type { ParsedEntry, Phrase, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  expandClass,
  expandClassCompound,
  extractDashExamples,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для компьютерного словаря ru_ce_ce_ru_computer.json (1092 записей, ~365 уникальных).
 *
 * Формат word:
 *   word1 = чистое слово, word = слово с ударениями (combining tilde U+0303)
 *   Класс в word: <i>(й, й)</i> — (ед. класс, мн. класс)
 *   Сломанные <i>: "<i>(в</i>/<i>й, б)</i>" — из-за `/`
 *   13 записей с голыми скобками: "иэс (й)"
 *
 * Формат translate:
 *   ОсновнойПеревод<br /><b>nah –</b> ru<br /><b>nah –</b> ru
 *   Первое слово до <br /> — основной русский перевод (с ударениями)
 *
 * 3 пустые записи, 1 сломанная (word1 = "упаковать </b>(") — пропускаем.
 */
export function parseComputerEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const word1 = raw.word1?.trim() ?? "";
    const wordRaw = raw.word?.trim() ?? "";
    const translate = raw.translate?.trim();

    // Пропускаем пустые и сломанные записи
    if (!translate) continue;
    if (!word1 && !wordRaw) continue;
    if (word1.includes("</b>")) continue; // сломанная запись "упаковать </b>("
    // Сломанные записи где word1 = "Iалашдан сохранить" (чеченское + русское слипшись)
    if (/^[IӀ]\S+\s+[а-яёА-ЯЁ]/.test(word1)) continue;

    // Извлекаем класс из word
    const classInfo = extractClassFromWord(wordRaw);
    const word = classInfo.word;
    let nounClass = classInfo.nounClass;
    let nounClassPlural = classInfo.nounClassPlural;

    // Чистое слово — берем word1 если есть, иначе очищенный word
    const cleanWord = word1
      ? stripHtml(cleanText(word1))
          .replace(/\([^)]*\)/g, "")
          .trim()
      : word;

    if (!cleanWord) continue;

    // Парсим translate
    // Разбиваем по <br /> или <br/>
    const parts = translate.split(/<br\s*\/?>/);

    // Извлекаем класс из translate, если не нашли в word
    let translationHead = parts[0];
    if (!nounClass) {
      const classInTranslate = translationHead.match(
        /<i>\(([бвдйю/]+)(?:,\s*([бвдйю]+))?\)<\/i>/,
      );
      if (classInTranslate) {
        nounClass = classInTranslate[1].includes("/")
          ? expandClassCompound(classInTranslate[1])
          : expandClass(classInTranslate[1]);
        if (classInTranslate[2]) {
          nounClassPlural = expandClass(classInTranslate[2]);
        }
        translationHead = translationHead
          .replace(classInTranslate[0], "")
          .trim();
      }
    }

    const mainTranslation = stripStressMarks(
      stripHtml(cleanText(translationHead)).trim(),
    );

    if (!mainTranslation) continue;

    // Извлекаем примеры из оставшейся части
    const exampleText = parts.slice(1).join("<br />");
    const rawExamples: Phrase[] = extractDashExamples(exampleText);

    // Определяем направление: если заголовок содержит Ӏ/ӏ — это nah→ru,
    // иначе ru→nah и nah/ru в примерах перепутаны
    const isNahToRu = /[Ӏӏ]/.test(word1 || wordRaw);
    const examples: Phrase[] = isNahToRu
      ? rawExamples
      : rawExamples.map((ex) => ({ nah: ex.ru, ru: ex.nah }));

    const wordClean = stripStressMarks(stripHtml(cleanWord))
      .replace(/\s*[–-]\s*$/, "")
      .trim();
    const wordAccented = stripHtml(cleanText(word1 || wordRaw))
      .replace(
        /\s*\((?:[бвдйю](?:\/[бвдйю])?(?:,\s*[бвдйю])?(?:;\s*)?)+\)\s*/g,
        " ",
      )
      .replace(/\s*[–-]\s*$/, "")
      .trim();

    results.push({
      word: wordClean ? wordClean[0].toLowerCase() + wordClean.slice(1) : wordClean,
      wordAccented: wordAccented !== wordClean ? wordAccented : undefined,
      nounClass,
      nounClassPlural,
      meanings: [
        {
          translation: mainTranslation,
          examples: examples.length > 0 ? examples : undefined,
        },
      ],
      domain: "computer",
    });
  }

  return results;
}

/**
 * Извлекает класс существительного из word.
 *
 * Варианты:
 *   <i>(й, й)</i>          — стандартный
 *   <i>(в</i>/<i>й, б)</i> — сломанный из-за `/`
 *   (й)                     — голые скобки без <i>
 *   <i>(д)</i>              — единственный класс
 */
function extractClassFromWord(wordRaw: string): {
  word: string;
  nounClass?: string;
  nounClassPlural?: string;
} {
  let word = wordRaw;
  let nounClass: string | undefined;
  let nounClassPlural: string | undefined;

  // Сломанный формат с точкой с запятой: <i>(в</i>/<i>й, б; й, й)</i>
  const brokenSemiMatch = word.match(
    /<i>\(([бвдйю])<\/i>\/<i>([бвдйю]),\s*([бвдйю]);\s*([бвдйю]),\s*([бвдйю])\)<\/i>/,
  );
  if (brokenSemiMatch) {
    // в/й, б — одушевлённый; й, й — неодушевлённый
    // Берём неодушевлённый как основной (для компьютерного словаря)
    nounClass = expandClass(brokenSemiMatch[4]);
    nounClassPlural = expandClass(brokenSemiMatch[5]);
    word = word.replace(brokenSemiMatch[0], "").trim();
    return { word: stripHtml(cleanText(word)), nounClass, nounClassPlural };
  }

  // Сломанный формат: <i>(в</i>/<i>й, б)</i>
  const brokenMatch = word.match(
    /<i>\(([бвдйю])<\/i>\/<i>([бвдйю]),\s*([бвдйю])\)<\/i>/,
  );
  if (brokenMatch) {
    nounClass = expandClassCompound(`${brokenMatch[1]}/${brokenMatch[2]}`);
    nounClassPlural = expandClass(brokenMatch[3]);
    word = word.replace(brokenMatch[0], "").trim();
    return { word: stripHtml(cleanText(word)), nounClass, nounClassPlural };
  }

  // Стандартный формат: <i>(CLASS, CLASS)</i> или <i>(CLASS)</i>
  const italicMatch = word.match(/<i>\(([бвдйю/]+)(?:,\s*([бвдйю]+))?\)<\/i>/);
  if (italicMatch) {
    const rawSingular = italicMatch[1];
    nounClass = rawSingular.includes("/")
      ? expandClassCompound(rawSingular)
      : expandClass(rawSingular);
    if (italicMatch[2]) {
      nounClassPlural = expandClass(italicMatch[2]);
    }
    word = word.replace(italicMatch[0], "").trim();
    return { word: stripHtml(cleanText(word)), nounClass, nounClassPlural };
  }

  // Голые скобки с точкой с запятой: "редактор (в/й, б; й, й)"
  const bareSemiMatch = word.match(
    /\(([бвдйю/]+),\s*([бвдйю]+);\s*([бвдйю/]+),\s*([бвдйю]+)\)/,
  );
  if (bareSemiMatch) {
    nounClass = expandClass(bareSemiMatch[3]);
    nounClassPlural = expandClass(bareSemiMatch[4]);
    word = word.replace(bareSemiMatch[0], "").trim();
    return { word: stripHtml(cleanText(word)), nounClass, nounClassPlural };
  }

  // Голые скобки: "иэс (й)" или "слово (й, д)"
  const bareMatch = word.match(/\(([бвдйю/]+)(?:,\s*([бвдйю]+))?\)/);
  if (bareMatch) {
    const rawSingular = bareMatch[1];
    nounClass = rawSingular.includes("/")
      ? expandClassCompound(rawSingular)
      : expandClass(rawSingular);
    if (bareMatch[2]) {
      nounClassPlural = expandClass(bareMatch[2]);
    }
    word = word.replace(bareMatch[0], "").trim();
    return { word: stripHtml(cleanText(word)), nounClass, nounClassPlural };
  }

  return { word: stripHtml(cleanText(word)) };
}
