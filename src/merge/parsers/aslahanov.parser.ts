import type { GrammarInfo, Meaning, ParsedEntry, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  expandClass,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для словаря Аслаханова (aslahanov_ru_ce.json).
 * Русско-чеченский спортивный словарь, ~8205 записей, ~2735 уникальных.
 *
 * Формат:
 * - word: русский спортивный термин
 * - translate: напрямую начинается с чеченского перевода (без тире-разделителя)
 *   NO <b> tags, NO <br> tags.
 *
 * 930 записей содержат inline грамматику в скобках:
 *   кхерч (кхерчан, кхерчана, кхерчо, кхерче, <i>б; мн, </i> кхерчаш, <i>д </i>) ларбар
 *   Формат: lemma (gen, dat, erg, loc, <i>class; мн,</i> plural, <i>pluralClass</i>) rest
 *
 * 668 записей имеют маркеры классов: <i>б</i>, <i>д</i>, <i>в</i>, <i>й</i>
 *
 * 167 записей с пустым translate — заголовки разделов, перекрёстные ссылки,
 * осиротевшие фрагменты. Пропускаются.
 */
export function parseAslahanovEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const entry = parseAslahanovEntry(raw);
    if (entry) results.push(entry);
  }

  return results;
}

function parseAslahanovEntry(raw: RawDictEntry): ParsedEntry | null {
  const translate = raw.translate?.trim();
  if (!translate) return null;

  const word = cleanText(stripHtml(raw.word1 ?? raw.word));
  if (!word) return null;

  // Parse the translate field: may contain inline grammar in parens
  const parsed = parseTranslate(translate);

  if (!parsed.translation) return null;

  return {
    word: stripStressMarks(word),
    nounClass: parsed.nounClass,
    nounClassPlural: parsed.nounClassPlural,
    grammar: parsed.grammar,
    meanings: [{ translation: parsed.translation }],
    domain: "sport",
  };
}

interface TranslateParseResult {
  translation: string;
  nounClass?: string;
  nounClassPlural?: string;
  grammar?: GrammarInfo;
}

/**
 * Parse the translate field which may contain inline grammar:
 *   кхерч (кхерчан, кхерчана, кхерчо, кхерче, <i>б; мн, </i> кхерчаш, <i>д </i>) ларбар
 *
 * Structure:
 *   LEMMA (gen, dat, erg, loc/instr, <i>CLASS; мн,</i> plural, <i>PLURAL_CLASS</i>) REST
 *
 * The forms BEFORE the parens are the Chechen lemma.
 * The rest after ")" is additional translation text.
 */
function parseTranslate(translate: string): TranslateParseResult {
  // Try to match the grammar pattern: text (forms...) rest
  const grammarMatch = translate.match(
    /^([^(]+?)\s*\(([^)]+)\)\s*(.*)/s,
  );

  if (grammarMatch) {
    const lemma = cleanText(stripHtml(grammarMatch[1]));
    const grammarBlock = grammarMatch[2];
    const rest = cleanText(stripHtml(grammarMatch[3]));

    const parsed = parseGrammarBlock(grammarBlock);

    // Full translation: lemma + rest (if any)
    const translation = rest
      ? `${stripStressMarks(lemma)} ${stripStressMarks(rest)}`
      : stripStressMarks(lemma);

    return {
      translation,
      nounClass: parsed.nounClass,
      nounClassPlural: parsed.nounClassPlural,
      grammar: parsed.grammar && Object.keys(parsed.grammar).length > 0
        ? parsed.grammar
        : undefined,
    };
  }

  // No grammar block — check for standalone class markers in the translate
  let nounClass: string | undefined;
  let cleaned = translate;

  const classMatch = translate.match(/<i>\s*([бвдй])\s*<\/i>/);
  if (classMatch) {
    nounClass = expandClass(classMatch[1]);
    cleaned = translate.replace(/<i>\s*[бвдй]\s*<\/i>/g, "");
  }

  const translation = cleanText(stripHtml(stripStressMarks(cleaned)));
  if (!translation) return { translation: "" } as TranslateParseResult;

  return {
    translation,
    nounClass,
  };
}

/**
 * Parse the grammar block from inside parentheses.
 *
 * Format:
 *   кхерчан, кхерчана, кхерчо, кхерче, <i>б; мн, </i> кхерчаш, <i>д </i>
 *
 * Components:
 *   gen, dat, erg, loc/instr, <i>CLASS; мн,</i> plural, <i>PLURAL_CLASS</i>
 *
 * Some entries may have fewer forms or different arrangements.
 * The class marker appears as <i>б</i>, <i>д</i>, <i>в</i>, <i>й</i>.
 */
function parseGrammarBlock(block: string): {
  grammar: GrammarInfo;
  nounClass?: string;
  nounClassPlural?: string;
} {
  const grammar: GrammarInfo = {};
  let nounClass: string | undefined;
  let nounClassPlural: string | undefined;

  // Extract class markers: <i>б; мн,</i> or <i>б</i> or <i>д </i>
  const classMatches = [...block.matchAll(/<i>\s*([бвдй])\s*[^<]*<\/i>/g)];

  if (classMatches.length >= 1) {
    nounClass = expandClass(classMatches[0][1]);
  }
  if (classMatches.length >= 2) {
    nounClassPlural = expandClass(classMatches[classMatches.length - 1][1]);
  }

  // Extract plural: text after "мн," or "мн." up to the next <i> or end
  const pluralMatch = block.match(/мн[.,]\s*<\/i>\s*([^,<]+)/);
  if (pluralMatch) {
    grammar.plural = cleanText(stripStressMarks(stripHtml(pluralMatch[1])));
  }
  if (nounClassPlural) {
    grammar.pluralClass = nounClassPlural;
  }

  // Strip all HTML and class/plural markers for extracting case forms
  let plain = block
    .replace(/<i>[^<]*<\/i>/g, "") // remove <i>...</i> blocks (class markers)
    .trim();

  // Remove the plural form from the plain text (it comes after the class block)
  if (grammar.plural) {
    const pluralIdx = plain.lastIndexOf(grammar.plural);
    if (pluralIdx !== -1) {
      plain = plain.substring(0, pluralIdx);
    }
  }

  // Clean up
  plain = stripHtml(plain).replace(/[;]+/g, ",").trim();

  const forms = plain
    .split(",")
    .map((f) => cleanText(stripStressMarks(f)))
    .filter((f) => f.length > 0);

  // Assign case forms: genitive, dative, ergative, instrumental/locative
  if (forms.length >= 1) grammar.genitive = forms[0];
  if (forms.length >= 2) grammar.dative = forms[1];
  if (forms.length >= 3) grammar.ergative = forms[2];
  if (forms.length >= 4) grammar.instrumental = forms[3];

  return { grammar, nounClass, nounClassPlural };
}
