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
export function parseBaisultanovEntries(raws: RawDictEntry[]): ParsedEntry[] {
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
    variants: parsed.variants,
    partOfSpeech: parsed.isInterjection ? "межд." : undefined,
    partOfSpeechNah: parsed.isInterjection ? "айдардош" : undefined,
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
  variants?: string[];
  isInterjection?: boolean;
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

  // Strip square brackets and their content: "[ласто; озо, етта и.д1.кх.]", "[кап]"
  text = text.replace(/\s*\[[^\]]*\]/g, "");

  // Detect interjection marker (!)
  const isInterjection = /\(\s*!\s*\)/.test(text);
  if (isInterjection) {
    text = text.replace(/\s*\(\s*!\s*\)/g, "").trim();
  }

  // Truncate at definition text leaking into word field.
  // Pattern: after a closing paren + optional period, or after word without parens,
  // a period/colon followed by text (Cyrillic or style label) indicates definition leak.
  // e.g. "Петар (-ш).Старин. Квартира" → "Петар (-ш)"
  // e.g. "Уойт (уойтӀ)Что и уой" → "Уойт (уойтӀ)"
  // e.g. "Тахвала (й, д, б). ФЕ: тахваьлла" → "Тахвала (й, д, б)"
  // e.g. "Санкхала. Сансара" → "Санкхала"
  // Look for "). " or ")." or ") Text" or just ". Text" after the word portion
  const defLeakMatch = text.match(
    /^(.+?\))\s*\.?\s*(?:[А-ЯЁа-яёӀA-Za-z].+)$/,
  );
  if (defLeakMatch) {
    text = defLeakMatch[1].trim();
  } else {
    // No parens case: "Санкхала. Сансара" — truncate at first ". " followed by text
    const dotLeakMatch = text.match(
      /^([А-ЯЁа-яёӀ\-]+(?:\s*\([^)]*\))?)\.\s+[А-ЯЁа-яёӀ]/,
    );
    if (dotLeakMatch) {
      text = dotLeakMatch[1].trim();
    }
  }

  // Extract ALL parenthetical groups from the text.
  // Handles: "Тафсир (тапсир) (-аш)", "Адам-йилбаз (адаман йилбаз, лилбаз (-аш))"
  const parenGroups: string[] = [];
  let wordPart = text;

  // Peel off parenthetical groups from the right, handling nesting.
  // Strategy: find last ")", walk left to find its matching "(", strip that group, repeat.
  let changed = true;
  while (changed) {
    changed = false;
    const trimmed = wordPart.replace(/[\s.\-–]*$/, "");

    // Find the last closing paren
    const lastClose = trimmed.lastIndexOf(")");
    if (lastClose > 0) {
      // Walk left from lastClose to find the matching opening paren
      let depth = 0;
      let openIdx = -1;
      for (let i = lastClose; i >= 0; i--) {
        if (trimmed[i] === ")") depth++;
        else if (trimmed[i] === "(") {
          depth--;
          if (depth === 0) {
            openIdx = i;
            break;
          }
        }
      }
      if (openIdx > 0) {
        const content = trimmed.substring(openIdx + 1, lastClose).trim();
        const remaining = trimmed.substring(0, openIdx).trim();
        // Strip if what comes after the close paren is punctuation/whitespace,
        // or variant forms after ";", ",", ":", or "-" (e.g. "); кӀунс", "), манкӀур", ")-аьлла")
        const afterClose = trimmed.substring(lastClose + 1).trim();
        if (!afterClose || /^[.\s\-–;:,]/.test(afterClose)) {
          parenGroups.unshift(content);
          wordPart = remaining;
          changed = true;
        }
      }
    }

    // Handle unclosed parenthesis (no closing paren found above):
    // "Доьхьа (-наш", "Хьавола (хьа", "Курчак (вала: (й, д, б"
    if (!changed) {
      const firstOpen = wordPart.indexOf("(");
      if (firstOpen > 0 && !wordPart.includes(")")) {
        const before = wordPart.substring(0, firstOpen).trim();
        const content = wordPart.substring(firstOpen + 1).trim();
        if (before && /[А-ЯЁа-яёӀ]/.test(before) && content) {
          parenGroups.unshift(content);
          wordPart = before;
          changed = true;
        }
      }
    }
  }

  // Handle stray closing parens without opening: "Кхосту уш; -аш)", "Хьахьуриг –рш)"
  if (wordPart.includes(")") && !wordPart.includes("(")) {
    wordPart = wordPart.replace(/\)\s*$/, "").trim();
    // Content before the stray close paren might contain suffix info after semicolon
    const semiMatch = wordPart.match(/^(.+?)\s*[;,]\s*(-?[а-яёА-ЯЁӀ]+.*)$/);
    if (semiMatch) {
      wordPart = semiMatch[1].trim();
      parenGroups.push(semiMatch[2].trim());
    }
  }

  // Extract variant forms after ";", ","  or ":" at the end before stripping
  // e.g. "КӀумс; кӀунс" → variant "кӀунс", "Манкурт, манкӀур" → variant "манкӀур"
  const trailingVariants: string[] = [];
  const variantStripMatch = wordPart.match(/^(.+?)\s*[;:,]\s+([а-яёА-ЯЁӀ].*)$/);
  if (variantStripMatch) {
    wordPart = variantStripMatch[1].trim();
    // Split multiple variants by comma/semicolon
    const extraVars = variantStripMatch[2].split(/\s*[;,]\s*/);
    for (const v of extraVars) {
      const cleaned = v.trim();
      if (cleaned && /[а-яёА-ЯЁӀ]{2,}/.test(cleaned)) {
        trailingVariants.push(cleaned);
      }
    }
  }

  // Clean trailing junk (covers both en-dash "–" and hyphen "-")
  wordPart = wordPart.replace(/\s*[–\-]\s*$/, "").trim();
  wordPart = wordPart.replace(/\s*,\s*$/, "").trim();

  const word = cleanText(stripHtml(wordPart));
  if (!word) return { word: "" };

  let nounClass: string | undefined;
  let grammar: GrammarInfo | undefined;
  const variants: string[] = [...trailingVariants];

  // Process all parenthetical groups: merge their results
  for (const content of parenGroups) {
    const parenResult = parseParenContent(content, word);
    if (parenResult.nounClass && !nounClass) {
      nounClass = parenResult.nounClass;
    }
    if (parenResult.grammar) {
      grammar = grammar ?? {};
      if (parenResult.grammar.plural) grammar.plural = parenResult.grammar.plural;
    }
    if (parenResult.variants) {
      variants.push(...parenResult.variants);
    }
  }

  return {
    word,
    nounClass,
    grammar: grammar && Object.keys(grammar).length > 0 ? grammar : undefined,
    variants: variants.length > 0 ? variants : undefined,
    isInterjection: isInterjection || undefined,
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
interface ParenResult {
  nounClass?: string;
  grammar?: GrammarInfo;
  variants?: string[];
}

function parseParenContent(
  content: string,
  headword: string,
): ParenResult {
  let nounClass: string | undefined;
  const grammar: GrammarInfo = {};
  const variants: string[] = [];

  // Skip usage examples in parentheses: "напр.: ...", "например: ..."
  if (/^напр(?:\.|имер)?:/i.test(content)) {
    return { nounClass: undefined, grammar: undefined, variants: undefined };
  }

  // Strip semicolons — some entries have ";": "Парз (-аш; фарз –фарзаш: ...)"
  // Take only the first segment before ";" for primary plural
  const semiParts = content.split(";");
  const primaryContent = semiParts[0].trim();

  // Additional segments after ";" may contain variant forms
  for (let i = 1; i < semiParts.length; i++) {
    const extra = semiParts[i].trim();
    if (extra && /[а-яёА-ЯЁӀ]{2,}/.test(extra) && !isClassMarkerPart(extra)) {
      // Clean suffix markers
      const cleaned = extra.replace(/^[–\-]\s*/, "").trim();
      if (cleaned) variants.push(cleaned);
    }
  }

  // Split by colon — can have "stem: suffix", "suffix: class", "class: suffix", etc.
  const colonParts = primaryContent.split(":").map((p) => p.trim());

  if (colonParts.length === 1) {
    // No colon — simple case
    // Try to split by commas to handle mixed content like "баӀбевларш, й, д"
    const commaParts = colonParts[0].split(",").map((p) => p.trim()).filter(Boolean);

    if (commaParts.length > 1) {
      // Multiple comma-separated tokens — classify each
      const classTokens: string[] = [];
      for (const token of commaParts) {
        if (isClassMarkerPart(token)) {
          const cls = extractClassFromPart(token);
          if (cls) classTokens.push(cls);
        } else {
          const plural = extractPluralForm(token, headword);
          if (plural) {
            grammar.plural = plural;
          } else if (isVariantForm(token, headword)) {
            variants.push(token);
          }
        }
      }
      // Merge all class tokens, deduplicating
      if (classTokens.length > 0) {
        const allClasses = classTokens.flatMap((c) => c.split("/"));
        const unique = Array.from(new Set(allClasses));
        nounClass = unique.join("/");
      }
    } else {
      const part = colonParts[0];
      if (isClassMarkerPart(part)) {
        nounClass = extractClassFromPart(part);
      } else {
        const plural = extractPluralForm(part, headword);
        if (plural) {
          grammar.plural = plural;
        } else if (isVariantForm(part, headword)) {
          variants.push(part);
        }
      }
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
          grammar.plural = joinStemSuffix(stem, suffix);
        }
        continue;
      }

      // Check if bare suffix (e.g. "аш" in "Ӏавдал: аш")
      if (/^[а-яёА-ЯЁӀ]{1,4}$/.test(part) && PLURAL_SUFFIXES_RE.test(part)) {
        const stem = alternateStem ?? headword;
        grammar.plural = joinStemSuffix(stem, part);
        continue;
      }

      // Check if full plural form (ends with plural suffix)
      if (PLURAL_SUFFIXES_RE.test(part) && /[а-яёА-ЯЁӀ]{2,}/.test(part)) {
        grammar.plural = part;
        continue;
      }

      // Otherwise treat as alternate stem for the next part
      // Skip Russian abbreviations/words that aren't real stems
      if (/[а-яёА-ЯЁӀ]{2,}/.test(part) && !part.includes(" ") &&
          !/^напр\.?$|^например$|^и\.кх|^д1\.|^кх\.|^т\.п/.test(part)) {
        alternateStem = part;
        continue;
      }
    }

    // If alternateStem was set but never consumed as plural base, it's a variant
    if (alternateStem && !grammar.plural) {
      variants.push(alternateStem);
    }
  }

  return {
    nounClass,
    grammar: Object.keys(grammar).length > 0 ? grammar : undefined,
    variants: variants.length > 0 ? variants : undefined,
  };
}

/**
 * Checks if a parenthetical part is a variant form (not plural, not class marker).
 * Variant forms: "ошхьада", "аввабин-ламаз", "буьрса", "боли-лу"
 * NOT variant: "!", abbreviations, single letters
 */
function isVariantForm(part: string, headword: string): boolean {
  const trimmed = part.trim();
  if (!trimmed || trimmed.length < 2) return false;
  // Skip punctuation-only (!, ?)
  if (/^[!?.,;]+$/.test(trimmed)) return false;
  // Skip grammatical abbreviations
  if (/и\.кх\.|д1\.|кх\.|и\.д1/.test(trimmed)) return false;
  // Skip Russian text (variant forms should be Chechen)
  if (/только|во мн|напр|с др|классн|показател/.test(trimmed)) return false;
  // Must contain Cyrillic
  if (!/[а-яёА-ЯЁӀ]{2,}/.test(trimmed)) return false;
  // Skip if it looks like a class marker
  if (isClassMarkerPart(trimmed)) return false;
  // Skip if it's the same as headword
  if (trimmed.toLowerCase() === headword.toLowerCase()) return false;
  return true;
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
  return tokens.every((t) => CLASS_LETTERS.has(t) || FULL_CLASS_NAMES.has(t));
}

/** Extracts the first class from a class marker part */
function extractClassFromPart(part: string): string | undefined {
  const tokens = part
    .replace(/[,\s.\-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const classes: string[] = [];
  for (const t of tokens) {
    let cls: string | undefined;
    // Full class name (ду, ву, бу, йу)
    if (FULL_CLASS_NAMES.has(t)) cls = t;
    // Short class letter (в, й, д, б, ю)
    else if (CLASS_LETTERS.has(t)) cls = expandClass(t);

    if (cls && !classes.includes(cls)) classes.push(cls);
  }

  return classes.length > 0 ? classes.join("/") : undefined;
}

/** Common Chechen plural suffixes */
const PLURAL_SUFFIXES_RE = /(?:наш|аш|ий|рш|ш|й)$/;

/**
 * Склеивает основу и суффикс с учётом перекрытия.
 * В чеченской лексикографии `-рш` при слове `Авиакхийсар` означает
 * `Авиакхийсарш`, а не `Авиакхийсаррш` — суффикс перекрывает конец основы.
 *
 * Ищем максимальное совпадение конца stem с началом suffix (case-insensitive).
 */
function joinStemSuffix(stem: string, suffix: string): string {
  const stemLow = stem.toLowerCase();
  const suffixLow = suffix.toLowerCase();
  const maxOverlap = Math.min(stem.length, suffix.length);

  for (let ov = maxOverlap; ov >= 1; ov--) {
    if (stemLow.endsWith(suffixLow.substring(0, ov))) {
      return stem + suffix.substring(ov);
    }
  }
  return stem + suffix;
}

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
function extractPluralForm(part: string, headword: string): string | undefined {
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
      const joined = joinStemSuffix(headword, suffix);
      // If the suffix is long (≥5 chars) and joinStemSuffix found no overlap
      // (just concatenated), it's a full replacement form with stem change,
      // not a suffix. E.g. "-жаметтанаш" for "Жамотт", "-бакъ-чӀерий" for "Бакъ-чӀара"
      if (suffix.length >= 5 && joined === headword + suffix) {
        return suffix.charAt(0).toUpperCase() + suffix.slice(1);
      }
      return joined;
    }
    return undefined;
  }

  // Full form: must end with a known plural suffix to be considered a plural
  if (PLURAL_SUFFIXES_RE.test(trimmed) && /[а-яёА-ЯЁӀ]{2,}/.test(trimmed)) {
    // Short bare suffixes without dash (e.g. "наш", "аш", "ий", "рш")
    // should be joined with headword, not treated as full forms
    if (trimmed.length <= 4 && /^[а-яёӀ]+$/.test(trimmed)) {
      return joinStemSuffix(headword, trimmed);
    }
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

  // Strip leading dash/en-dash (artifact: "– наконечник стрелы", "- свора собак")
  definitionPart = definitionPart.replace(/^[–\-]\s*/, "");

  // Extract style label from definition part
  const styleLabel = extractStyleLabel(definitionPart);
  if (styleLabel) {
    definitionPart = definitionPart.substring(styleLabel.length).trim();
  }

  // Strip etymology origin prefix: "Из арабск.", "Из арабск. яз.", "Из арабск, яз.",
  // "из русского языка:", "из русск. яз." etc.
  // These are not part of the translation text
  const etymMatch = definitionPart.match(
    /^[Ии]з\s+(?:арабск|перс|турецк|тюрк|груз|русск(?:ого)?)\.?\s*,?\s*(?:яз(?:ыка?)?\.?)?\s*:?\s*[–\-]?\s*/,
  );
  if (etymMatch) {
    definitionPart = definitionPart.substring(etymMatch[0].length).trim();
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

  // Strip embedded sub-entries from definition text before cleaning.
  // In Baisultanov, <b> tags in the definition part mark sub-entries or related words:
  //   <b>Мерга мийист </b>(Мерга мийист). Мерг - олень...
  //   // <b>Бенцахетар (-ш).</b> Безразличие.
  //   См.: <b>Бур-бур-аьлла.</b>
  //   <b>яха (б)</b>. Колдовать... (related verb form)
  //
  // Strategy: remove <b>Word</b> + following sub-entry text up to next sub-entry or end,
  // but preserve text that looks like a definition (starts with Russian definition after period).
  let cleanedText = text;

  // Remove "См.: <b>...</b>..." cross-references
  cleanedText = cleanedText.replace(/См\.:\s*<b>[^<]*<\/b>[^<]*/g, "").trim();

  // Remove "// <b>...</b>" sub-entry markers (only the bold tag and //, keep text after)
  cleanedText = cleanedText.replace(/\/\/\s*<b>[^<]*<\/b>\s*/g, "").trim();

  // Remove sub-entries: <b>Word </b>(Word) ... up to end or next sentence.
  // These are toponymic/encyclopedic sub-entries from Сулейманов.
  // Pattern: <b>Word </b> followed by parenthetical and explanatory text
  cleanedText = cleanedText
    .replace(/<b>[^<]+<\/b>\s*\([^)]*\)[^<]*/g, "")
    .trim();

  // Remove remaining <b>Word.</b> patterns (period inside bold = sub-entry header)
  cleanedText = cleanedText
    .replace(/<b>[^<]+\.<\/b>\s*/g, "")
    .trim();

  // Clean HTML, but preserve text
  let cleaned = stripHtml(cleanText(cleanedText));
  if (!cleaned) return [{ translation: "" }];

  // Strip source references from translation text:
  // "(из кн. А.Сулейманова. «Топонимия Чечни»)" and similar
  cleaned = cleaned
    .replace(/\(из кн\.[^)]*\)/g, "")
    .replace(/Источник:\s*[^.]*\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [{ translation: "" }];

  // Split by numbered meanings: "1.text 2.text" or "1) text 2) text"
  const parts = splitMeanings(cleaned);

  return parts.map((part) => {
    let translation = part.replace(/[;.]+$/, "").trim();

    // Strip trailing style/origin labels: "Вертолёт.Калька" → "Вертолёт"
    // Also "Калька из русск. яз", "Калька из русского языка:" etc.
    translation = translation
      .replace(/\.?\s*Калька(?:\s+из\s+[а-яё]+\.?\s*(?:яз(?:ыка?)?\.?)?)?:?\s*$/, "")
      .replace(/\.?\s*(?:Неол|Архаич)\.?\s*$/, "")
      .replace(/[.\s]+$/, "")
      .trim();

    // Extract per-meaning style label: "Устар. Сторожевой отряд" → styleLabel in note
    const label = extractStyleLabel(translation);
    if (label) {
      translation = translation.substring(label.length).trim();
    }

    return {
      translation,
      ...(label ? { note: label } : {}),
    };
  });
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
