import type { GrammarInfo, ParsedEntry, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  expandClass,
  extractExamples,
  posToNah,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для словаря Умархаджиева-Ахматукаева (математический).
 *
 * Формат word: "абаде ю;"  — слово + класс через пробел
 * Формат translate:
 *   <b><i>абадеш, ю; абаден, абадена, абадено, абаде </i></b>перевод; <b>пример </b>перевод
 */
export function parseUmarhadjievEntry(raw: RawDictEntry): ParsedEntry | null {
  let translate = raw.translate?.trim();
  if (!translate) return null;

  const rawWord = cleanText(raw.word);
  if (!rawWord) return null;

  // ── Препроцессинг HTML ──────────────────────────────────────────────
  // P0-3: Склеиваем дефисную разметку в грамматике:
  //   <b><i>бета</i></b>-<b><i>функцеш …</i></b>  →  <b><i>бета-функцеш …</i></b>
  translate = translate.replace(/<\/i><\/b>-<b><i>/g, "-");

  // P0-2: Склеиваем дефисные примеры:
  //   <b>юкъ</b>-<b>юкъара функци</b>  →  <b>юкъ-юкъара функци</b>
  translate = translate.replace(/<\/b>-<b>/g, "-");

  // P0-2b: Склеиваем «текст-<b>текст</b>» → «<b>текст-текст</b>»:
  //   вектор-<b>богӀамалг </b>  →  <b>вектор-богӀамалг </b>
  translate = translate.replace(
    /(\s|;)([\w\u0400-\u04ff\u1c80-\u1c8f-]+)-<b>/gi,
    "$1<b>$2-",
  );

  // P0-2c: Склеиваем «<b>текст</b>-текст» → «<b>текст-текст</b>»:
  //   <b>оригинал</b>-функци  →  <b>оригинал-функци</b>
  translate = translate.replace(
    /<\/b>-([\w\u0400-\u04ff\u1c80-\u1c8f]+)/gi,
    "-$1</b>",
  );

  // P2-3: Склеиваем смежные <b> блоки разделённые plain-текстом:
  //   <b>хадазе </b>функцийн <b>башхаллааш </b>  →  <b>хадазе функцийн башхаллааш </b>
  //   Не склеиваем если между ними cross-ref "хь."
  translate = translate.replace(
    /<\/b>([^<;]{1,30})<b>/g,
    (match: string, text: string) => (/хь\./i.test(text) ? match : ` ${text}`),
  );

  // P1-3: Отделяем текст между </i> и </b> в grammar блоке:
  //   <b><i>формы </i> текст</b>  →  <b><i>формы </i></b><b>текст</b>
  translate = translate.replace(
    /^(<b><i>[^<]+<\/i>)\s+([^<]+<\/b>)/,
    "$1</b><b>$2",
  );

  // Извлекаем класс из word: "абаде ю;" → word="абаде", class="йу"
  // P3-1: "могӀа1 б;" → word="могӀа", homonym marker="1"
  const wordClassMatch = rawWord.match(/^(.+?)\s+([бвдйю])\s*;?\s*$/);
  let word = wordClassMatch
    ? wordClassMatch[1].trim()
    : rawWord.replace(/;+$/, "").trim();
  word = word.replace(/\d+$/, ""); // убираем маркер омонима
  const nounClass = wordClassMatch ? expandClass(wordClassMatch[2]) : undefined;

  // Парсим грамматику из <b><i>forms </i></b>
  let grammar: GrammarInfo | undefined;
  let remaining = translate;

  const grammarMatch = translate.match(/^<b><i>([^<]+)<\/i><\/b>/);
  if (grammarMatch) {
    grammar = parseUmarhadjievGrammar(grammarMatch[1]);
    remaining = translate.substring(grammarMatch[0].length).trim();
  }

  // P2-2: Cross-references: "хь." = "смотри"
  const crossRefMatch = remaining.match(
    /^(?:<i>)?хь\.(?:<\/i>)?\s*(?:<b>)?([^<]+)(?:<\/b>)?\s*$/,
  );
  if (crossRefMatch) {
    const target = stripStressMarks(stripHtml(crossRefMatch[1].trim()));
    return {
      word: stripStressMarks(word),
      nounClass,
      grammar,
      meanings: [{ translation: target, note: `хь. ${target}` }],
      domain: "math",
    };
  }

  // P1-1: Разбиваем на нумерованные значения (1. … 2. …) если есть
  const meanings = parseUmarhadjievMeanings(remaining);

  if (meanings.length === 0) return null;

  // P2-1: Определяем часть речи по переводу (в словаре POS не размечен)
  const pos = inferPos(meanings);

  return {
    word: stripStressMarks(word),
    partOfSpeech: pos,
    partOfSpeechNah: posToNah(pos),
    nounClass,
    grammar,
    meanings,
    domain: "math",
  };
}

// ── Числительные (русские переводы) ────────────────────────────────
const NUMERALS = new Set([
  "ноль",
  "один",
  "два",
  "три",
  "четыре",
  "пять",
  "шесть",
  "семь",
  "восемь",
  "девять",
  "десять",
  "одиннадцать",
  "двенадцать",
  "тринадцать",
  "четырнадцать",
  "пятнадцать",
  "шестнадцать",
  "семнадцать",
  "восемнадцать",
  "девятнадцать",
  "двадцать",
  "тридцать",
  "сорок",
  "пятьдесят",
  "шестьдесят",
  "семьдесят",
  "восемьдесят",
  "девяносто",
  "сто",
  "тысяча",
  "миллион",
  "миллиард",
]);

/** Определяет часть речи по переводу (в этом словаре POS не размечен) */
function inferPos(meanings: ParsedEntry["meanings"]): string | undefined {
  const first = meanings[0]?.translation?.toLowerCase();
  if (!first) return undefined;
  if (NUMERALS.has(first)) return "числ.";
  return undefined;
}

/** Извлекает перевод и примеры из одного сегмента (без нумерации) */
function parseUmarhadjievSegment(segment: string): {
  translation: string;
  examples: { nah: string; ru: string }[];
} {
  const examples = extractExamples(segment);

  let translation = segment
    .replace(/<b>[^<]*<\/b>[^<;]*/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

  translation = translation
    .replace(/(?:;\s*)+/g, "; ")
    .replace(/^[;\s(]+/, "")
    .replace(/[;\s.,()]+$/, "")
    .trim();
  translation = stripStressMarks(translation);

  return { translation, examples };
}

/** Разбивает remaining на Meaning[]: по нумерации или единый блок */
function parseUmarhadjievMeanings(remaining: string): ParsedEntry["meanings"] {
  // Проверяем наличие нумерации: "1. текст … 2. текст"
  const numberedParts = remaining.split(/(?:^|\s)(\d+)\.\s/);

  if (numberedParts.length > 2) {
    // numberedParts: ["prefix", "1", "segment1", "2", "segment2", ...]
    const meanings: ParsedEntry["meanings"] = [];
    for (let i = 1; i < numberedParts.length; i += 2) {
      const seg = numberedParts[i + 1] || "";
      const { translation, examples } = parseUmarhadjievSegment(seg);
      if (translation) {
        meanings.push({
          translation,
          examples: examples.length > 0 ? examples : undefined,
        });
      }
    }
    if (meanings.length > 0) return meanings;
  }

  // Единый блок без нумерации
  const { translation, examples } = parseUmarhadjievSegment(remaining);

  // P1-2: Если перевод пуст, но есть примеры — берём ru первого примера
  if (!translation && examples.length > 0) {
    return examples.map((ex) => ({
      translation: ex.ru,
      examples: [ex],
    }));
  }

  if (!translation) return [];
  return [
    {
      translation,
      examples: examples.length > 0 ? examples : undefined,
    },
  ];
}

function parseUmarhadjievGrammar(text: string): GrammarInfo {
  const grammar: GrammarInfo = {};
  const clean = cleanText(text);

  // Формат: "абадеш, ю; абаден, абадена, абадено, абаде"
  // plural, class; genitive, dative, ergative, instrumental
  const parts = clean.split(";").map((p) => p.trim());

  if (parts.length >= 1) {
    // Первая часть: plural + class
    const pluralPart = parts[0]
      .replace(/[бвдйю]\s*$/, "")
      .replace(/,\s*$/, "")
      .trim();
    if (pluralPart) grammar.plural = stripStressMarks(stripHtml(pluralPart));
  }

  if (parts.length >= 2) {
    // Вторая часть: gen, dat, erg, instr
    const forms = parts[1]
      .split(",")
      .map((f) => stripStressMarks(stripHtml(f.trim())));
    if (forms.length >= 1) grammar.genitive = forms[0];
    if (forms.length >= 2) grammar.dative = forms[1];
    if (forms.length >= 3) grammar.ergative = forms[2];
    if (forms.length >= 4) grammar.instrumental = forms[3];
  }

  return grammar;
}

/** Batch: дедуплицирует и парсит все записи umarhadjiev */
export function parseUmarhadjievEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const result: ParsedEntry[] = [];
  for (const raw of unique) {
    const parsed = parseUmarhadjievEntry(raw);
    if (parsed) result.push(parsed);
  }
  return result;
}
