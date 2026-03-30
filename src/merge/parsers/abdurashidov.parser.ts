import type { GrammarInfo, ParsedEntry, RawDictEntry } from "./types";
import { cleanText, dedup, expandClass, stripHtml } from "./utils";

/**
 * Парсер для юридического словаря Абдурашидова (CE↔RU).
 *
 * Особенность: 99% записей имеют пустое поле `translate`.
 * Данные упакованы в поле `word` с HTML-разметкой.
 *
 * Типы записей:
 * - Простые слова (без HTML) — заголовки, пропускаем
 * - Pattern A (CE→RU): `<b>Chechen phrase <i>class</i> </b>Russian translation`
 * - Pattern B (grammar): `<b><i>class; forms...</i></b>Russian translation`
 * - Pattern C: `word <i>class</i>` — чеченское слово с классом, без перевода
 * - 18 записей с непустым translate — RU→CE напрямую
 */
export function parseAbdurashidovEntries(
  raws: RawDictEntry[],
): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const entry = parseOne(raw);
    if (entry) results.push(entry);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Маппинг классов
// ---------------------------------------------------------------------------

/** "д,д" → { nounClass: "ду", nounClassPlural: "ду" }
 *  "в,ю,б" → { nounClass: "ву/йу", nounClassPlural: "бу" }
 *  "в, ю" → { nounClass: "ву", nounClassPlural: "йу" }   (singular, plural)
 *  "д" → { nounClass: "ду" }
 */
function parseClassMarkers(
  raw: string,
): { nounClass?: string; nounClassPlural?: string } {
  const cleaned = raw.replace(/[()]/g, "").trim();
  const parts = cleaned.split(/\s*,\s*/);

  if (parts.length === 1) {
    const cls = expandClass(parts[0]);
    return cls ? { nounClass: cls } : {};
  }

  if (parts.length === 2) {
    const sg = expandClass(parts[0]);
    const pl = expandClass(parts[1]);
    return {
      nounClass: sg || undefined,
      nounClassPlural: pl || undefined,
    };
  }

  if (parts.length === 3) {
    const m = expandClass(parts[0]);
    const f = expandClass(parts[1]);
    const pl = expandClass(parts[2]);
    return {
      nounClass: m && f ? `${m}/${f}` : m || f || undefined,
      nounClassPlural: pl || undefined,
    };
  }

  return {};
}

// ---------------------------------------------------------------------------
// Class extraction
// ---------------------------------------------------------------------------

/** Matches standalone class markers: `<i>д,д</i>`, `<i>ю</i>`, `<i>в,ю,б</i>` */
const CLASS_STANDALONE_RE =
  /<i>\s*([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)\s*<\/i>/g;

/**
 * Matches italic blocks that START with a class marker followed by semicolons
 * (grammar forms): `<i>д; формы...</i>`, `<i>в,ю; формы...</i>`
 */
const CLASS_GRAMMAR_RE =
  /<i>\s*([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)\s*;[^<]*<\/i>/g;

/**
 * Matches italic blocks where class is followed by comma+space+word (grammar),
 * NOT another class letter: `<i>д, васташ д; forms...</i>`
 */
const CLASS_COMMA_GRAMMAR_RE =
  /<i>\s*([бвдйю])\s*,\s+[^бвдйю<][^<]*<\/i>/;

/**
 * Matches class markers OUTSIDE italic but inside bold:
 * `<b>в,ю;<i> forms...</i></b>` — class letters before the semicolon+italic
 */
const CLASS_BOLD_OUTSIDE_RE =
  /<b>\s*([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)\s*;\s*<i>/;

/**
 * Matches italic blocks that start with `(лат.)` followed by class:
 * `<i>(лат.) ю ...</i>`
 */
const CLASS_LAT_RE = /<i>\s*\(лат\.\)\s+([бвдйю])\s*/;

function extractClassFromText(
  text: string,
): { nounClass?: string; nounClassPlural?: string } {
  // Try standalone class markers first (most common)
  let last: string | null = null;
  let m: RegExpExecArray | null;

  const re1 = new RegExp(CLASS_STANDALONE_RE.source, "g");
  while ((m = re1.exec(text)) !== null) {
    last = m[1];
  }
  if (last) return parseClassMarkers(last);

  // Try class at start of grammar italic block: <i>д; forms...</i>
  const re2 = new RegExp(CLASS_GRAMMAR_RE.source, "g");
  while ((m = re2.exec(text)) !== null) {
    last = m[1];
  }
  if (last) return parseClassMarkers(last);

  // Try class followed by comma+space+word (not another class letter):
  // <i>д, васташ д; forms...</i>
  const commaGrammarMatch = text.match(CLASS_COMMA_GRAMMAR_RE);
  if (commaGrammarMatch) return parseClassMarkers(commaGrammarMatch[1]);

  // Try class outside italic but inside bold: <b>в,ю;<i>forms</i></b>
  const boldOutsideMatch = text.match(CLASS_BOLD_OUTSIDE_RE);
  if (boldOutsideMatch) return parseClassMarkers(boldOutsideMatch[1]);

  // Try (лат.) prefix
  const latMatch = text.match(CLASS_LAT_RE);
  if (latMatch) return parseClassMarkers(latMatch[1]);

  return {};
}

/** Убирает standalone class-маркеры `<i>д,д</i>` из текста */
function stripClassMarkers(text: string): string {
  return text.replace(
    /<i>\s*[бвдйю]\s*(?:,\s*[бвдйю]\s*)*\s*<\/i>/g,
    "",
  );
}

// ---------------------------------------------------------------------------
// Grammar extraction from italic blocks like <i>д; формы д; ...</i>
// ---------------------------------------------------------------------------

/**
 * Detects and extracts grammar from italic blocks like:
 * - `<i>д; дакъалацарш д; дакъалацаран, дакъалацарна, дакъалацаро, дакъалацаре</i>`
 * - `<i>д, васташ д; вастан, вастана, васто, васте</i>`
 * - `<b>в,ю;<i> декъахой б; forms...</i></b>` (class outside italic)
 * Returns the class info and a GrammarInfo object.
 */
function extractGrammarFromItalic(
  text: string,
): { grammar?: GrammarInfo; classInfo: { nounClass?: string; nounClassPlural?: string } } {
  let classRaw: string | undefined;
  let formsText: string | undefined;

  // Pattern 1: <i>class; forms</i>
  const grammarItalicRe =
    /<i>\s*([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)\s*;\s*([^<]*)<\/i>/;
  const m1 = text.match(grammarItalicRe);
  if (m1) {
    classRaw = m1[1];
    formsText = m1[2].trim();
  }

  // Pattern 2: <i>class, word forms; gen, dat, erg, instr</i>
  // e.g. <i>д, васташ д; вастан, вастана, васто, васте</i>
  if (!classRaw) {
    const commaGrammarRe =
      /<i>\s*([бвдйю])\s*,\s+([^<]+)<\/i>/;
    const m2 = text.match(commaGrammarRe);
    if (m2) {
      classRaw = m2[1];
      formsText = m2[2].trim();
    }
  }

  // Pattern 3: <b>class;<i> forms...</i></b> (class outside italic)
  if (!classRaw) {
    const boldOutsideRe =
      /<b>\s*([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)\s*;\s*<i>\s*([^<]*)<\/i>/;
    const m3 = text.match(boldOutsideRe);
    if (m3) {
      classRaw = m3[1];
      formsText = m3[2].trim();
    }
  }

  if (!classRaw || !formsText) return { classInfo: {} };

  const classInfo = parseClassMarkers(classRaw);

  // Parse forms: "дакъалацарш д; дакъалацаран, дакъалацарна, дакъалацаро, дакъалацаре"
  const grammar: GrammarInfo = {};
  const semiParts = formsText.split(";").map((p) => p.trim());

  if (semiParts.length >= 1) {
    // First part: plural + class letter
    const pluralPart = semiParts[0]
      .replace(/\s+[бвдйю]\s*$/, "")
      .trim();
    if (pluralPart) grammar.plural = pluralPart;
  }

  if (semiParts.length >= 2) {
    // Second part: genitive, dative, ergative, instrumental
    const forms = semiParts[1].split(",").map((f) => f.trim());
    if (forms.length >= 1 && forms[0]) grammar.genitive = forms[0];
    if (forms.length >= 2 && forms[1]) grammar.dative = forms[1];
    if (forms.length >= 3 && forms[2]) grammar.ergative = forms[2];
    if (forms.length >= 4 && forms[3]) grammar.instrumental = forms[3];
  }

  const hasGrammar = Object.keys(grammar).length > 0;
  return { grammar: hasGrammar ? grammar : undefined, classInfo };
}

// ---------------------------------------------------------------------------
// Основной парсинг одной записи
// ---------------------------------------------------------------------------

function parseOne(raw: RawDictEntry): ParsedEntry | null {
  const translate = raw.translate
    ?.trim()
    .replace(/\r\n/g, "")
    .replace(/\r/g, "")
    .replace(/\n/g, "");
  const word = raw.word ?? "";

  // ── Entries WITH translate field ──
  if (translate) {
    return parseWithTranslate(raw.word, translate);
  }

  // ── Entries WITHOUT translate (99%) ──
  // Strip leading whitespace + tabs
  const stripped = word
    .replace(/^[\s\t]+/, "")
    .replace(/\r\n$/, "")
    .replace(/\r$/, "")
    .replace(/\n$/, "");

  if (!stripped) return null;

  const hasBold = stripped.includes("<b>");
  const hasItalic = stripped.includes("<i>");

  // Plain headwords (no HTML) — skip
  if (!hasBold && !hasItalic) return null;

  // Pattern C: italic-only, no bold — standalone Chechen word with class
  if (!hasBold && hasItalic) {
    return parseItalicOnly(stripped);
  }

  // Pattern A/B: has bold tags — sub-entry with phrase + translation
  return parseBoldEntry(stripped);
}

// ---------------------------------------------------------------------------
// Parse entries WITH translate field (18 entries, RU→CE)
// ---------------------------------------------------------------------------

function parseWithTranslate(
  rawWord: string,
  translate: string,
): ParsedEntry | null {
  const wordClean = cleanText(stripHtml(rawWord));
  if (!wordClean || wordClean === "1") return null;

  // Special case: translate starts with <b> — it contains Chechen + Russian
  // e.g. word="т1аьххьара", translate="<b>хан <i>ю,ю</i> </b>крайний срок"
  if (translate.includes("<b>")) {
    const lastBoldEnd = translate.lastIndexOf("</b>");
    if (lastBoldEnd !== -1) {
      const chechenPart = translate.substring(0, lastBoldEnd + 4);
      const russianPart = translate.substring(lastBoldEnd + 4);
      const classInfo = extractClassFromText(chechenPart);
      const chechenText = cleanText(stripHtml(stripClassMarkers(chechenPart)));
      const russianText = cleanText(stripHtml(russianPart));

      // word field is the Chechen headword, chechenText is the Chechen sub-word
      const fullWord = wordClean + (chechenText ? " " + chechenText : "");

      return {
        word: fullWord,
        nounClass: classInfo.nounClass,
        nounClassPlural: classInfo.nounClassPlural,
        meanings: russianText ? [{ translation: russianText }] : [],
        domain: "law",
      };
    }
  }

  const classInfo = extractClassFromText(translate);

  // Strip class markers and HTML from translation
  let translationText = stripClassMarkers(translate);
  translationText = stripHtml(translationText);
  translationText = cleanText(translationText);

  if (!translationText) return null;

  return {
    word: wordClean,
    nounClass: classInfo.nounClass,
    nounClassPlural: classInfo.nounClassPlural,
    meanings: [{ translation: translationText }],
    domain: "law",
  };
}

// ---------------------------------------------------------------------------
// Pattern C: italic-only  — "word <i>class</i>"
// ---------------------------------------------------------------------------

function parseItalicOnly(text: string): ParsedEntry | null {
  const classInfo = extractClassFromText(text);
  const wordText = cleanText(stripHtml(stripClassMarkers(text)));
  if (!wordText) return null;

  return {
    word: wordText,
    nounClass: classInfo.nounClass,
    nounClassPlural: classInfo.nounClassPlural,
    meanings: [],
    domain: "law",
  };
}

// ---------------------------------------------------------------------------
// Pattern A/B: bold entries — `<b>...Chechen... </b>Russian translation`
// ---------------------------------------------------------------------------

function parseBoldEntry(text: string): ParsedEntry | null {
  // The LAST `</b>` boundary separates the Chechen part from the Russian
  // translation. Everything before (including all <b>...</b> blocks) is the
  // Chechen phrase/grammar; everything after the last </b> is Russian.

  const lastBoldEnd = text.lastIndexOf("</b>");
  if (lastBoldEnd === -1) return null;

  const chechenRaw = text.substring(0, lastBoldEnd + 4);
  const russianRaw = text.substring(lastBoldEnd + 4);

  // Check for grammar-form italic blocks: <b><i>д; forms...</i></b>
  const { grammar, classInfo: grammarClassInfo } =
    extractGrammarFromItalic(chechenRaw);

  // Also try extracting class from standalone markers
  const standaloneClassInfo = extractClassFromText(chechenRaw);
  const classInfo =
    grammarClassInfo.nounClass ? grammarClassInfo : standaloneClassInfo;

  // Build the Chechen word: strip grammar italic blocks, class markers, and HTML
  let chechenClean = chechenRaw;
  // Remove grammar italic blocks: <i>class; forms...</i>
  chechenClean = chechenClean.replace(
    /<i>\s*[бвдйю]\s*(?:,\s*[бвдйю]\s*)*\s*;[^<]*<\/i>/g,
    "",
  );
  // Remove <i>class, word forms; ...</i> (class + comma + grammar)
  chechenClean = chechenClean.replace(
    /<i>\s*[бвдйю]\s*,\s+[^<]+<\/i>/g,
    "",
  );
  // Remove class prefix outside italic + grammar italic: <b>в,ю;<i>forms</i></b>
  chechenClean = chechenClean.replace(
    /[бвдйю]\s*(?:,\s*[бвдйю]\s*)*\s*;\s*<i>[^<]*<\/i>/g,
    "",
  );
  // Remove <i>(лат.) class ...</i> blocks
  chechenClean = chechenClean.replace(/<i>\s*\(лат\.\)\s+[бвдйю][^<]*<\/i>/g, "");
  // Remove standalone class markers
  chechenClean = stripClassMarkers(chechenClean);
  // Strip all remaining HTML
  chechenClean = stripHtml(chechenClean);
  chechenClean = cleanText(chechenClean);

  // If word is empty but we have grammar, derive word from grammar plural form.
  // e.g. grammar.plural="декъахой" → word is the plural form (base word was in
  // the preceding headword entry which we skipped).
  if (!chechenClean && grammar?.plural) {
    chechenClean = grammar.plural;
  }

  // Build the Russian translation: strip remaining HTML and class markers
  let russianClean = stripClassMarkers(russianRaw);
  russianClean = stripHtml(russianClean);
  russianClean = cleanText(russianClean);

  // If both parts empty, skip
  if (!chechenClean && !russianClean) return null;

  const meanings = russianClean ? [{ translation: russianClean }] : [];

  const entry: ParsedEntry = {
    word: chechenClean || "",
    nounClass: classInfo.nounClass,
    nounClassPlural: classInfo.nounClassPlural,
    meanings,
    domain: "law",
  };

  if (grammar) entry.grammar = grammar;

  // Skip entries with empty word
  if (!entry.word) return null;

  return entry;
}
