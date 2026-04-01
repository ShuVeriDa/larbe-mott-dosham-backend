import type { GrammarInfo, ParsedEntry, RawDictEntry } from "./types";
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

// -------------------------------------------------------------------------
// Paren-group helpers
// -------------------------------------------------------------------------

interface ParenGroup {
  inner: string; // content inside ()
  start: number; // index of (
  end: number; // index after )
}

/** Find all balanced (...) groups. Unclosed ( extends to end of string. */
function findParenGroups(text: string): ParenGroup[] {
  const groups: ParenGroup[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "(") {
      const close = text.indexOf(")", i + 1);
      if (close !== -1) {
        groups.push({
          inner: text.substring(i + 1, close),
          start: i,
          end: close + 1,
        });
        i = close + 1;
      } else {
        groups.push({
          inner: text.substring(i + 1),
          start: i,
          end: text.length,
        });
        break;
      }
    } else {
      i++;
    }
  }
  return groups;
}

/** Heuristic: does content inside (...) look like a grammar block? */
function isGrammarBlock(inner: string): boolean {
  // Contains class markers in <i> tags: <i>б</i>, <i>й; мн.</i>, etc.
  if (/<i>\s*[бвдй]/.test(inner)) return true;
  // Contains plural marker
  if (/мн[.,\s]/.test(inner)) return true;
  // Contains масд./прич./ханд. prefix (derivation or verb forms)
  if (/масд[.\s]/.test(inner)) return true;
  if (/прич[.\s]/.test(inner)) return true;
  if (/ханд[.\s]/.test(inner)) return true;
  // Has ≥1 comma — two or more tokens in parens is very likely case forms
  // (non-grammar parens like abbreviations/clarifications are single words)
  const commaCount = (inner.match(/,/g) || []).length;
  if (commaCount >= 1) return true;
  return false;
}

/** Remove unmatched closing parens, keep balanced (...) pairs intact. */
function stripUnmatchedParens(text: string): string {
  let depth = 0;
  let result = "";
  for (const ch of text) {
    if (ch === "(") {
      depth++;
      result += ch;
    } else if (ch === ")") {
      if (depth > 0) {
        depth--;
        result += ch;
      } else {
        result += " "; // stray ), replace with space
      }
    } else {
      result += ch;
    }
  }
  return result;
}

/** Check if a string looks like a valid Chechen case form */
function isValidForm(form: string): boolean {
  if (form.length < 2) return false;
  if (/\d/.test(form)) return false;
  if (/\s/.test(form)) return false;
  if (/^[а-яёА-ЯЁӀ\u0300-\u036fьъ\-]+$/u.test(form)) return true;
  return false;
}

// -------------------------------------------------------------------------
// Extra class/plural extraction from rest text
// -------------------------------------------------------------------------

interface ExtraGrammar {
  classes: string[]; // unique class letters found (e.g. ['в', 'й', 'д'])
  plural?: string; // plural form after мн. marker
}

/**
 * Extract additional class markers and plural form from text after grammar block.
 * Pattern: <i>в, </i> й, <i>д; мн. </i> аьхнаш, <i>в </i>) ...
 */
function extractClassesFromRest(text: string): ExtraGrammar {
  const classes: string[] = [];

  // Strip <i>/<\/i> tags to get plain text, then find standalone class letters
  // in their original order: "<i>в, </i> й, <i>д;" → "в,  й, д;" → [в, й, д]
  const stripped = text.replace(/<\/?i>/g, "");
  for (const m of stripped.matchAll(/(?:^|[\s,;])([бвдй])(?=[\s,;)]|$)/g)) {
    if (!classes.includes(m[1])) classes.push(m[1]);
  }

  // Plural form after мн. marker
  let plural: string | undefined;
  const pluralMatch = text.match(
    /мн[.,]\s*(?:<\/i>)?\s*([а-яёӀА-ЯЁьъ\u0300-\u036f\-]+)/u,
  );
  if (pluralMatch) {
    plural = cleanText(stripStressMarks(pluralMatch[1]));
  }

  return { classes, plural };
}

/** Merge extra classes/plural from rest into parsed grammar result. */
function mergeExtraGrammar(
  parsed: { grammar: GrammarInfo; nounClass?: string; nounClassPlural?: string },
  extra: ExtraGrammar,
): void {
  if (extra.classes.length === 0 && !extra.plural) return;

  // Build expanded class list, merging with what grammar block already found
  if (extra.classes.length > 0) {
    const allClasses: string[] = [];
    if (parsed.nounClass) allClasses.push(parsed.nounClass);
    for (const c of extra.classes) {
      const expanded = expandClass(c);
      if (expanded && !allClasses.includes(expanded)) allClasses.push(expanded);
    }
    if (allClasses.length > 0) {
      parsed.nounClass = allClasses.join("/");
      parsed.nounClassPlural = allClasses.join("/");
    }
  }

  // Extract plural from rest if grammar block didn't have one
  if (extra.plural && !parsed.grammar.plural) {
    parsed.grammar.plural = extra.plural;
    if (parsed.nounClassPlural) {
      parsed.grammar.pluralClass = parsed.nounClassPlural;
    }
  }
}

// -------------------------------------------------------------------------
// parseTranslate — main entry point
// -------------------------------------------------------------------------

/**
 * Parse the translate field which may contain inline grammar.
 *
 * Handles multiple patterns:
 *  1) lemma (grammar) rest              — standard
 *  2) lemma (synonym) forms <i>class</i>)  — flat grammar after non-grammar parens
 *  3) word1 (grammar1) word2 (grammar2) — compound entries
 *  4) (grammar) rest                    — grammar at start (word is in the word field)
 *  5) plain text with optional <i>class</i>
 */
function parseTranslate(translate: string): TranslateParseResult {
  const groups = findParenGroups(translate);

  // Find first grammar-like group
  const grammarIdx = groups.findIndex((g) => isGrammarBlock(g.inner));

  if (grammarIdx !== -1) {
    return parseWithGrammarGroup(translate, groups, grammarIdx);
  }

  // No grammar group in parens — check for flat grammar (forms with <i> class
  // markers outside parens, e.g. after a synonym block like (вовшахдазар))
  if (/<i>\s*[бвдй]/.test(translate)) {
    return parseFlatGrammar(translate, groups);
  }

  // Fallback: standalone class markers or plain text
  return parsePlainTranslate(translate);
}

/**
 * Standard case: a grammar (...) group was found at `grammarIdx`.
 * Extract grammar, clean `rest` from subsequent grammar blocks.
 */
function parseWithGrammarGroup(
  translate: string,
  groups: ParenGroup[],
  grammarIdx: number,
): TranslateParseResult {
  const grammarGroup = groups[grammarIdx];
  const before = translate.substring(0, grammarGroup.start);
  let after = translate.substring(grammarGroup.end);

  const parsed = parseGrammarBlock(grammarGroup.inner);

  // Strip subsequent grammar blocks from after (right-to-left to keep indices valid)
  const afterGroups = findParenGroups(after);
  for (let i = afterGroups.length - 1; i >= 0; i--) {
    if (isGrammarBlock(afterGroups[i].inner)) {
      after =
        after.substring(0, afterGroups[i].start) +
        after.substring(afterGroups[i].end);
    }
  }

  // Extract extra class markers and plural from rest BEFORE cleanup
  const extra = extractClassesFromRest(after);
  mergeExtraGrammar(parsed, extra);

  // Strip unmatched closing parens (stray artifacts), leaked class markers
  after = stripUnmatchedParens(after)
    .replace(/<i>\s*[бвдй][^<]*<\/i>/g, "")
    .replace(/\s*[бвдй]\s*;\s*мн[.,]?\s*/g, " ")
    .replace(/\s*мн[.,]\s*/g, " ")
    // Strip bare class letters (б/в/д/й) standing alone between commas/spaces
    .replace(/(^|[\s,])[бвдй](?=[\s,]|$)/g, "$1");

  // Remove plural form that leaked into rest
  if (extra.plural) {
    after = after.replace(
      new RegExp(extra.plural.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
      " ",
    );
  }

  const lemma = cleanText(stripHtml(before));
  const rest = cleanText(stripHtml(after))
    .replace(/^[,.\s]+/, "") // strip leading commas/dots (e.g. when lemma is empty)
    .replace(/[,.\s]+$/, ""); // strip trailing commas/dots

  const translation = rest
    ? `${stripStressMarks(lemma)} ${stripStressMarks(rest)}`.trim()
    : stripStressMarks(lemma);

  return {
    translation,
    nounClass: parsed.nounClass,
    nounClassPlural: parsed.nounClassPlural,
    grammar:
      parsed.grammar && Object.keys(parsed.grammar).length > 0
        ? parsed.grammar
        : undefined,
  };
}

/**
 * Flat grammar: no (...) block is grammar, but <i> class markers exist in text.
 * Pattern: lemma (synonym) gen, dat, erg, instr, <i>CLASS; мн.</i> plural, <i>PCLASS</i>)
 * The grammar forms sit outside parens, after a non-grammar (synonym) block.
 */
function parseFlatGrammar(
  translate: string,
  groups: ParenGroup[],
): TranslateParseResult {
  // Lemma = text before the first paren group
  const lemma =
    groups.length > 0
      ? cleanText(stripHtml(translate.substring(0, groups[0].start)))
      : "";

  // Grammar text = everything after the last non-grammar paren group
  let grammarText =
    groups.length > 0
      ? translate.substring(groups[groups.length - 1].end)
      : translate;

  // Strip stray closing parens (keep balanced pairs)
  grammarText = stripUnmatchedParens(grammarText).trim();

  // Remove any non-grammar paren groups that remain
  const remainingGroups = findParenGroups(grammarText);
  for (let i = remainingGroups.length - 1; i >= 0; i--) {
    if (!isGrammarBlock(remainingGroups[i].inner)) {
      grammarText =
        grammarText.substring(0, remainingGroups[i].start) +
        " " +
        grammarText.substring(remainingGroups[i].end);
    }
  }

  if (grammarText.trim()) {
    const parsed = parseGrammarBlock(grammarText.trim());
    return {
      translation: stripStressMarks(lemma),
      nounClass: parsed.nounClass,
      nounClassPlural: parsed.nounClassPlural,
      grammar:
        parsed.grammar && Object.keys(parsed.grammar).length > 0
          ? parsed.grammar
          : undefined,
    };
  }

  return { translation: stripStressMarks(lemma) || "" };
}

/** Fallback: no grammar blocks, check for standalone class markers. */
function parsePlainTranslate(translate: string): TranslateParseResult {
  let nounClass: string | undefined;
  let cleaned = translate;

  const classMatch = translate.match(/<i>\s*([бвдй])\s*<\/i>/);
  if (classMatch) {
    nounClass = expandClass(classMatch[1]);
    cleaned = translate.replace(/<i>\s*[бвдй]\s*<\/i>/g, "");
  }

  const translation = cleanText(stripHtml(stripStressMarks(cleaned)));
  if (!translation) return { translation: "" } as TranslateParseResult;

  return { translation, nounClass };
}

// -------------------------------------------------------------------------
// parseGrammarBlock
// -------------------------------------------------------------------------

/**
 * Parse the grammar block (from inside parentheses or flat text).
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

  // Extract class markers from <i> tags.
  // A single tag may contain multiple classes: <i>в, й; мн.</i>
  // Tags before "мн" → singular classes, the last tag → plural class(es).
  const iTags = [...block.matchAll(/<i>([^<]*)<\/i>/g)];
  const singularClasses: string[] = [];
  const pluralClasses: string[] = [];
  let seenMn = false;

  for (const tag of iTags) {
    const content = tag[1];
    const hasMn = /мн[.,\s]/.test(content);
    const letters = [...content.matchAll(/[бвдй]/g)].map((m) => m[0]);

    if (!seenMn) {
      // Letters before мн marker are singular classes
      for (const l of letters) {
        const expanded = expandClass(l);
        if (expanded && !singularClasses.includes(expanded))
          singularClasses.push(expanded);
      }
      if (hasMn) seenMn = true;
    } else {
      // Letters after мн marker are plural classes
      for (const l of letters) {
        const expanded = expandClass(l);
        if (expanded && !pluralClasses.includes(expanded))
          pluralClasses.push(expanded);
      }
    }
  }

  if (singularClasses.length > 0) nounClass = singularClasses.join("/");
  if (pluralClasses.length > 0) nounClassPlural = pluralClasses.join("/");

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

  // Strip grammar marker prefixes BEFORE period-to-comma conversion
  // (otherwise "мн." becomes "мн," and leaks as a form)
  // Note: \b doesn't work with Cyrillic in JS, use explicit boundary
  plain = stripHtml(plain)
    .replace(/(^|[\s,])(мн|масд|прич|ханд)[.\s,]+/g, "$1")
    .replace(/[;.]+/g, ",")
    .trim();

  const forms = plain
    .split(",")
    .map((f) => cleanText(stripStressMarks(f)))
    .filter((f) => f.length > 0)
    // Validate: must be a single Chechen-like word (no digits, no spaces, no junk)
    .filter((f) => isValidForm(f));

  // Assign case forms: genitive, dative, ergative, instrumental/locative
  if (forms.length >= 1) grammar.genitive = forms[0];
  if (forms.length >= 2) grammar.dative = forms[1];
  if (forms.length >= 3) grammar.ergative = forms[2];
  if (forms.length >= 4) grammar.instrumental = forms[3];

  return { grammar, nounClass, nounClassPlural };
}
