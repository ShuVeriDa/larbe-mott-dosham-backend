import type {
  Citation,
  GrammarInfo,
  Meaning,
  ParsedEntry,
  RawDictEntry,
} from "./types";
import {
  cleanText,
  dedup,
  expandClass,
  extractCitationSource,
  extractStyleLabel,
  splitMeanings,
  stripHtml,
} from "./utils";

// -------------------------------------------------------------------------
// Main export
// -------------------------------------------------------------------------

/**
 * Парсер для словаря Байсултанова (baisultanov_ce_ru.json).
 * Чеченско-русский словарь, ~3570 записей, ~1295 уникальных после дедупликации.
 *
 * Формат WORD:
 *   - `Авиакхийсар (-рш)` — слово + суффикс мн.ч. в скобках
 *   - `Анаков (анакевнаш)` — слово + полная форма мн.ч.
 *   - `Айпвола (й, д, б)` — слово + классовые маркеры
 *   - `«Бапп»-аьлла` — слово в кавычках-гильметах
 *   - `1.ГӀов (–наш)` — префикс омонима
 *   - `Ана (-аш: ю-ю)` — суффикс мн.ч. + классовые маркеры
 *
 * Формат TRANSLATE:
 *   - `[StyleLabel.] Определение.<br />Цитата (Автор. Название).`
 *   - Встроенные подстатьи: `<b>Слово.</b> Определение`
 *   - Нумерованные значения: `1.текст 2.текст`
 */
export function parseBaisultanovEntries(
  raws: RawDictEntry[],
): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const entry = parseBaisultanovEntry(raw);
    if (entry) results.push(entry);
  }

  return results;
}

// -------------------------------------------------------------------------
// Single entry parser
// -------------------------------------------------------------------------

function parseBaisultanovEntry(raw: RawDictEntry): ParsedEntry | null {
  const rawWord = raw.word?.trim();
  const rawTranslate = raw.translate?.trim();

  // Entries with empty translate and data in word field (embedded-only entries) — skip
  if (!rawTranslate && rawWord?.startsWith("<b>")) return null;
  // Entries with empty translate and no useful word
  if (!rawTranslate && !rawWord) return null;

  // Some entries have content only in the word field without <b>, but empty translate
  // (e.g. broken entries) — also skip if translate is empty
  if (!rawTranslate) return null;

  // Parse word
  const parsed = parseWord(rawWord ?? "");
  if (!parsed.word) return null;

  // Parse translate
  const translateResult = parseTranslate(rawTranslate);

  return {
    word: parsed.word,
    nounClass: parsed.nounClass,
    grammar: parsed.grammar,
    styleLabel: translateResult.styleLabel,
    meanings: translateResult.meanings,
    citations:
      translateResult.citations.length > 0
        ? translateResult.citations
        : undefined,
    domain: undefined,
  };
}

// -------------------------------------------------------------------------
// WORD parsing
// -------------------------------------------------------------------------

interface ParsedWord {
  word: string;
  nounClass?: string;
  grammar?: GrammarInfo;
}

/** Class marker letters that appear in parentheses */
const CLASS_LETTERS = new Set(["в", "й", "д", "б", "ю"]);

function parseWord(raw: string): ParsedWord {
  let text = raw.trim();

  // Strip numbered homonym prefix: "1.ГӀов" → "ГӀов", "2.Хьаха" → "Хьаха"
  text = text.replace(/^\d+\./, "");

  // Strip guillemets: «Бапп»-аьлла → Бапп-аьлла
  text = text.replace(/[«»]/g, "");

  // Strip leading/trailing quotes
  text = text.replace(/^["']|["']$/g, "").trim();

  // Strip stray leading parenthesis (data error, e.g. "(Цхар (-ш)")
  text = text.replace(/^\((?=[А-ЯЁа-яёӀ])/, "");

  // Extract parenthetical part — find the LAST balanced parenthetical group
  let parenContent: string | undefined;
  const parenMatch = text.match(/^(.+?)\s*\(([^)]*)\)\s*\.?\s*$/);
  if (parenMatch) {
    text = parenMatch[1].trim();
    parenContent = parenMatch[2].trim();
  }

  // Also handle trailing dash or junk
  text = text.replace(/\s*–\s*$/, "").trim();

  const word = cleanText(stripHtml(text));
  if (!word) return { word: "" };

  let nounClass: string | undefined;
  let grammar: GrammarInfo | undefined;

  if (parenContent) {
    const parenResult = parseParenContent(parenContent, word);
    nounClass = parenResult.nounClass;
    grammar = parenResult.grammar;
  }

  return {
    word,
    nounClass,
    grammar: grammar && Object.keys(grammar).length > 0 ? grammar : undefined,
  };
}

/**
 * Парсит содержимое скобок после слова.
 *
 * Паттерны:
 *   - `-рш` → plural suffix (word + suffix)
 *   - `анакевнаш` → full plural form
 *   - `й, д, б` → class markers only
 *   - `-аш: ю-ю` → plural suffix + class markers
 *   - `ю-ю: -аш` → class markers + plural suffix
 *   - `ю-ю: гужош` → class markers + full plural
 *   - `Ӏавдал: аш` → alternate stem + plural suffix
 *   - `аддамана и.кх.д1.` → grammatical note (pass through as-is)
 *   - `гӀовхаш` → full plural form
 *   - `!` → interjection marker, skip
 *   - `гарнехьа` → variant form in parens, skip
 */
function parseParenContent(
  content: string,
  headword: string,
): { nounClass?: string; grammar?: GrammarInfo } {
  let nounClass: string | undefined;
  const grammar: GrammarInfo = {};

  // Strip semicolons — some entries have ";": "Парз (-аш; фарз –фарзаш: ...)"
  // Take only the first segment before ";" for primary plural
  const semiParts = content.split(";");
  const primaryContent = semiParts[0].trim();

  // Split by colon — can have "stem: suffix", "suffix: class", "class: suffix", etc.
  const colonParts = primaryContent.split(":").map((p) => p.trim());

  if (colonParts.length === 1) {
    // No colon — simple case
    const part = colonParts[0];
    if (isClassMarkerPart(part)) {
      nounClass = extractClassFromPart(part);
    } else {
      const plural = extractPluralForm(part, headword);
      if (plural) grammar.plural = plural;
    }
  } else if (colonParts.length >= 2) {
    // Two+ colon-separated parts — identify each part's role
    let alternateStem: string | undefined;

    for (const part of colonParts) {
      if (!part) continue;

      // Check if purely class markers
      if (isClassMarkerPart(part)) {
        nounClass = extractClassFromPart(part);
        continue;
      }

      // Check if suffix (starts with dash)
      const suffixMatch = part.match(/^[–\-]\s*(.+)$/);
      if (suffixMatch) {
        const suffix = suffixMatch[1].trim();
        // If we have an alternate stem, build plural from it
        const stem = alternateStem ?? headword;
        if (PLURAL_SUFFIXES_RE.test(suffix) || suffix.length <= 4) {
          grammar.plural = stem + suffix;
        }
        continue;
      }

      // Check if bare suffix (e.g. "аш" in "Ӏавдал: аш")
      if (/^[а-яёА-ЯЁӀ]{1,4}$/.test(part) && PLURAL_SUFFIXES_RE.test(part)) {
        const stem = alternateStem ?? headword;
        grammar.plural = stem + part;
        continue;
      }

      // Check if full plural form (ends with plural suffix)
      if (PLURAL_SUFFIXES_RE.test(part) && /[а-яёА-ЯЁӀ]{2,}/.test(part)) {
        grammar.plural = part;
        continue;
      }

      // Otherwise treat as alternate stem for the next part
      if (/[а-яёА-ЯЁӀ]{2,}/.test(part) && !part.includes(" ")) {
        alternateStem = part;
        continue;
      }
    }
  }

  return {
    nounClass,
    grammar: Object.keys(grammar).length > 0 ? grammar : undefined,
  };
}

/** Full class name patterns: "ду", "ву", "бу", "йу" */
const FULL_CLASS_NAMES = new Set(["ву", "йу", "ду", "бу"]);

/** Checks if a string is purely class markers: "й, д, б", "ю-ю", "ду-ду", "ву-ю", etc. */
function isClassMarkerPart(part: string): boolean {
  const trimmed = part.trim().toLowerCase().replace(/\./g, "");

  // Split by dash, comma, or space into tokens
  const tokens = trimmed.split(/[\-,\s]+/).filter(Boolean);
  if (tokens.length === 0) return false;

  // Every token must be either a short class letter or a full class name
  return tokens.every(
    (t) => CLASS_LETTERS.has(t) || FULL_CLASS_NAMES.has(t),
  );
}

/** Extracts the first class from a class marker part */
function extractClassFromPart(part: string): string | undefined {
  const tokens = part
    .replace(/[,\s.\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  for (const t of tokens) {
    // Full class name (ду, ву, бу, йу)
    if (FULL_CLASS_NAMES.has(t)) return t;
    // Short class letter (в, й, д, б, ю)
    if (CLASS_LETTERS.has(t)) return expandClass(t);
  }

  return undefined;
}

/** Common Chechen plural suffixes */
const PLURAL_SUFFIXES_RE = /(?:наш|аш|ий|рш|ш|й)$/;

/**
 * Extracts a plural form from a parenthetical segment.
 * - `-рш` → headword + "рш"
 * - `-аш` → headword + "аш"
 * - `–наш` → headword root + "наш"
 * - `анакевнаш` → full form as-is
 * - `гӀовхаш` → full form as-is
 *
 * Skips non-plural content: variant forms, verb phrases, abbreviations, etc.
 */
function extractPluralForm(
  part: string,
  headword: string,
): string | undefined {
  const trimmed = part.trim();
  if (!trimmed) return undefined;

  // Skip if it looks like a class marker
  if (isClassMarkerPart(trimmed)) return undefined;

  // Skip punctuation-only
  if (/^[!?.,;]+$/.test(trimmed)) return undefined;

  // Skip things with spaces (verb phrases like "дан", "гӀарчӀ-гӀирчӀ ала", "хьожа ярна")
  // unless the whole thing ends with a known plural suffix
  if (/\s/.test(trimmed) && !PLURAL_SUFFIXES_RE.test(trimmed)) return undefined;

  // Skip things that look like grammatical abbreviations (и.кх.д1.)
  if (/и\.кх\.|д1\.|кх\.]/.test(trimmed)) return undefined;

  // Suffix pattern: starts with dash/en-dash
  const suffixMatch = trimmed.match(/^[–\-]\s*(.+)$/);
  if (suffixMatch) {
    const suffix = suffixMatch[1].trim();
    // Only treat as plural suffix if it looks like one
    if (PLURAL_SUFFIXES_RE.test(suffix) || suffix.length <= 4) {
      return headword + suffix;
    }
    return undefined;
  }

  // Full form: must end with a known plural suffix to be considered a plural
  if (PLURAL_SUFFIXES_RE.test(trimmed) && /[а-яёА-ЯЁӀ]{2,}/.test(trimmed)) {
    // Must be a single word (no spaces at this point due to check above)
    return trimmed;
  }

  return undefined;
}

// -------------------------------------------------------------------------
// TRANSLATE parsing
// -------------------------------------------------------------------------

interface ParsedTranslate {
  styleLabel?: string;
  meanings: Meaning[];
  citations: Citation[];
}

function parseTranslate(raw: string): ParsedTranslate {
  let text = raw;

  // Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split on FIRST <br /> to separate definition from citations
  const brIndex = text.indexOf("<br />");
  let definitionPart: string;
  let citationPart: string | undefined;

  if (brIndex !== -1) {
    definitionPart = text.substring(0, brIndex).trim();
    citationPart = text.substring(brIndex + 6).trim(); // 6 = "<br />".length
  } else {
    definitionPart = text.trim();
    citationPart = undefined;
  }

  // Extract style label from definition part
  const styleLabel = extractStyleLabel(definitionPart);
  if (styleLabel) {
    definitionPart = definitionPart.substring(styleLabel.length).trim();
  }

  // For entries where definitionPart is empty (translate starts with <br />),
  // there is no definition — only citations
  if (!definitionPart && citationPart) {
    return {
      styleLabel,
      meanings: [{ translation: "" }],
      citations: parseCitations(citationPart),
    };
  }

  // Strip embedded sub-entries from the definition part
  // Sub-entries appear as <b>Word.</b> in the definition before <br />
  // These are rare in the definitionPart; more common after <br />

  // Parse meanings from definition
  const meanings = parseMeanings(definitionPart);

  // Parse citations from the citation part (after first <br />)
  let citations: Citation[] = [];
  if (citationPart) {
    // Strip embedded sub-entries: everything from <b>Word.</b> onward
    // These come after the main citation text
    const mainCitationText = extractMainCitationText(citationPart);
    citations = parseCitations(mainCitationText);
  }

  return { styleLabel, meanings, citations };
}

/**
 * Extracts the main citation text, stopping before embedded sub-entries.
 * Embedded sub-entries have the pattern: <b>Word (plural).</b> Definition
 * They appear after the main entry's citations, separated by <br />.
 */
function extractMainCitationText(citationPart: string): string {
  // Split by <br /> and take segments until we hit an embedded sub-entry
  const segments = citationPart.split(/<br \/>/);
  const mainSegments: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    // Embedded sub-entry: starts with <b>Word.</b> where the bold tag contains a period
    // Pattern: <b>SomeWord (optional plural).</b>
    if (/^<b>[^<]+\.<\/b>/.test(trimmed)) {
      break; // Stop collecting — the rest are sub-entries
    }
    mainSegments.push(trimmed);
  }

  return mainSegments.join(" ").trim();
}

// -------------------------------------------------------------------------
// Meanings
// -------------------------------------------------------------------------

function parseMeanings(text: string): Meaning[] {
  if (!text) return [{ translation: "" }];

  // Clean HTML, but preserve text
  const cleaned = stripHtml(cleanText(text));
  if (!cleaned) return [{ translation: "" }];

  // Split by numbered meanings: "1.text 2.text" or "1) text 2) text"
  const parts = splitMeanings(cleaned);

  return parts.map((part) => ({
    translation: part
      .replace(/[;.]+$/, "")
      .trim(),
  }));
}

// -------------------------------------------------------------------------
// Citations
// -------------------------------------------------------------------------

/**
 * Parses citation text into Citation objects.
 *
 * Citations are Chechen literary text followed by (Author. Title) in parentheses.
 * Multiple citations can appear separated by periods + space or newlines.
 */
function parseCitations(text: string): Citation[] {
  if (!text) return [];

  // Clean up HTML tags but keep text
  const cleaned = stripHtml(text)
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return [];

  const citations: Citation[] = [];

  // Split on citation source pattern: text ending with (Author. Title).
  // We look for all occurrences of (Source) at the end of citation segments
  const sourceRegex =
    /\(([А-ЯЁA-Z][а-яёa-zА-ЯЁA-Z0-9.\-\s']+\.\s*[^)]+)\)\s*\.?\s*/g;

  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = sourceRegex.exec(cleaned)) !== null) {
    const fullMatchEnd = match.index + match[0].length;
    const citationText = cleaned
      .substring(lastEnd, match.index)
      .replace(/^\s*[.,;]\s*/, "")
      .trim();

    if (citationText) {
      citations.push({
        text: citationText,
        source: match[1].trim(),
      });
    }

    lastEnd = fullMatchEnd;
  }

  // If no sources found at all, return the whole text as a single citation
  if (citations.length === 0 && cleaned) {
    // Try simpler extraction
    const source = extractCitationSource(cleaned);
    const citText = source
      ? cleaned.replace(/\([^)]+\)\s*\.?\s*$/, "").trim()
      : cleaned;

    if (citText) {
      citations.push({
        text: citText,
        source,
      });
    }
  }

  return citations;
}
