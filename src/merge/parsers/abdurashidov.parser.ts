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
    const entry = parseDetail(word, pendingHeadword);
    if (entry) results.push(entry);
    pendingHeadword = null;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Парсинг detail-записи
// ---------------------------------------------------------------------------

function parseDetail(raw: string, headword: string | null): ParsedEntry | null {
  // Strip leading whitespace/tabs and trailing \r\n
  const text = raw.replace(/^[\s\t]+/, "").replace(/[\r\n]+$/, "");
  if (!text) return null;

  const hasBold = text.includes("<b>");

  // ── CE→RU: bold entries ──
  // <b><i>class; plural class; gen, dat, erg, instr</i></b>translation
  // <b>phrase <i>class</i></b>translation
  if (hasBold) {
    return parseBoldDetail(text, headword);
  }

  // ── RU→CE: no bold, just Chechen word + <i>class</i> ──
  // e.g. "дехархо <i>в,ю,б</i>" with headword = "ходатай"
  return parseNoBoldDetail(text, headword);
}

// ---------------------------------------------------------------------------
// Bold detail: CE→RU entries
// ---------------------------------------------------------------------------

function parseBoldDetail(
  text: string,
  headword: string | null,
): ParsedEntry | null {
  const lastBoldEnd = text.lastIndexOf("</b>");
  if (lastBoldEnd === -1) return null;

  const boldPart = text.substring(0, lastBoldEnd + 4);
  const afterBold = text.substring(lastBoldEnd + 4).trim();

  // Extract grammar from italic blocks inside bold
  const grammarResult = extractGrammarFromItalic(boldPart);
  const classInfo = extractClassFromText(boldPart + afterBold);

  // Merge class info: grammar extraction may find plural class
  const mergedClass = {
    nounClass: grammarResult.classInfo.nounClass || classInfo.nounClass,
    nounClassPlural:
      grammarResult.classInfo.nounClassPlural || classInfo.nounClassPlural,
  };

  // Extract the Chechen phrase from bold (strip class markers and grammar)
  let chechenPhrase = boldPart;
  // Remove all <i>...</i> blocks (class markers and grammar)
  chechenPhrase = chechenPhrase.replace(/<i>[^<]*<\/i>/g, "");
  chechenPhrase = stripHtml(chechenPhrase);
  chechenPhrase = cleanText(chechenPhrase);
  // Remove leading class letters outside <i>: "в,ю; ..." → "..."
  chechenPhrase = chechenPhrase.replace(
    /^[бвдйю]\s*(?:,\s*[бвдйю]\s*)*;\s*/,
    "",
  );
  // Remove trailing semicolons left after stripping <i> blocks
  chechenPhrase = chechenPhrase.replace(/\s*;\s*$/, "");

  // Build the word: headword + phrase from bold
  let word = "";
  if (headword && chechenPhrase) {
    // If phrase starts with "-", concatenate directly: бакъ + -пачхьалкхана = бакъ-пачхьалкхана
    if (chechenPhrase.startsWith("-")) {
      word = headword + chechenPhrase;
    } else {
      word = headword + " " + chechenPhrase;
    }
  } else if (chechenPhrase) {
    word = chechenPhrase;
  } else if (headword) {
    word = headword;
  }

  if (!word) return null;

  // Russian translation: after </b>, strip any remaining <i>class</i> and HTML
  let translation = afterBold;
  translation = translation.replace(/<i>[^<]*<\/i>/g, "");
  translation = stripHtml(translation);
  translation = cleanText(translation);

  const entry: ParsedEntry = {
    word,
    nounClass: mergedClass.nounClass,
    nounClassPlural: mergedClass.nounClassPlural,
    meanings: translation ? [{ translation }] : [],
    domain: "law",
  };

  if (grammarResult.grammar) entry.grammar = grammarResult.grammar;

  return entry;
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

  // Second part: plural + class (e.g. "арзхой б")
  if (semiParts.length >= 2 && semiParts[1]) {
    const pluralPart = semiParts[1].trim();
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

  // Third part: case forms (gen, dat, erg, instr)
  if (semiParts.length >= 3 && semiParts[2]) {
    const forms = semiParts[2].split(",").map((f) => f.trim());
    if (forms.length >= 1 && forms[0]) grammar.genitive = forms[0];
    if (forms.length >= 2 && forms[1]) grammar.dative = forms[1];
    if (forms.length >= 3 && forms[2]) grammar.ergative = forms[2];
    if (forms.length >= 4 && forms[3]) grammar.instrumental = forms[3];
  }

  const hasGrammar = Object.keys(grammar).length > 0;
  return { grammar: hasGrammar ? grammar : undefined, classInfo };
}
