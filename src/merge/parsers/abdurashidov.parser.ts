import type { GrammarInfo, ParsedEntry, RawDictEntry } from "./types";
import { cleanText, expandClass, stripHtml } from "./utils";

/**
 * Парсер для юридического словаря Абдурашидова (CE↔RU).
 *
 * Формат: пары записей — plain headword + detail entry.
 * Headword: без таба, без HTML, чистое слово.
 * Detail: начинается с \t, содержит HTML-разметку (<b>, <i>), перевод.
 *
 * Файл: abdurashidov_ce_ru_ru_ce.json (отсортирован, без дубликатов).
 */
export function parseAbdurashidovEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const results: ParsedEntry[] = [];
  let pendingHeadword: string | null = null;

  for (const raw of raws) {
    const word = raw.word ?? "";
    const isDetail = word.includes("\t");

    // Plain headword (no tab) — remember for next entry
    if (!isDetail) {
      pendingHeadword = cleanText(word);
      continue;
    }

    // Detail entry — parse and combine with pending headword
    const entries = parseDetail(word, pendingHeadword);
    results.push(...entries);
    pendingHeadword = null;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Парсинг detail-записи
// ---------------------------------------------------------------------------

function parseDetail(raw: string, headword: string | null): ParsedEntry[] {
  // Strip leading whitespace/tabs and trailing \r\n
  const text = raw.replace(/^[\s\t]+/, "").replace(/[\r\n]+$/, "");
  if (!text) return [];

  const hasBold = text.includes("<b>");

  // ── CE→RU: bold entries ──
  // <b><i>class; plural class; gen, dat, erg, instr</i></b>translation
  // <b>phrase <i>class</i></b>translation
  if (hasBold) {
    return parseBoldDetail(text, headword);
  }

  // ── RU→CE: no bold, just Chechen word + <i>class</i> ──
  // e.g. "дехархо <i>в,ю,б</i>" with headword = "ходатай"
  const entry = parseNoBoldDetail(text, headword);
  return entry ? [entry] : [];
}

// ---------------------------------------------------------------------------
// Bold detail: CE→RU entries
// ---------------------------------------------------------------------------

function parseBoldDetail(
  text: string,
  headword: string | null,
): ParsedEntry[] {
  // Split into bold segments: each <b>...</b>translation is a potential entry
  const segments = splitBoldSegments(text);
  if (segments.length === 0) return [];

  const first = segments[0];
  const boldHasItalic = /<i>/.test(first.bold);

  // ── RU→CE pattern: bold has NO <i> inside, and bold content doesn't start
  // with "-" (which would be a Chechen suffix like "-девнехь") ──
  // e.g. headword="министр", bold="<b>юстиции</b>", after="юстицин министр <i>в,ю,б</i>"
  // Bold = Russian qualifier, after = Chechen translation + class
  const firstBoldText = stripHtml(first.bold).trim();
  if (!boldHasItalic && headword && !firstBoldText.startsWith("-")) {
    return parseRuCeBoldDetail(segments, headword);
  }

  // ── CE→RU pattern: bold has <i>grammar</i> inside ──
  const grammarResult = extractGrammarFromItalic(first.bold);
  const classInfo = extractClassFromText(first.bold + first.after);

  const mergedClass = {
    nounClass: grammarResult.classInfo.nounClass || classInfo.nounClass,
    nounClassPlural:
      grammarResult.classInfo.nounClassPlural || classInfo.nounClassPlural,
  };

  let chechenPhrase = extractChechenFromBold(first.bold);

  const word = buildWord(headword, chechenPhrase);
  if (!word) return [];

  let translation = first.after;
  translation = translation.replace(/<i>[^<]*<\/i>/g, "");
  translation = stripHtml(translation);
  translation = cleanText(translation);
  translation = translation.replace(/[;,]\s*$/, "").trim();

  const entry: ParsedEntry = {
    word,
    nounClass: mergedClass.nounClass,
    nounClassPlural: mergedClass.nounClassPlural,
    meanings: translation ? [{ translation }] : [],
    domain: "law",
  };

  if (grammarResult.grammar) entry.grammar = grammarResult.grammar;

  const results: ParsedEntry[] = [entry];

  // Process subsequent bold segments as additional entries
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const subPhrase = extractChechenFromBold(seg.bold);
    const subWord = buildWord(headword, subPhrase);
    if (!subWord) continue;

    let subTranslation = seg.after;
    subTranslation = subTranslation.replace(/<i>[^<]*<\/i>/g, "");
    subTranslation = stripHtml(subTranslation);
    subTranslation = cleanText(subTranslation);
    subTranslation = subTranslation.replace(/[;,]\s*$/, "").trim();

    const subClass = extractClassFromText(seg.bold + seg.after);

    results.push({
      word: subWord,
      nounClass: subClass.nounClass || mergedClass.nounClass,
      nounClassPlural: subClass.nounClassPlural || mergedClass.nounClassPlural,
      meanings: subTranslation ? [{ translation: subTranslation }] : [],
      domain: "law",
    });
  }

  return results;
}

/**
 * Parses RU→CE bold detail entries.
 * Pattern: headword = Russian word, bold = Russian qualifier, after = Chechen translation.
 * e.g. headword="министр", <b>юстиции</b> юстицин министр <i>в,ю,б</i>
 *   → word = "юстицин министр", translation = "министр юстиции"
 */
function parseRuCeBoldDetail(
  segments: { bold: string; after: string }[],
  headword: string,
): ParsedEntry[] {
  const results: ParsedEntry[] = [];

  for (const seg of segments) {
    const qualifier = stripHtml(seg.bold).trim();
    const classInfo = extractClassFromText(seg.after);

    // Chechen word: strip <i>class</i> and HTML from after-text
    let chechenWord = seg.after.replace(/<i>[^<]*<\/i>/g, "");
    chechenWord = stripHtml(chechenWord);
    chechenWord = cleanText(chechenWord);
    // Remove trailing class markers
    chechenWord = chechenWord.replace(/\s+[бвдйю]$/, "");
    chechenWord = chechenWord.replace(/[;,]\s*$/, "").trim();

    if (!chechenWord) continue;

    // Russian translation: headword + qualifier
    const translation = qualifier
      ? `${headword} ${qualifier}`.trim()
      : headword;

    results.push({
      word: chechenWord,
      nounClass: classInfo.nounClass,
      nounClassPlural: classInfo.nounClassPlural,
      meanings: [{ translation }],
      domain: "law",
    });
  }

  return results;
}

/** Splits text into segments of { bold: "<b>...</b>", after: "text before next <b>" } */
function splitBoldSegments(
  text: string,
): { bold: string; after: string }[] {
  const results: { bold: string; after: string }[] = [];
  const re = /<b>[\s\S]*?<\/b>/g;
  let match: RegExpExecArray | null;
  const matches: { start: number; end: number; text: string }[] = [];
  while ((match = re.exec(text)) !== null) {
    matches.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const afterStart = m.end;
    const afterEnd = i + 1 < matches.length ? matches[i + 1].start : text.length;
    results.push({ bold: m.text, after: text.substring(afterStart, afterEnd).trim() });
  }
  return results;
}

function extractChechenFromBold(boldHtml: string): string {
  let phrase = boldHtml;
  // Remove all <i>...</i> blocks (class markers and grammar)
  phrase = phrase.replace(/<i>[^<]*<\/i>/g, "");
  phrase = stripHtml(phrase);
  phrase = cleanText(phrase);
  // Remove leading class letters outside <i>: "в,ю; ..." → "..."
  phrase = phrase.replace(/^[бвдйю]\s*(?:,\s*[бвдйю]\s*)*;\s*/, "");
  // Remove trailing class markers: "таронаш ю" → "таронаш"
  phrase = phrase.replace(/\s+[бвдйю]\s*$/, "");
  // Remove trailing semicolons
  phrase = phrase.replace(/\s*;\s*$/, "");
  return phrase;
}

function buildWord(headword: string | null, chechenPhrase: string): string {
  if (headword && chechenPhrase) {
    if (chechenPhrase.startsWith("-")) {
      return headword + chechenPhrase;
    }
    return headword + " " + chechenPhrase;
  }
  if (chechenPhrase) return chechenPhrase;
  if (headword) return headword;
  return "";
}

// ---------------------------------------------------------------------------
// No-bold detail: RU→CE entries (italic only)
// ---------------------------------------------------------------------------

function parseNoBoldDetail(
  text: string,
  headword: string | null,
): ParsedEntry | null {
  const classInfo = extractClassFromText(text);

  // Chechen word: strip class markers and HTML
  let chechenWord = text.replace(/<i>[^<]*<\/i>/g, "");
  chechenWord = stripHtml(chechenWord);
  chechenWord = cleanText(chechenWord);
  // Remove leading lone class marker: "ю руководство" → "руководство"
  chechenWord = chechenWord.replace(/^[бвдйю]\s+/, "");
  // Remove trailing lone class marker: "таронаш ю" → "таронаш"
  chechenWord = chechenWord.replace(/\s+[бвдйю]$/, "");

  if (!chechenWord) return null;

  // headword is the Russian translation
  const translation = headword || "";

  const entry: ParsedEntry = {
    word: chechenWord,
    nounClass: classInfo.nounClass,
    nounClassPlural: classInfo.nounClassPlural,
    meanings: translation ? [{ translation }] : [],
    domain: "law",
  };

  return entry;
}

// ---------------------------------------------------------------------------
// Class extraction
// ---------------------------------------------------------------------------

/** Matches class markers like "в,ю,б", "д,д", "ю", "в, ю" inside <i> tags */
const CLASS_RE = /<i>\s*([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)\s*<\/i>/g;

function extractClassFromText(text: string): {
  nounClass?: string;
  nounClassPlural?: string;
} {
  let last: string | null = null;
  const re = new RegExp(CLASS_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    last = m[1];
  }
  if (!last) {
    // Try class inside combined italic: <i>в, ю; forms...</i>
    const grammarClassRe = /<i>\s*([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)\s*[;,]/;
    const gm = text.match(grammarClassRe);
    if (gm) last = gm[1];
  }
  if (!last) return {};
  return parseClassMarkers(last);
}

function parseClassMarkers(raw: string): {
  nounClass?: string;
  nounClassPlural?: string;
} {
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
// Grammar extraction from italic blocks
// ---------------------------------------------------------------------------

/**
 * Extracts grammar from italic blocks like:
 * <i>в, ю; арзхой б; арзхочун, арзхочунна, арзхочо, арзхочуьнга</i>
 * <i>ю; белхазаллаш ю; белхазаллин, белхазаллина, белхазалло, белхазалле</i>
 * <i>ю</i>;<i> ерматаллаш ю; ерматаллин, ерматаллина, ерматалло, ерматалле</i>
 */
function extractGrammarFromItalic(text: string): {
  grammar?: GrammarInfo;
  classInfo: { nounClass?: string; nounClassPlural?: string };
} {
  let content: string | null = null;

  // Pattern 1: single italic with semicolons: <i>class; forms</i>
  const singleRe = /<i>\s*([^<]+)\s*<\/i>/;
  const m1 = text.match(singleRe);
  if (m1 && m1[1].includes(";")) {
    content = m1[1].trim();
  }

  // Pattern 2: split italic: <i>class</i>;<i> forms</i>
  if (!content) {
    const splitRe =
      /<i>\s*([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)\s*<\/i>\s*;\s*<i>\s*([^<]+)\s*<\/i>/;
    const m2 = text.match(splitRe);
    if (m2) {
      content = m2[1].trim() + "; " + m2[2].trim();
    }
  }

  if (!content) return { classInfo: {} };

  // Must contain semicolons (grammar forms)
  if (!content.includes(";")) return { classInfo: {} };

  const semiParts = content.split(";").map((p) => p.trim());
  if (semiParts.length < 2) return { classInfo: {} };

  // First part: class markers (e.g. "в, ю" or "ю")
  const classRaw = semiParts[0];
  const classMatch = classRaw.match(/^([бвдйю]\s*(?:,\s*[бвдйю]\s*)*)$/);
  if (!classMatch) return { classInfo: {} };

  const classInfo: { nounClass?: string; nounClassPlural?: string } = {};
  const sgParts = classMatch[1].trim().split(/\s*,\s*/);
  const sgExpanded = sgParts.map((p) => expandClass(p)).filter(Boolean);
  if (sgExpanded.length > 0) {
    classInfo.nounClass = sgExpanded.join("/");
  }

  const grammar: GrammarInfo = {};

  // Second part: plural + class (e.g. "арзхой б") OR case forms directly
  if (semiParts.length >= 2 && semiParts[1]) {
    const pluralPart = semiParts[1].trim();
    const commaForms = pluralPart.split(",").map((f) => f.trim());

    // If second part has 4 comma-separated words and no third part,
    // these are case forms (gen, dat, erg, instr) without plural
    // e.g. "в,ю,б; дуьхьалхочун, дуьхьалхочунна, дуьхьалхочо, дуьхьалхочуьнга"
    if (commaForms.length === 4 && semiParts.length === 2) {
      grammar.genitive = commaForms[0];
      grammar.dative = commaForms[1];
      grammar.ergative = commaForms[2];
      grammar.instrumental = commaForms[3];
    } else {
      const pluralClassMatch = pluralPart.match(/^(.+?)\s+([бвдйю])\s*$/);
      if (pluralClassMatch) {
        grammar.plural = pluralClassMatch[1].trim();
        const plCls = expandClass(pluralClassMatch[2]);
        if (plCls) {
          classInfo.nounClassPlural = plCls;
          grammar.pluralClass = plCls;
        }
      } else if (pluralPart) {
        grammar.plural = pluralPart;
      }
    }
  }

  // Third part: case forms (gen, dat, erg, instr)
  if (semiParts.length >= 3 && semiParts[2]) {
    // Normalize stray dots to commas: "цатакхамо. цатакхаме" → "цатакхамо, цатакхаме"
    const normalized = semiParts[2].replace(/\.\s+/g, ", ");
    const forms = normalized.split(",").map((f) => f.trim());
    if (forms.length >= 1 && forms[0]) grammar.genitive = forms[0];
    if (forms.length >= 2 && forms[1]) grammar.dative = forms[1];
    if (forms.length >= 3 && forms[2]) grammar.ergative = forms[2];
    if (forms.length >= 4 && forms[3]) grammar.instrumental = forms[3];
  }

  const hasGrammar = Object.keys(grammar).length > 0;
  return { grammar: hasGrammar ? grammar : undefined, classInfo };
}
