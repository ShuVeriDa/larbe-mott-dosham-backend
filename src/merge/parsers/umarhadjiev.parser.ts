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
  const translate = raw.translate?.trim();
  if (!translate) return null;

  const rawWord = cleanText(raw.word);
  if (!rawWord) return null;

  // Извлекаем класс из word: "абаде ю;" → word="абаде", class="йу"
  const wordClassMatch = rawWord.match(/^(.+?)\s+([бвдйю])\s*;?\s*$/);
  const word = wordClassMatch ? wordClassMatch[1].trim() : rawWord.replace(/;+$/, "").trim();
  const nounClass = wordClassMatch ? expandClass(wordClassMatch[2]) : undefined;

  // Парсим грамматику из <b><i>forms </i></b>
  let grammar: GrammarInfo | undefined;
  let remaining = translate;

  const grammarMatch = translate.match(/^<b><i>([^<]+)<\/i><\/b>/);
  if (grammarMatch) {
    grammar = parseUmarhadjievGrammar(grammarMatch[1]);
    remaining = translate.substring(grammarMatch[0].length).trim();
  }

  // Основной перевод и примеры
  const examples = extractExamples(remaining);

  // Перевод — текст до первого <b> или до ;
  let translation = remaining
    .replace(/<b>[^<]*<\/b>[^<;]*/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .replace(/[;.]+$/, "")
    .trim();
  translation = stripStressMarks(translation);

  if (!translation) return null;

  return {
    word: stripStressMarks(word),
    partOfSpeech: "сущ.",
    partOfSpeechNah: "ц1ердош",
    nounClass,
    grammar,
    meanings: [
      {
        translation,
        examples: examples.length > 0 ? examples : undefined,
      },
    ],
    domain: "math",
  };
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
    const forms = parts[1].split(",").map((f) => stripStressMarks(stripHtml(f.trim())));
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
