import type { GrammarInfo, ParsedEntry, RawDictEntry } from "./types";
import { expandClass } from "./utils";

/**
 * Парсер для юридического словаря Абдурашидова (CE↔RU).
 *
 * Новый формат (abdurashidov_ce_ru_ru_ce2.json):
 *   - section: "ce_ru" | "ru_ce" | "appendix"
 *   - word: чистое слово/фраза (без грамматики)
 *   - nounClass: "ю", "в, ю", "д, д" и т.д. (уже отдельным полем)
 *   - plural: "авантюраш ю" (слово + класс)
 *   - declension: "авантюрин, авантюрина, авантюро, авантюре"
 *   - translation: русский перевод (для ce_ru) / чеченский (для ru_ce)
 *   - etymology: "фр.", "лат." и т.д.
 *   - wordNote: пояснение к чеченскому слову
 *   - translationNote: пояснение к переводу
 *   - subEntries: [{phrase, nounClass?, translation?, note?}]
 *   - obsolete: true
 */

/** Shape of a single entry from the new JSON format */
interface AbdurashidovRawEntry {
  id: string;
  section: string;
  word: string;
  nounClass?: string;
  plural?: string;
  declension?: string;
  translation?: string;
  etymology?: string;
  wordNote?: string;
  translationNote?: string; // пояснение к переводу (для обеих секций)
  obsolete?: boolean;
  subEntries?: {
    phrase: string;
    nounClass?: string;
    translation?: string;
    note?: string;
  }[];
}

export function parseAbdurashidovEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const results: ParsedEntry[] = [];

  for (const r of raws) {
    const raw = r as unknown as AbdurashidovRawEntry;
    if (raw.section === "ru_ce") {
      const entry = parseRuCeEntry(raw);
      if (entry) results.push(entry);
    } else {
      // ce_ru and appendix share the same format
      const entry = parseCeRuEntry(raw);
      if (entry) results.push(entry);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CE→RU (and appendix)
// ---------------------------------------------------------------------------

function parseCeRuEntry(raw: AbdurashidovRawEntry): ParsedEntry | null {
  const word = raw.word?.trim();
  if (!word) return null;

  const nounClass = parseClassString(raw.nounClass);
  const grammar = parseGrammar(raw.plural, raw.declension);

  // Build meanings
  const meanings: ParsedEntry["meanings"] = [];
  if (raw.translation) {
    const meaning: ParsedEntry["meanings"][0] = {
      translation: raw.translation,
    };

    // wordNote → meaning note
    if (raw.wordNote) {
      meaning.note = raw.wordNote;
    }

    // subEntries → examples
    if (raw.subEntries?.length) {
      meaning.examples = raw.subEntries
        .filter((se) => se.phrase || se.translation)
        .map((se) => ({
          nah: se.phrase || "",
          ru: se.translation || "",
        }));
    }

    meanings.push(meaning);
  }

  // If translationNote exists, add as note to the meaning (in parens)
  if (raw.translationNote && meanings.length > 0) {
    const existing = meanings[0].translation;
    // Append translationNote in parentheses if it adds info
    if (existing && !existing.includes(raw.translationNote)) {
      meanings[0].translation = `${existing} (${raw.translationNote})`;
    }
  }

  const entry: ParsedEntry = {
    word,
    nounClass,
    nounClassPlural: grammar.pluralClass,
    meanings,
    domain: "law",
  };

  // Clean optional fields
  if (!entry.nounClass) delete entry.nounClass;
  if (!entry.nounClassPlural) delete entry.nounClassPlural;

  if (Object.keys(grammar).length > 0) {
    entry.grammar = grammar;
  }

  if (raw.obsolete) {
    entry.styleLabel = "уст.";
  }

  return entry;
}

// ---------------------------------------------------------------------------
// RU→CE
// ---------------------------------------------------------------------------

function parseRuCeEntry(raw: AbdurashidovRawEntry): ParsedEntry | null {
  const word = raw.word?.trim();
  if (!word) return null;

  // In ru_ce, "word" is Russian, "translation" is Chechen
  const chechenTranslation = raw.translation?.trim();
  if (!chechenTranslation) return null;

  // nounClass of the Chechen word
  const nounClass = parseClassString(raw.nounClass);

  // Build meanings: translation is the Russian word (the headword)
  // but ParsedEntry.word = Chechen, meanings[0].translation = Russian
  // In ru_ce dictionary: we create an entry where word = Chechen translation,
  // and meanings = Russian headword
  const meaning: ParsedEntry["meanings"][0] = {
    translation: word,
  };

  // translationNote → meaning note (contains Chechen synonym/explanation)
  if (raw.translationNote) {
    meaning.note = raw.translationNote;
  }

  // subEntries → examples
  if (raw.subEntries?.length) {
    meaning.examples = raw.subEntries
      .filter((se) => se.phrase || se.translation)
      .map((se) => ({
        nah: se.translation || "",
        ru: se.phrase || "",
      }));
  }

  const entry: ParsedEntry = {
    word: chechenTranslation,
    nounClass,
    meanings: [meaning],
    domain: "law",
  };

  if (!entry.nounClass) delete entry.nounClass;

  return entry;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse class string like "ю", "в, ю", "д, д", "в, ю, б"
 * into normalized form "йу", "ву/йу", "ду", "ву/йу/бу"
 */
function parseClassString(raw?: string): string | undefined {
  if (!raw) return undefined;

  const tokens = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (tokens.length === 0) return undefined;

  // Single class: "ю" → "йу"
  if (tokens.length === 1) {
    return expandClass(tokens[0]);
  }

  // Class pair (same): "ю, ю" → just "йу" (singular = plural)
  if (tokens.length === 2 && tokens[0] === tokens[1]) {
    return expandClass(tokens[0]);
  }

  // Class pair (different): "в, ю" → "ву/йу"
  // Triple: "в, ю, б" → "ву/йу/бу"
  const expanded = tokens.map((t) => expandClass(t)).filter(Boolean);
  if (expanded.length === 0) return undefined;

  // Deduplicate
  const unique = [...new Set(expanded)];
  return unique.join("/");
}

/**
 * Parse plural and declension fields into GrammarInfo.
 *
 * plural: "авантюраш ю" → {plural: "авантюраш", pluralClass: "йу"}
 * declension: "авантюрин, авантюрина, авантюро, авантюре"
 *   → {genitive, dative, ergative, instrumental}
 */
function parseGrammar(pluralRaw?: string, declensionRaw?: string): GrammarInfo {
  const grammar: GrammarInfo = {};

  // Parse plural: "авантюраш ю"
  if (pluralRaw) {
    const match = pluralRaw.match(/^(.+?)\s+([бвдйю])$/);
    if (match) {
      grammar.plural = match[1].trim();
      grammar.pluralClass = expandClass(match[2]);
    } else {
      // No class in plural — just the word
      grammar.plural = pluralRaw.trim();
    }
  }

  // Parse declension: "gen, dat, erg, instr"
  if (declensionRaw) {
    const parts = declensionRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (parts[0]) grammar.genitive = parts[0];
    if (parts[1]) grammar.dative = parts[1];
    if (parts[2]) grammar.ergative = parts[2];
    if (parts[3]) grammar.instrumental = parts[3];
  }

  return grammar;
}
