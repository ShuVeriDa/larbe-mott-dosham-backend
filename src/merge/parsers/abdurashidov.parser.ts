import type { GrammarInfo, ParsedEntry, Phrase, RawDictEntry } from "./types";
import { cleanText, dedup, expandClass } from "./utils";

/**
 * Парсер для юридического словаря Абдурашидова (CE↔RU).
 *
 * Формат: плоский JSON без HTML-разметки.
 *   - section: "ce_ru" | "ru_ce"
 *   - word: для ce_ru — чеченское слово + грамматика + примеры;
 *           для ru_ce — русский термин
 *   - translate: для ce_ru — русский перевод;
 *               для ru_ce — чеченский перевод (иногда с классами)
 */
export function parseAbdurashidovEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const section = (raw as any).section as string | undefined;

    if (section === "ru_ce") {
      const entries = parseRuCeEntry(raw);
      results.push(...entries);
    } else {
      const entries = parseCeRuEntry(raw);
      results.push(...entries);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CE→RU
// ---------------------------------------------------------------------------

/** Class letter regex (single Chechen class marker) */
const CLS_LETTER = /^[бвдйю]$/;

/** Matches a class-pair like "ю,ю", "б,б", "д,д", "в,ю,б" at end of text */
const CLASS_PAIR_END_RE = /\s+([бвдйю])(?:\s*,\s*[бвдйю])+\s*$/;

/** Checks if translate field starts with grammar data (class markers) */
function translateHasGrammar(translate: string): boolean {
  const t = translate.trim();
  // "д; зераш д; ..."  "в,ю; бохамхой б; ..."  "ю; компенсацеш ю; ..."
  // "д,д; исполнение"  "д,допыт"
  return /^[бвдйю]\s*[;,]/.test(t) || /^[бвдйю]\s*$/.test(t);
}

/**
 * CE→RU: word = чеченское слово + грамматика, translate = русский перевод.
 *
 * Special case: sometimes grammar is split across word and translate fields:
 *   word="зер"  translate="д; зераш д; зеран, зерана, зеро, зере 1. испытание"
 *   word="компенсаци (лат.)"  translate="ю; компенсацеш ю; компенсацин, ..."
 */
function parseCeRuEntry(raw: RawDictEntry): ParsedEntry[] {
  let wordRaw = cleanText(raw.word ?? "");
  const translateRaw = cleanText(raw.translate ?? "");
  if (!wordRaw) return [];

  // Normalize: replace ";" between single class letters with ","
  // e.g. "бехкевархо в;ю" → "бехкевархо в,ю"
  wordRaw = wordRaw.replace(/\b([бвдйю])\s*;\s*([бвдйю])\b/g, "$1,$2");

  // Check if grammar data is in the translate field
  if (translateHasGrammar(translateRaw)) {
    return parseCeRuWithGrammarInTranslate(wordRaw, translateRaw);
  }

  // Strip etymology note: (фр.), (лат.), (гр.), (араб.), etc.
  const { text: wordNoEtym } = stripEtymology(wordRaw);

  // Strip all parenthetical notes like (дукх), (бус. хьукмат), (гечдар д,д)
  const wordClean = stripParenthetical(wordNoEtym);

  // Split by semicolons to separate: headword+class ; plural ; cases ; sub-entries
  const semiParts = wordClean
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  const firstPart = semiParts[0] || wordClean;
  const hasSemicolons = semiParts.length > 1;

  let headword: string;
  let nounClass: string | undefined;
  let nounClassPlural: string | undefined;
  const grammar: GrammarInfo = {};
  const subEntries: { nah: string; ru: string }[] = [];

  if (!hasSemicolons) {
    const parsed = parseFirstPartNoSemicolons(firstPart);
    headword = parsed.headword;
    nounClass = parsed.nounClass;
    nounClassPlural = parsed.nounClassPlural;
    if (parsed.grammar) Object.assign(grammar, parsed.grammar);
  } else {
    const hw = extractHeadwordAndClass(firstPart);
    headword = hw.headword;
    nounClass = hw.nounClass;

    for (let i = 1; i < semiParts.length; i++) {
      const part = semiParts[i];

      // Check if this is a sub-entry (phrase with translation)
      const subEntry = tryParseSubEntry(part);
      if (subEntry) {
        subEntries.push(subEntry);
        continue;
      }

      // Check if this is a plural segment possibly mixed with cases
      const pluralAndCases = tryParsePluralSegment(part, headword);
      if (pluralAndCases && !grammar.plural) {
        grammar.plural = pluralAndCases.plural;
        if (pluralAndCases.pluralClass) {
          grammar.pluralClass = pluralAndCases.pluralClass;
          nounClassPlural = pluralAndCases.pluralClass;
        }
        if (pluralAndCases.cases) {
          Object.assign(grammar, pluralAndCases.cases);
        }
        continue;
      }

      // Check if this is case forms
      const cases = tryParseCases(part);
      if (cases && !grammar.genitive) {
        Object.assign(grammar, cases);
        continue;
      }
    }
  }

  if (!headword) return [];

  // Build translation — clean up translate field
  const translation = cleanTranslation(translateRaw);

  // Parse examples from translate field (sub-entries with class-pair markers)
  const examples = parseTranslateExamples(translateRaw);

  const entry: ParsedEntry = {
    word: headword,
    nounClass,
    nounClassPlural: nounClassPlural ?? grammar.pluralClass,
    meanings: translation
      ? [
          {
            translation,
            ...(examples.length > 0 ? { examples } : {}),
          },
        ]
      : [],
    domain: "law",
  };

  if (!entry.nounClassPlural) delete entry.nounClassPlural;

  // Clean grammar fields: remove trailing "уст.", numbered definitions, etc.
  cleanGrammarFields(grammar);
  if (Object.keys(grammar).length > 0) entry.grammar = grammar;

  if (subEntries.length > 0) {
    entry.phraseology = subEntries.map((se) => ({
      nah: se.nah,
      ru: se.ru,
    }));
  }

  return [entry];
}

/**
 * Handle ce_ru entries where grammar data is in the translate field.
 *
 * Patterns:
 *   word="зер" translate="д; зераш д; зеран, зерана, зеро, зере 1. испытание"
 *   word="компенсаци (лат.)" translate="ю; компенсацеш ю; компенсацин, ..."
 *   word="кхочушдар" translate="д,д; исполнение"
 *   word="зеделларг" translate="д,допыт"
 */
function parseCeRuWithGrammarInTranslate(
  wordRaw: string,
  translateRaw: string,
): ParsedEntry[] {
  const { text: wordNoEtym } = stripEtymology(wordRaw);
  const wordClean = stripParenthetical(wordNoEtym);

  // Parse headword from the word field (which may also have sub-entries)
  const wordSemiParts = wordClean
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const wordFirstPart = wordSemiParts[0] || wordClean;

  // The word field may contain sub-entries after semicolons
  const subEntries: { nah: string; ru: string }[] = [];
  for (let i = 1; i < wordSemiParts.length; i++) {
    const sub = tryParseSubEntry(wordSemiParts[i]);
    if (sub) subEntries.push(sub);
  }

  // Extract headword and any class from word field
  const hw = extractHeadwordAndClass(wordFirstPart);
  let headword = hw.headword;
  if (!headword) return [];

  // Now parse the translate field as: class[,class]; [plural class;] [cases] [translation]
  // Strip unmatched closing parens from the translate field
  const transClean = translateRaw.replace(/\)/g, "").trim();
  const transSemiParts = transClean
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  let nounClass: string | undefined = hw.nounClass;
  let nounClassPlural: string | undefined;
  const grammar: GrammarInfo = {};
  let russianTranslation = "";

  for (let i = 0; i < transSemiParts.length; i++) {
    const part = transSemiParts[i];

    // First segment: class marker(s) — "д" or "в,ю" or "д,д" or "д,допыт"
    if (i === 0) {
      // Handle "д,допыт" — class stuck to translation
      const stuckMatch = part.match(
        /^([бвдйю])(?:\s*,\s*([бвдйю]))?\s*,?\s*([а-яёА-ЯЁӀ1ӏ].+)?$/,
      );
      if (stuckMatch) {
        const cls1 = stuckMatch[1];
        const cls2 = stuckMatch[2];
        if (cls2) {
          nounClass = parseClassString(`${cls1},${cls2}`);
          nounClassPlural = nounClass;
        } else if (!nounClass) {
          nounClass = expandClass(cls1);
        }
        if (stuckMatch[3]) {
          russianTranslation = stuckMatch[3].trim();
        }
      }
      continue;
    }

    // Remaining segments: try plural, cases, then extract Russian translation
    const pluralAndCases = tryParsePluralSegment(part, headword);
    if (pluralAndCases && !grammar.plural) {
      grammar.plural = pluralAndCases.plural;
      if (pluralAndCases.pluralClass) {
        grammar.pluralClass = pluralAndCases.pluralClass;
        nounClassPlural = pluralAndCases.pluralClass;
      }
      if (pluralAndCases.cases) {
        Object.assign(grammar, pluralAndCases.cases);
      }
      continue;
    }

    const cases = tryParseCasesFromTranslate(part);
    if (cases) {
      if (cases.grammar && !grammar.genitive) {
        Object.assign(grammar, cases.grammar);
      }
      if (cases.russianTail) {
        russianTranslation = russianTranslation || cases.russianTail;
      }
      continue;
    }

    // If it doesn't look like grammar, it's part of the translation
    if (!russianTranslation && /[а-яА-ЯёЁ]/.test(part)) {
      russianTranslation = part;
    }
  }

  // Clean translation
  russianTranslation = russianTranslation
    .replace(/^\d+\.\s*/, "")
    .replace(/[;,]\s*$/, "")
    .trim();

  const entry: ParsedEntry = {
    word: headword,
    nounClass,
    nounClassPlural: nounClassPlural ?? grammar.pluralClass,
    meanings: russianTranslation ? [{ translation: russianTranslation }] : [],
    domain: "law",
  };

  if (!entry.nounClassPlural) delete entry.nounClassPlural;
  cleanGrammarFields(grammar);
  if (Object.keys(grammar).length > 0) entry.grammar = grammar;
  if (subEntries.length > 0) {
    entry.phraseology = subEntries.map((se) => ({
      nah: se.nah,
      ru: se.ru,
    }));
  }

  return [entry];
}

/**
 * Try to parse cases from a translate segment that may end with Russian text.
 *
 * Patterns:
 *   "зеран, зерана, зеро, зере 1. испытание 2. проверка"
 *   "бохамхочун, бохамхочунна, бохамхочо, бохамхочуьнга потерпевший"
 *   "оппозицин, оппозицина, оппозицино оппозицига оппозиция"
 *   "риторикин, риторикина, риторико риторике риторика"
 *
 * Case forms may be separated by commas OR spaces (when commas are missing).
 * Russian translation follows after the last case form.
 */
function tryParseCasesFromTranslate(
  part: string,
): { grammar?: Partial<GrammarInfo>; russianTail?: string } | null {
  const stripped = part.replace(/,\s*$/, "").trim();

  // First, normalize: split by comma, but also handle comma-less segments
  // by further splitting individual parts by spaces.
  const commaParts = stripped
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (commaParts.length < 2) return null;

  // Flatten: for each comma-part, if it has spaces, it may contain multiple
  // case forms and/or a Russian tail.
  const tokens: string[] = [];
  for (const cp of commaParts) {
    const words = cp.split(/\s+/);
    tokens.push(...words);
  }

  if (tokens.length < 3) return null;

  // Walk tokens: case forms are single Chechen words that share a root
  // The Russian translation starts when we hit a numbered item or a word
  // that doesn't share the root of the first token.
  const rootPrefix = tokens[0].slice(0, Math.min(3, tokens[0].length));
  const caseWords: string[] = [];
  let russianTail = "";

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // Russian detection: starts with digit
    if (/^\d/.test(t)) {
      russianTail = tokens.slice(i).join(" ");
      break;
    }

    // Check if this token shares the root prefix (case form of same word)
    // Allow slight variations (Chechen ablaut) — check first 2 chars
    const shareRoot =
      t.length > 1 &&
      (t.startsWith(rootPrefix.slice(0, 2)) ||
        (i < 4 && !CLS_LETTER.test(t)));

    if (shareRoot && caseWords.length < 4) {
      caseWords.push(t);
    } else {
      // This token doesn't share root — it's likely Russian translation
      russianTail = tokens.slice(i).join(" ");
      break;
    }
  }

  if (caseWords.length < 3) return null;

  const grammar = parseCasesList(caseWords.join(", "));
  return { grammar, russianTail: russianTail || undefined };
}

/**
 * Parse the first part when there are no semicolons.
 */
function parseFirstPartNoSemicolons(text: string): {
  headword: string;
  nounClass?: string;
  nounClassPlural?: string;
  grammar?: GrammarInfo;
} {
  // Pattern 1: class pair at end "бакъ-агӀо ю,ю" or "арахьарачу гӀуллакхийн министр в,ю,б"
  const classPairMatch = text.match(
    /^(.+?)\s+([бвдйю])\s*(?:,\s*([бвдйю]))+\s*$/,
  );
  if (classPairMatch) {
    const headword = text.replace(CLASS_PAIR_END_RE, "").trim();
    const classStr = text.substring(headword.length).trim();
    const classLetters = classStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (
      classLetters.length >= 2 &&
      classLetters.every((l) => CLS_LETTER.test(l))
    ) {
      const singCls = expandClass(classLetters[0]);
      if (classLetters.length === 2 && classLetters[0] === classLetters[1]) {
        return { headword, nounClass: singCls, nounClassPlural: singCls };
      } else if (classLetters.length === 2) {
        const plCls = expandClass(classLetters[1]);
        return { headword, nounClass: singCls, nounClassPlural: plCls };
      } else {
        const cls = parseClassString(classStr);
        return { headword, nounClass: cls };
      }
    }
  }

  // Pattern 2: word + class + space/comma + case-forms
  const classAndCasesMatch = text.match(
    /^(.+?)\s+([бвдйю])\s*[,\s]\s*([^,]+(?:,\s*[^,]+){2,})\s*,?\s*$/,
  );
  if (classAndCasesMatch) {
    const headword = classAndCasesMatch[1].trim();
    const restParts = classAndCasesMatch[3]
      .replace(/,\s*$/, "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (restParts.length >= 3 && restParts.every((p) => p.length > 1)) {
      const cls = expandClass(classAndCasesMatch[2]);
      const cases = parseCasesList(restParts.join(", "));
      return { headword, nounClass: cls, grammar: cases };
    }
  }

  // Pattern 3: "адаман дикалла ю" — simple trailing class
  const simpleClassMatch = text.match(/^(.+?)\s+([бвдйю])\s*$/);
  if (simpleClassMatch) {
    const headword = simpleClassMatch[1].trim();
    const cls = expandClass(simpleClassMatch[2]);
    return { headword, nounClass: cls };
  }

  // Pattern 4: fallback
  const hw = extractHeadwordAndClass(text);
  return { headword: hw.headword, nounClass: hw.nounClass };
}

/**
 * Try to parse a semicolon segment as a plural form, possibly mixed with cases.
 * Now validates that the plural word shares a root with the headword.
 */
function tryParsePluralSegment(
  part: string,
  headword: string,
): {
  plural: string;
  pluralClass?: string;
  cases?: Partial<GrammarInfo>;
} | null {
  // Pattern B: "алогизмаш ю, алогизман, алогизмана, алогизмо,"
  const mixedMatch = part.match(/^(.+?)\s+([бвдйю])\s*,\s*(.+)$/);
  if (mixedMatch) {
    const pluralWord = mixedMatch[1].trim();
    const pluralClassLetter = mixedMatch[2];
    const restStr = mixedMatch[3].trim().replace(/,\s*$/, "");

    const caseParts = restStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (
      caseParts.length >= 2 &&
      caseParts.every((p) => p.length > 1 && !CLS_LETTER.test(p)) &&
      looksLikePlural(pluralWord, headword)
    ) {
      const plCls = expandClass(pluralClassLetter);
      const cases = parseCasesList(caseParts.join(", "));
      return { plural: pluralWord, pluralClass: plCls, cases };
    }
  }

  // Pattern A: "адвокаташ б" — pure plural
  const simpleMatch = part.match(/^(.+?)\s+([бвдйю])\s*$/);
  if (simpleMatch) {
    const pluralWord = simpleMatch[1].trim();
    if (looksLikePlural(pluralWord, headword)) {
      const plCls = expandClass(simpleMatch[2]);
      return { plural: pluralWord, pluralClass: plCls };
    }
  }

  return null;
}

/**
 * Check if a word looks like a plural form of the headword.
 * Chechen plurals typically share the first 2+ letters with the singular.
 * Exceptions: suppletive plurals like стаг→нах, which we allow if short.
 */
function looksLikePlural(plural: string, headword: string): boolean {
  if (!plural || !headword) return false;

  // Single-word plural check
  const plFirst = plural.split(" ")[0];
  const hwFirst = headword.split(" ")[0];

  // Share at least first 2 characters
  const minLen = Math.min(plFirst.length, hwFirst.length, 2);
  if (plFirst.slice(0, minLen) === hwFirst.slice(0, minLen)) return true;

  // Known suppletive pairs
  if (hwFirst === "стаг" && plFirst === "нах") return true;
  if (hwFirst === "зуда" && plFirst === "зударий") return true;

  // Short words (≤4 chars) may have vowel alternation
  if (hwFirst.length <= 4 && plFirst.length <= 6) {
    // Check if at least first character matches
    if (plFirst[0] === hwFirst[0]) return true;
  }

  return false;
}

/**
 * Try to parse a semicolon segment as case forms.
 * Now handles period as separator: "адамаллина. адамалло" → split on "." too
 */
function tryParseCases(part: string): Partial<GrammarInfo> | null {
  // Replace period followed by space/letter with comma (data typo)
  const normalized = part.replace(/\.\s+/g, ", ");
  const stripped = normalized.replace(/,\s*$/, "");
  const commaParts = stripped
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (commaParts.length >= 3 && commaParts.length <= 5) {
    const looksLikeCases = commaParts.every(
      (p) => p.length > 1 && !CLS_LETTER.test(p),
    );
    if (looksLikeCases) {
      return parseCasesList(commaParts.join(", "));
    }
  }
  return null;
}

/** Parse a comma-separated list of case forms into grammar fields */
function parseCasesList(casesStr: string): Partial<GrammarInfo> {
  const parts = casesStr
    .replace(/,\s*$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const cases: Partial<GrammarInfo> = {};
  if (parts[0]) cases.genitive = parts[0];
  if (parts[1]) cases.dative = parts[1];
  if (parts[2]) cases.ergative = parts[2];
  if (parts[3]) cases.instrumental = parts[3];
  return cases;
}

/**
 * Clean grammar fields: remove trailing markers, numbering, Russian text.
 * - "айкхалле уст." → "айкхалле"
 * - "бакъ Ӏедале 1.истинный закон" → "бакъ Ӏедале"
 * - "методике методика расследования а" → "методике"
 */
function cleanGrammarFields(grammar: GrammarInfo): void {
  const fields: (keyof GrammarInfo)[] = [
    "genitive",
    "dative",
    "ergative",
    "instrumental",
  ];
  for (const field of fields) {
    const val = grammar[field];
    if (typeof val !== "string") continue;
    let cleaned = val;
    // Remove trailing "уст." and similar markers
    cleaned = cleaned.replace(/\s+уст\.?\s*$/, "").trim();
    // Remove numbered definitions: "1.текст" or "1. текст"
    cleaned = cleaned.replace(/\s+\d+\..*$/, "").trim();
    // Remove Russian text after the Chechen case form
    // A case form is typically one word; if there's more, trim to first word only
    // But some case forms have hyphens: "бакъ-Ӏедале"
    // Heuristic: if the cleaned form has 3+ space-separated tokens, keep only the first
    const tokens = cleaned.split(/\s+/);
    if (tokens.length >= 3) {
      // Check if the second token looks like a new word (Russian or another entry)
      // Keep first 1-2 tokens that look like part of the same word (hyphenated or Chechen)
      cleaned = tokens[0];
      if (tokens[1] && /^[ӀӏӀа-яёА-ЯЁ]/.test(tokens[1]) && tokens[1].length <= 2) {
        // Short particle — might be part of the form
      }
    }
    (grammar as any)[field] = cleaned;
  }
}

/**
 * Tries to parse a semicolon segment as a sub-entry (Chechen phrase + Russian translation).
 */
function tryParseSubEntry(
  part: string,
): { nah: string; ru: string } | null {
  // Pattern: chechen_phrase class,class russian_translation
  const m = part.match(/^(.+?)\s+([бвдйю])\s*,\s*([бвдйю])\s+(.+)$/);
  if (m) {
    const nah = m[1].trim();
    const ru = m[4].trim();
    if (nah && ru) return { nah, ru };
  }

  // Pattern with parenthetical text after class-pair
  const mBracket = part.match(
    /^(.+?)\s+([бвдйю])\s*,\s*([бвдйю])\s*(?:\([^)]*\)\s*)?(.+)$/,
  );
  if (mBracket) {
    const nah = mBracket[1].trim();
    const ru = mBracket[4].trim();
    if (nah && ru) return { nah, ru };
  }

  // Sub-entries without class markers but with obvious Russian text
  const ruWordsRe =
    /\s+(стороны|договор|право|свидетельство|закон|ответственность|наказание|суд(?:еб|опр)?|дело|преступ|процесс|форма|порядок|производство|привлечение|задержание|обвинить|операция|взыскание|жалоба|кассационная|частная|оппозиция|отношения|восстановление|исполнение|неправильности|неповиновение|непокорный|строптивый|характер|удачливый|неудачливый|правосторонний|левосторонний|денежный|наложенным|наличный|расчет|представительство|осужденный|заключенный|потерпевший|арестованный|следователь|заказчик|потребитель|инфекционная|обвинить|примерение|должностные|злоупотребление|возмещение)\b/i;
  const ruMatch = part.match(ruWordsRe);
  if (ruMatch && ruMatch.index) {
    const nah = part.substring(0, ruMatch.index).trim();
    const ru = part.substring(ruMatch.index).trim();
    if (nah && ru) return { nah, ru };
  }

  return null;
}

// ---------------------------------------------------------------------------
// RU→CE
// ---------------------------------------------------------------------------

/**
 * RU→CE: word = русский термин, translate = чеченский перевод.
 *
 * If the translate field contains multiple Chechen synonyms separated by ";",
 * each synonym becomes a separate ParsedEntry.
 *
 * If the translate field contains sub-entries (Russian phrase + Chechen translation),
 * they go into phraseology of the first entry.
 */
function parseRuCeEntry(raw: RawDictEntry): ParsedEntry[] {
  const russianWord = cleanText(raw.word ?? "");
  const translateRaw = cleanText(raw.translate ?? "");
  if (!russianWord || !translateRaw) return [];

  // Normalize: replace ";" between single class letters with ","
  // e.g. "хьаькам в;ю;б" → "хьаькам в,ю,б"
  const normalized = translateRaw.replace(
    /\b([бвдйю])\s*;\s*([бвдйю])\b/g,
    "$1,$2",
  );

  // Strip parentheticals for splitting, but keep original for class extraction
  const noParens = normalized
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const semiParts = noParens
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  // Classify each semicolon-separated segment:
  // - "synonym": a standalone Chechen word/phrase + optional class (no Russian text)
  // - "sub-entry": a Russian phrase followed by a Chechen translation
  const synonymSegments: string[] = [];
  const subEntrySegments: string[] = [];

  for (const seg of semiParts) {
    if (isChechenOnlySegment(seg)) {
      synonymSegments.push(seg);
    } else {
      subEntrySegments.push(seg);
    }
  }

  // Build entries from synonym segments
  const entries: ParsedEntry[] = [];
  for (const seg of synonymSegments) {
    const { headword, nounClass } = extractChechenFromTranslate(seg);
    if (!headword) continue;
    entries.push({
      word: headword,
      nounClass,
      meanings: [{ translation: russianWord }],
      domain: "law",
    });
  }

  // If no entries were created, try extracting from the full translate field
  if (entries.length === 0) {
    const { headword, nounClass } =
      extractChechenFromTranslate(normalized);
    if (!headword) return [];
    entries.push({
      word: headword,
      nounClass,
      meanings: [{ translation: russianWord }],
      domain: "law",
    });
  }

  // Parse sub-entries as phraseology on the first entry
  if (subEntrySegments.length > 0 && entries.length > 0) {
    const phraseology: Phrase[] = [];
    for (const seg of subEntrySegments) {
      const sub = parseRuCeSubEntry(seg, russianWord);
      if (sub) phraseology.push(sub);
    }
    if (phraseology.length > 0) entries[0].phraseology = phraseology;
  }

  // Clean up nounClass on all entries
  for (const entry of entries) {
    if (!entry.nounClass) delete entry.nounClass;
  }

  return entries;
}

/**
 * Check if a segment contains only Chechen text (no Russian phrases).
 * Chechen-only segments are synonyms of the headword.
 *
 * A segment is "Chechen only" if EVERY word in it is Chechen or ambiguous.
 * If it contains a mix of Chechen-marker words AND plain-Cyrillic words,
 * it's a sub-entry (Russian phrase + Chechen translation).
 */
function isChechenOnlySegment(seg: string): boolean {
  // Strip trailing class markers
  const stripped = seg.replace(/\s+[бвдйю](?:\s*,\s*[бвдйю])*\s*$/, "").trim();
  const words = stripped.split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;

  // Single word: always a synonym
  if (words.length === 1) return true;

  // Count Chechen-marked vs ambiguous words
  let chechenCount = 0;
  let ambiguousCount = 0;
  for (const w of words) {
    if (looksChechen(w)) {
      chechenCount++;
    } else {
      ambiguousCount++;
    }
  }

  // ALL words have Chechen markers → definitely Chechen-only synonym
  if (ambiguousCount === 0) return true;

  // Short mixed segments (≤ 3 words): if at least one word is Chechen,
  // treat as Chechen synonym. A sub-entry needs enough words for both
  // a Russian phrase and a Chechen translation (typically 4+ words total).
  if (chechenCount > 0 && words.length <= 3) return true;

  // Longer mixed: some Chechen + some ambiguous → likely a sub-entry (Russian + Chechen)
  if (chechenCount > 0 && ambiguousCount > 0) return false;

  // NO Chechen markers, short (≤ 3 words) → likely Chechen synonym
  // (many Chechen legal terms use borrowed Russian roots without special chars)
  if (chechenCount === 0 && words.length <= 3) return true;

  // All ambiguous, 4+ words → likely a sub-entry
  return false;
}

/**
 * Extract Chechen word and class from the beginning of ru_ce translate field.
 *
 * The translate field may contain:
 *   "хьукме жоьпалла д" → simple: headword + class
 *   "автор (кхоллархо, хӀотторхо в,ю,б) авторский договор..." → class inside parens
 *   "симулянт в,ю,б цомгашхиларан..." → class after first word
 *   "конституци ю,ю (къоман барт; ...)" → class pair + parens
 */
function extractChechenFromTranslate(text: string): {
  headword: string;
  nounClass?: string;
} {
  // Try to extract class from parenthetical content BEFORE stripping.
  // Pattern: "word (synonym class)" → extract class from first parens with class markers
  let classFromParens: string | undefined;
  const parenClassMatch = text.match(
    /^([^(;]+?)\s+\([^)]*\s+([бвдйю](?:\s*,\s*[бвдйю])*)\s*\)/,
  );
  if (parenClassMatch) {
    classFromParens = parseClassString(parenClassMatch[2]);
  }

  // Strip parentheticals
  const noParens = text
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const firstSeg = noParens.split(";")[0].trim();

  // Find the FIRST class marker(s) after the first word(s)
  const firstClassMatch = firstSeg.match(
    /^(.+?)\s+([бвдйю](?:\s*,\s*[бвдйю])*)(?:\s|$)/,
  );

  // If we found class from parenthetical AND firstClassMatch yields a longer headword,
  // prefer the paren-based extraction (shorter headword is more likely correct).
  if (classFromParens && parenClassMatch) {
    const parenHeadword = parenClassMatch[1].trim();
    if (
      !firstClassMatch ||
      firstClassMatch[1].trim().length > parenHeadword.length + 5
    ) {
      return { headword: parenHeadword, nounClass: classFromParens };
    }
  }

  if (firstClassMatch) {
    const headword = firstClassMatch[1].trim();
    const classRaw = firstClassMatch[2].trim();
    const cls = parseClassString(classRaw);
    return { headword, nounClass: cls };
  }

  // If we found class from parenthetical only
  if (classFromParens && parenClassMatch) {
    const headword = parenClassMatch[1].trim();
    return { headword, nounClass: classFromParens };
  }

  // No class markers — return firstSeg as headword
  return { headword: firstSeg || noParens };
}

/**
 * Parse a ru_ce sub-entry from semicolon-separated part.
 * Splits Russian phrase and Chechen translation.
 *
 * Patterns:
 *   "администрация президента президентан администраци ю" →
 *     ru: "администрация президента", nah: "президентан администраци"
 *
 *   "авторское право авторан бакъо ю" →
 *     ru: "авторское право", nah: "авторан бакъо"
 *
 *   "арест административный хьукме лацар" →
 *     ru: "арест административный", nah: "хьукме лацар"
 *
 * The structure is always: [Russian phrase] [Chechen translation] [optional class].
 * The number of Russian words equals the number of Chechen words (both describe
 * the same concept). We use multiple strategies to find the boundary.
 */
function parseRuCeSubEntry(text: string, parentRuWord: string): Phrase | null {
  if (!text) return null;

  // Strip trailing class marker: "низаман жоьпалла д" → "низаман жоьпалла"
  const cleaned = text.replace(/\s+[бвдйю](?:\s*,\s*[бвдйю])*\s*$/, "").trim();
  const words = cleaned.split(/\s+/);
  if (words.length === 0) return null;

  // Strategy 1: find the first word that is definitely Chechen (forward scan)
  let boundary = -1;
  for (let i = 0; i < words.length; i++) {
    if (looksChechen(words[i])) {
      boundary = i;
      break;
    }
  }
  if (boundary > 0) {
    const ru = words.slice(0, boundary).join(" ");
    const nah = words.slice(boundary).join(" ");
    if (ru && nah) return { nah, ru };
  }

  // Strategy 2: find the last Chechen word (reverse scan) and walk backwards
  // to find start of Chechen sequence
  let revBoundary = -1;
  for (let i = words.length - 1; i >= 0; i--) {
    if (looksChechen(words[i])) {
      revBoundary = i;
      // Continue walking backwards to find start of Chechen sequence
    } else {
      break;
    }
  }
  if (revBoundary > 0) {
    const ru = words.slice(0, revBoundary).join(" ");
    const nah = words.slice(revBoundary).join(" ");
    if (ru && nah) return { nah, ru };
  }

  // Strategy 3: use parentRuWord to anchor the Russian part.
  // Sub-entries often start with parentRuWord or a phrase containing it.
  // The Russian part typically occupies the first half of the words.
  if (parentRuWord && words.length >= 2) {
    const parentLower = parentRuWord.toLowerCase();
    // Check if the text starts with or contains the parent word
    const cleanedLower = cleaned.toLowerCase();
    if (cleanedLower.startsWith(parentLower) || cleanedLower.includes(parentLower)) {
      // Russian phrase is typically half the words (since both languages
      // describe the same concept, word counts are roughly equal)
      const mid = Math.ceil(words.length / 2);
      const ru = words.slice(0, mid).join(" ");
      const nah = words.slice(mid).join(" ");
      if (ru && nah) return { nah, ru };
    }
  }

  // No split possible — store whole text as nah
  return { nah: cleaned, ru: "" };
}

/**
 * Determines if a word looks Chechen rather than Russian.
 *
 * Chechen-specific indicators:
 * - Contains Ӏ (palochka) or ӏ
 * - Contains Chechen vowel digraphs: аь, оь, уь, еь, юь
 * - Contains digraphs specific to Chechen: хь, къ, кх, гӀ, дӀ, тӀ, цӀ
 */
function looksChechen(word: string): boolean {
  // Definite Chechen markers
  if (/[Ӏӏ]/.test(word)) return true;
  if (/[аоуеюи]ь/.test(word)) return true;

  // Common Chechen word patterns not found in Russian:
  // - "хь" combination (very common in Chechen: хьа, хьу, хье)
  if (/хь/i.test(word)) return true;
  // - "къ", "кх" (ejective/pharyngeal consonants)
  if (/[кгдтцбп]ъ/i.test(word)) return true;
  if (/кх/i.test(word)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Translation cleaning
// ---------------------------------------------------------------------------

/**
 * Clean the translate field of a ce_ru entry.
 */
function cleanTranslation(raw: string): string {
  let text = raw;

  // Strip trailing semicolons/commas
  text = text.replace(/[;,]\s*$/, "").trim();

  // Strip leading class markers: "в,ю,б насильник" or "д, неправомерный"
  text = text.replace(/^[бвдйю](?:\s*,\s*[бвдйю])*\s+/, "").trim();
  text = text.replace(/^([бвдйю])\s*,\s*/, "").trim();

  // Strip trailing semicolons again
  text = text.replace(/[;,]\s*$/, "").trim();

  return text;
}

/**
 * Parse examples from the translate field.
 */
function parseTranslateExamples(translateRaw: string): Phrase[] {
  const examples: Phrase[] = [];
  const cleaned = translateRaw.replace(/[;,]\s*$/, "").trim();

  // Check for sub-entries with class-pair markers in translate
  const re = /;\s*(.+?)\s+([бвдйю])\s*,\s*([бвдйю])\s+(.+?)(?=;|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const nah = m[1].trim();
    const ru = m[4].trim();
    if (nah && ru) {
      examples.push({ nah, ru });
    }
  }

  return examples;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip etymology notes like (фр.), (лат.), etc. */
function stripEtymology(text: string): { text: string; etymology?: string } {
  const m = text.match(
    /\s*\((фр\.|лат\.|гр\.|араб\.|Ӏаьрб\.|англ\.|нем\.|итал\.|исп\.|перс\.|тур\.)[^)]*\)\s*/,
  );
  if (m) {
    return {
      text: text.replace(m[0], " ").replace(/\s+/g, " ").trim(),
      etymology: m[1],
    };
  }
  return { text };
}

/** Strip parenthetical notes */
function stripParenthetical(text: string): string {
  return text
    .replace(/\s*\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract headword and noun class from a string.
 */
function extractHeadwordAndClass(text: string): {
  headword: string;
  nounClass?: string;
} {
  const commaParts = text.split(",");
  let firstPart = commaParts[0].trim();

  // Handle "адвокат в, ю" where class spans across comma
  if (
    commaParts.length >= 2 &&
    /\s+[бвдйю]\s*$/.test(firstPart) &&
    /^\s*[бвдйю]\s*/.test(commaParts[1])
  ) {
    const headMatch = firstPart.match(/^(.+?)\s+([бвдйю])\s*$/);
    if (headMatch) {
      const headword = headMatch[1].trim();
      const classStr =
        headMatch[2] + "," + commaParts[1].trim().match(/^([бвдйю])/)?.[1];
      const cls = parseClassString(classStr);
      return { headword, nounClass: cls };
    }
  }

  // Simple trailing class
  const simpleMatch = firstPart.match(
    /^(.+?)\s+([бвдйю](?:\s*,\s*[бвдйю])*)\s*$/,
  );
  if (simpleMatch) {
    const headword = simpleMatch[1].trim();
    const cls = parseClassString(simpleMatch[2]);
    return { headword, nounClass: cls };
  }

  return { headword: firstPart };
}

/** Parse class string like "в, ю" or "в,ю,б" or "д" → "ву/йу" etc. */
function parseClassString(raw: string): string | undefined {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const expanded = parts.map((p) => expandClass(p)).filter(Boolean) as string[];
  if (expanded.length === 0) return undefined;
  const unique = Array.from(new Set(expanded));
  return unique.join("/");
}
