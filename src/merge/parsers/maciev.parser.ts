import type {
  GrammarInfo,
  Meaning,
  ParsedEntry,
  RawDictEntry,
} from "./types";
import {
  cleanText,
  dedup,
  expandClass,
  extractExamples,
  extractPartOfSpeech,
  posToNah,
  splitMeanings,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для словаря Мациева (maciev.json).
 *
 * Форматы translate:
 * 1. Существительные: [gen, dat, erg, instr, <i>CLASS; мн.</i> plural, <i>CLASS</i>] перевод
 * 2. Глаголы:          [present, past, participle] перевод
 * 3. Прилагательные:   <i>прил.</i> перевод
 * 4. Примеры:          <b>нохчийн </b>русский
 * 5. Фразеология:      ◊ <b>нохчийн</b> русский
 */
export function parseMacievEntry(raw: RawDictEntry): ParsedEntry | null {
  const translate = raw.translate?.trim();
  if (!translate) return null;

  const word = cleanWord(raw.word1 ?? raw.word);
  if (!word) return null;

  const wordAccented = cleanWord(raw.word);

  let remaining = translate;
  let grammar: GrammarInfo | undefined;
  let nounClass: string | undefined;

  // 1. Извлекаем грамматический блок [...]
  const bracketMatch = remaining.match(/^\[([^\]]+)\]/);
  if (bracketMatch) {
    const grammarBlock = bracketMatch[1];
    remaining = remaining.substring(bracketMatch[0].length).trim();

    const parsed = parseGrammarBlock(grammarBlock);
    grammar = parsed.grammar;
    nounClass = parsed.nounClass;
  }

  // 2. Извлекаем часть речи (но не деривационные пометы вроде "прич. от", "масд. от")
  const partOfSpeech = extractPartOfSpeech(remaining);
  if (partOfSpeech) {
    // Убираем POS тег из remaining
    remaining = remaining
      .replace(/<i>[^<]*<\/i>\s*/, "")
      .trim();
  }

  // 3. Разделяем основной текст и фразеологизмы (◊)
  let mainText = remaining;
  let phraseText = "";
  const phraseIdx = remaining.indexOf("◊");
  if (phraseIdx !== -1) {
    mainText = remaining.substring(0, phraseIdx).trim();
    phraseText = remaining.substring(phraseIdx + 1).trim();
  }

  // 4. Парсим значения
  const meanings = parseMeanings(mainText);

  // 5. Парсим фразеологизмы
  const phraseology = phraseText ? extractExamples(phraseText) : undefined;

  return {
    word: stripStressMarks(stripHtml(word)),
    wordAccented: word !== wordAccented ? stripHtml(wordAccented) : undefined,
    partOfSpeech: normalizePos(partOfSpeech),
    partOfSpeechNah: posToNah(normalizePos(partOfSpeech)),
    nounClass,
    grammar: grammar && Object.keys(grammar).length > 0 ? grammar : undefined,
    meanings,
    phraseology: phraseology?.length ? phraseology : undefined,
  };
}

function cleanWord(word: string): string {
  return cleanText(word)
    .replace(/\d+$/, "") // убираем числовой суффикс (ага1, бала2)
    .trim();
}

/**
 * Парсит грамматический блок из [...].
 *
 * Существительные (4-6 форм + класс):
 *   а̃ганан, а̃ганна, а̃гано̃, а̃гане̃, <i>д; мн.</i> а̃ганаш, <i>д</i>
 *
 * Глаголы (3 формы, без класса):
 *   о̃гу, э̃гира, аьгна
 */
function parseGrammarBlock(block: string): {
  grammar: GrammarInfo;
  nounClass?: string;
} {
  const grammar: GrammarInfo = {};
  let nounClass: string | undefined;

  // Извлекаем класс: <i>д; мн.</i> или <i>д</i>
  const classMatches = block.match(/<i>([бвдй])(?:[;,]|\s|<)/g);
  if (classMatches && classMatches.length > 0) {
    const firstClass = classMatches[0].match(/<i>([бвдй])/);
    if (firstClass) {
      nounClass = expandClass(firstClass[1]);
    }
  }

  // Извлекаем множественное число: мн.</i> XXXX
  const pluralMatch = block.match(/мн\.<\/i>\s*([^,<]+)/);
  if (pluralMatch) {
    grammar.plural = cleanText(stripStressMarks(pluralMatch[1]));
  }

  // Класс мн. числа — последний <i>CLASS</i>
  if (classMatches && classMatches.length > 1) {
    const lastClass = classMatches[classMatches.length - 1].match(
      /<i>([бвдй])/,
    );
    if (lastClass) {
      grammar.pluralClass = expandClass(lastClass[1]);
    }
  }

  // Чистим блок от HTML тегов для извлечения форм
  const plain = stripHtml(block)
    .replace(/[бвдй](?:;|\s|$)/g, "") // убираем одиночные буквы классов
    .replace(/мн\.\s*/g, "")
    .trim();

  const forms = plain
    .split(",")
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  if (nounClass || grammar.plural) {
    // Существительное: genitive, dative, ergative, instrumental
    if (forms.length >= 1) grammar.genitive = stripStressMarks(forms[0]);
    if (forms.length >= 2) grammar.dative = stripStressMarks(forms[1]);
    if (forms.length >= 3) grammar.ergative = stripStressMarks(forms[2]);
    if (forms.length >= 4) grammar.instrumental = stripStressMarks(forms[3]);
  } else if (forms.length >= 2 && forms.length <= 3) {
    // Глагол: present, past, participle
    grammar.verbPresent = stripStressMarks(forms[0]);
    grammar.verbPast = stripStressMarks(forms[1]);
    if (forms.length >= 3)
      grammar.verbParticiple = stripStressMarks(forms[2]);
  }

  return { grammar, nounClass };
}

function parseMeanings(text: string): Meaning[] {
  const stripped = cleanText(text);

  // Деривационные/ссылочные пометы (<i>масд. от </i>, <i>см.</i> и т.п.)
  // обрабатываем до splitMeanings, чтобы нумерованные подзначения не разбились
  const derivMatch = stripped.match(
    /^<i>([^<]*(?:\s+от|см\.))\s*<\/i>\s*/,
  );
  if (derivMatch) {
    const derivNote = derivMatch[1].trim();
    const afterNote = stripped.substring(derivMatch[0].length);
    const { note, remaining } = extractSourceWord(derivNote, afterNote);

    if (remaining) {
      const meanings = parseNormalMeanings(remaining);
      for (const m of meanings) m.note = note;
      return meanings;
    }
    return [{ translation: "", note }];
  }

  return parseNormalMeanings(stripped);
}

/**
 * Извлекает слово-источник из <b>слово</b> после деривационной пометы.
 * Возвращает note (помета + слово) и оставшийся текст (перевод).
 */
function extractSourceWord(
  derivNote: string,
  text: string,
): { note: string; remaining: string } {
  const sourceMatch = text.match(/^<b>([^<]+)<\/b>\s*/);
  if (!sourceMatch) return { note: derivNote, remaining: text };

  const sourceWord = cleanText(stripStressMarks(sourceMatch[1]))
    .replace(/[\s.,;]+$/, "")
    .replace(/\d+$/, "")
    .replace(/[\s.,;]+$/, "")
    .trim();
  const remaining = text.substring(sourceMatch[0].length).trim();
  const note = sourceWord ? `${derivNote} ${sourceWord}` : derivNote;
  return { note, remaining };
}

/** Парсит обычные (не-деривационные) значения */
function parseNormalMeanings(stripped: string): Meaning[] {
  const meaningTexts = splitMeanings(stripped);

  return meaningTexts.map((mt) => {
    // Деривационная помета внутри нумерованного значения (напр. "1) <i>потенц. от </i>...")
    const innerDerivMatch = mt.match(
      /^<i>([^<]*(?:\s+от|см\.))\s*<\/i>\s*/,
    );
    if (innerDerivMatch) {
      const derivNote = innerDerivMatch[1].trim();
      const afterNote = mt.substring(innerDerivMatch[0].length);
      const { note, remaining } = extractSourceWord(derivNote, afterNote);

      if (remaining) {
        const translation = stripStressMarks(
          stripHtml(remaining).replace(/[;.]+$/, "").trim(),
        );
        return { translation, note };
      }
      return { translation: "", note };
    }

    const examples = extractExamples(mt);

    // Перевод — текст без примеров (<b>...</b>...)
    let translation = mt
      .replace(/<b>[^<]*<\/b>[^<;◊]*/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .replace(/[;.]+$/, "")
      .trim();
    translation = stripStressMarks(translation);

    return {
      translation: translation || stripHtml(stripStressMarks(mt)),
      examples: examples.length > 0 ? examples : undefined,
    };
  });
}

function normalizePos(pos: string | undefined): string | undefined {
  if (!pos) return undefined;
  const base = pos
    .replace(/\s+к$/, "")
    .replace(/\s+от$/, "")
    .replace(/\s+см\..*$/, "")
    .trim();

  const map: Record<string, string> = {
    "прил.": "прил.",
    "прич.": "прич.",
    "гл.": "гл.",
    "сущ.": "сущ.",
    "нареч.": "нареч.",
    "числ.": "числ.",
    "мест.": "мест.",
    "союз": "союз",
    "предлог": "предлог",
    "послелог": "послелог",
    "межд.": "межд.",
    "частица": "частица",
    "дееприч.": "дееприч.",
    "собир.": "собир.",
    "звукоподр.": "звукоподр.",
  };

  for (const [key, val] of Object.entries(map)) {
    if (base.startsWith(key)) return val;
  }
  return pos.trim();
}

/** Batch: дедуплицирует и парсит все записи maciev */
export function parseMacievEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const result: ParsedEntry[] = [];
  for (const raw of unique) {
    const parsed = parseMacievEntry(raw);
    if (parsed) result.push(parsed);
  }
  return result;
}
