import type { Meaning, ParsedEntry, Phrase, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  extractPartOfSpeech,
  posToNah,
  splitMeanings,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для словаря Карасаева-Мациева (karasaev_maciev_ru_ce.json).
 * Русско-чеченский словарь, ~26532 записей, ~9221 уникальных.
 *
 * Формат:
 * - word: русское слово со знаками ударения (acute), word1 — без них.
 *   Может содержать окончания прилагательных: "августовский, -ая, -ое"
 *   Может содержать \t[ (189 записей) — фразовые статьи.
 * - translate: аналогичен формату maciev, но направление RU→NAH:
 *   <i>POS</i> + нумерованные значения 1) текст 2) текст
 *   + <b>Russian phrase</b> Chechen translation
 *   + ◊ phraseology
 *
 * Edge cases:
 * - 4 записи с word="-[" — битый HTML split, пропуск.
 * - 1 запись с word="3" — orphan, пропуск.
 * - 10 записей с пустым word — пропуск.
 * - 10 записей с пустым translate — пропуск.
 */
export function parseKarasaevEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const entry = parseKarasaevEntry(raw);
    if (entry) results.push(entry);
  }

  return results;
}

function parseKarasaevEntry(raw: RawDictEntry): ParsedEntry | null {
  const translate = raw.translate?.trim();
  if (!translate) return null;

  // word1 is the clean version (no stress marks), fallback to word
  const rawWord = cleanText(raw.word1 ?? raw.word);
  if (!rawWord) return null;

  // Skip broken entries
  if (rawWord === "-[" || rawWord === "3") return null;

  const word = cleanWord(rawWord);
  if (!word) return null;

  // Accented variant from raw.word (has stress marks)
  const rawAccented = cleanText(raw.word);
  const wordAccented =
    rawAccented && rawAccented !== rawWord ? cleanWord(rawAccented) : undefined;

  let remaining = translate;

  // 1. Extract part of speech: <i>POS</i>
  const partOfSpeech = extractPartOfSpeech(remaining);
  if (partOfSpeech) {
    // Remove the POS tag from remaining text
    remaining = remaining.replace(/<i>[^<]*<\/i>\s*/, "").trim();
  }

  // 2. Extract style/subject labels: <i>рел.</i>, <i>перен.</i>, <i>разг.</i> etc.
  const styleLabel = extractStyleLabel(remaining);
  if (styleLabel) {
    remaining = remaining.replace(/<i>[^<]*<\/i>\s*/, "").trim();
  }

  // 3. Split main text from phraseology (◊)
  let mainText = remaining;
  let phraseText = "";
  const phraseIdx = remaining.indexOf("◊");
  if (phraseIdx !== -1) {
    mainText = remaining.substring(0, phraseIdx).trim();
    phraseText = remaining.substring(phraseIdx + 1).trim();
  }

  // 4. Parse meanings (numbered or single)
  const meanings = parseMeanings(mainText);

  // 5. Parse phraseology: <b>Russian</b> Chechen
  const phraseology = phraseText ? extractRuNahExamples(phraseText) : undefined;

  return {
    word: stripStressMarks(stripHtml(word)),
    wordAccented: wordAccented ? stripHtml(wordAccented) : undefined,
    partOfSpeech,
    partOfSpeechNah: posToNah(partOfSpeech),
    meanings,
    phraseology: phraseology?.length ? phraseology : undefined,
    styleLabel,
  };
}

/**
 * Clean the word field. Removes trailing numbers (homonym markers)
 * but preserves tab-bracket phrases and adjective endings.
 */
function cleanWord(word: string): string {
  return word
    .replace(/\d+$/, "") // remove trailing homonym number
    .replace(/<[^>]*>/g, "") // strip any HTML
    .trim();
}

/**
 * Extract style/domain labels from the beginning of translate text.
 * These appear as <i>рел.</i>, <i>перен.</i>, <i>разг.</i> etc.
 */
const SUBJECT_LABELS = [
  "рел.",
  "перен.",
  "разг.",
  "спец.",
  "тех.",
  "мед.",
  "юр.",
  "муз.",
  "воен.",
  "мат.",
  "хим.",
  "физ.",
  "бот.",
  "зоол.",
  "анат.",
  "астр.",
  "геогр.",
  "ист.",
  "лингв.",
  "лит.",
  "полит.",
  "эк.",
  "филос.",
  "фольк.",
  "уст.",
  "устар.",
  "книжн.",
  "прост.",
  "обл.",
  "презр.",
  "бран.",
  "шутл.",
  "ирон.",
  "ласк.",
];

function extractStyleLabel(text: string): string | undefined {
  const m = text.match(/^<i>([^<]+)<\/i>/);
  if (!m) return undefined;

  const label = m[1].trim().toLowerCase();
  for (const known of SUBJECT_LABELS) {
    if (label.startsWith(known)) return known;
  }
  return undefined;
}

/**
 * Extracts example pairs from RU→NAH text.
 * Format: <b>Russian phrase</b> Chechen translation
 * Since this is a RU→NAH dictionary, the bold text is Russian and the
 * text following it is Chechen.
 */
function extractRuNahExamples(text: string): Phrase[] {
  const results: Phrase[] = [];
  const regex = /<b>([^<]+)<\/b>\s*([^<;◊]*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const ru = cleanText(stripStressMarks(match[1]));
    const nah = cleanText(stripStressMarks(match[2]));
    if (ru && nah) results.push({ nah, ru });
  }

  return results;
}

/**
 * Parse meanings from the main text (before ◊).
 * Splits numbered meanings "1) ... 2) ..." and extracts examples.
 */
function parseMeanings(text: string): Meaning[] {
  const stripped = cleanText(text);
  const meaningTexts = splitMeanings(stripped);

  return meaningTexts.map((mt) => {
    const examples = extractRuNahExamples(mt);

    // Translation is the Chechen text, after removing example blocks
    let translation = mt
      .replace(/<b>[^<]*<\/b>[^<;◊]*/g, "") // remove example pairs
      .replace(/<[^>]*>/g, "") // strip remaining HTML
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
