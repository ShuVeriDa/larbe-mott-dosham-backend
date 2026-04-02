import type { Meaning, ParsedEntry, Phrase, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  extractPartOfSpeech,
  posToNah,
  splitMeanings,
  stripHtml,
  stripStressMarks,
} from "./utils";

/**
 * Парсер для словаря Карасаева-Мациева (karasaev_maciev_ru_ce.json).
 * Русско-чеченский словарь, ~26532 записей, ~9221 уникальных.
 *
 * Формат:
 * - word: русское слово со знаками ударения (acute), word1 — без них.
 *   Может содержать окончания прилагательных: "августовский, -ая, -ое"
 *   Может содержать \t[ (189 записей) — фразовые статьи.
 * - translate: аналогичен формату maciev, но направление RU→NAH:
 *   <i>POS</i> + нумерованные значения 1) текст 2) текст
 *   + <b>Russian phrase</b> Chechen translation
 *   + ◊ phraseology
 *
 * Edge cases:
 * - 4 записи с word="-[" — битый HTML split, пропуск.
 * - 1 запись с word="3" — orphan, пропуск.
 * - 10 записей с пустым word — пропуск.
 * - 10 записей с пустым translate — пропуск.
 */
export function parseKarasaevEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const entry = parseKarasaevEntry(raw);
    if (entry) results.push(entry);
  }

  return results;
}

function parseKarasaevEntry(raw: RawDictEntry): ParsedEntry | null {
  const translate = raw.translate?.trim();
  if (!translate) return null;

  // word1 is the clean version (no stress marks), fallback to word
  const rawWord = cleanText(raw.word1 ?? raw.word);
  if (!rawWord) return null;

  // Skip broken entries
  if (rawWord === "-[" || rawWord === "3") return null;

  const word = cleanWord(rawWord);
  if (!word) return null;

  // Accented variant from raw.word (has stress marks)
  const rawAccented = cleanText(raw.word);
  const wordAccented =
    rawAccented && rawAccented !== rawWord ? cleanWord(rawAccented) : undefined;

  // Fix BBCode-артефактов: word="..., [" + translate="i]мн.</i>" → reconstruct <i>
  let remaining = translate;
  if (/^i\]/.test(remaining)) {
    remaining = "<i>" + remaining.substring(2);
  } else {
    // Strip broken bracket markup from source (e.g. "b]ая,</b>" → "ая,</b>")
    remaining = remaining.replace(/^\s*\[?\/?[bi]\]/g, "");
  }

  // 1. Extract part of speech: <i>POS</i>
  let partOfSpeech = extractPartOfSpeech(remaining);
  if (partOfSpeech) {
    // Remove the POS tag from remaining text
    remaining = remaining.replace(/<i>[^<]*<\/i>\s*/, "").trim();
  }

  // 1b. Extract grammatical markers: <i>м </i>, <i>ж </i>, <i>несов.</i>, <i>сов.</i>
  //      Tag may also contain "см." (e.g. <i>сов., кого, разг. см.</i>) — preserve it.
  const gramMarker = extractGrammarMarker(remaining);
  if (gramMarker) {
    if (!partOfSpeech) partOfSpeech = gramMarker.pos;
    const gramTagMatch = remaining.match(/^<i>([^<]*)<\/i>\s*/);
    if (gramTagMatch && /см\./.test(gramTagMatch[1])) {
      remaining = "<i>см.</i> " + remaining.substring(gramTagMatch[0].length);
    } else {
      remaining = remaining.replace(/<i>[^<]*<\/i>\s*/, "").trim();
    }
  }

  // 2. Extract style/subject labels: <i>рел.</i>, <i>перен.</i>, <i>разг.</i> etc.
  //    Tag may also contain "см." (e.g. <i>уст. см.</i>) — preserve it.
  const styleLabel = extractStyleLabel(remaining);
  if (styleLabel) {
    const styleTagMatch = remaining.match(/^<i>([^<]*)<\/i>\s*/);
    if (styleTagMatch && /см\./.test(styleTagMatch[1])) {
      // Preserve "см." by replacing the tag with <i>см.</i>
      remaining = "<i>см.</i> " + remaining.substring(styleTagMatch[0].length);
    } else {
      remaining = remaining.replace(/<i>[^<]*<\/i>\s*/, "").trim();
    }
  }

  // 3. Split main text from phraseology (◊)
  let mainText = remaining;
  let phraseText = "";
  const phraseIdx = remaining.indexOf("◊");
  if (phraseIdx !== -1) {
    mainText = remaining.substring(0, phraseIdx).trim();
    phraseText = remaining.substring(phraseIdx + 1).trim();
  }

  // 4. Parse meanings (numbered or single)
  const meanings = parseMeanings(mainText);

  // 5. Parse phraseology: <b>Russian</b> Chechen
  const phraseology = phraseText ? extractRuNahExamples(phraseText) : undefined;

  return {
    word: stripStressMarks(stripHtml(word)),
    wordAccented: wordAccented ? stripHtml(wordAccented) : undefined,
    partOfSpeech,
    partOfSpeechNah: posToNah(partOfSpeech),
    meanings,
    phraseology: phraseology?.length ? phraseology : undefined,
    styleLabel,
  };
}

/**
 * Clean the word field. Removes trailing numbers (homonym markers)
 * but preserves tab-bracket phrases and adjective endings.
 */
function cleanWord(word: string): string {
  return word
    .replace(/:\s.*$/, "") // remove sub-entry phrases after ": " (originally ":\t")
    .replace(/\d+$/, "") // remove trailing homonym number
    .replace(/<[^>]*>/g, "") // strip any HTML
    .replace(/\[?\/?[bi]\]?/g, "") // strip broken bracket markup: [b, b], [i, i]
    .replace(/\s*\[+\s*$/, "") // strip trailing lone bracket(s)
    .replace(/,\s*$/, "") // strip trailing comma
    .trim();
}

/**
 * Extract style/domain labels from the beginning of translate text.
 * These appear as <i>рел.</i>, <i>перен.</i>, <i>разг.</i> etc.
 */
const SUBJECT_LABELS = [
  "рел.",
  "перен.",
  "разг.",
  "спец.",
  "тех.",
  "мед.",
  "юр.",
  "муз.",
  "воен.",
  "мат.",
  "хим.",
  "физ.",
  "бот.",
  "зоол.",
  "анат.",
  "астр.",
  "геогр.",
  "ист.",
  "лингв.",
  "лит.",
  "полит.",
  "эк.",
  "филос.",
  "фольк.",
  "уст.",
  "устар.",
  "книжн.",
  "прост.",
  "обл.",
  "презр.",
  "бран.",
  "шутл.",
  "ирон.",
  "ласк.",
];

function extractStyleLabel(text: string): string | undefined {
  const m = text.match(/^<i>([^<]+)<\/i>/);
  if (!m) return undefined;

  const label = m[1].trim().toLowerCase();
  for (const known of SUBJECT_LABELS) {
    if (label.startsWith(known)) return known;
  }
  return undefined;
}

/**
 * Extracts example pairs from RU→NAH text.
 * Format: <b>Russian phrase</b> Chechen translation
 * Since this is a RU→NAH dictionary, the bold text is Russian and the
 * text following it is Chechen.
 *
 * The Chechen part may contain <i>...</i> tags (e.g. <i>или</i>, <i>нареч.</i>)
 * and parenthesized groups — these must not break the match.
 */
function extractRuNahExamples(text: string): Phrase[] {
  const results: Phrase[] = [];
  // Allow <i>...</i> tags and parenthesized groups inside the Chechen (nah) portion.
  // Also handle (<b>ru</b>) nah pattern — optional parens wrapping the <b> tag.
  const regex = /\(?<b>([^<]+)<\/b>\)?\s*((?:[^<;◊]|<i>[^<]*<\/i>)*)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const ru = cleanText(stripStressMarks(match[1]));
    let nah = cleanText(stripStressMarks(stripHtml(match[2])));
    // Strip leading/trailing orphan parens and dashes from nah
    nah = nah
      .replace(/^(\(\)\s*|[)\s–-])+/, "")
      .replace(/\(\s*$/, "")
      .trim();
    if (ru && nah && !isGarbage(nah)) results.push({ nah, ru });
  }

  return results;
}

/** Filter out garbage fragments: lone parentheses, dashes, single letters, short artifacts */
function isGarbage(text: string): boolean {
  const t = text.trim();
  if (/^[()–\s-]*$/.test(t)) return true;
  if (t.length === 1 && /[а-яёА-ЯЁ]/.test(t)) return true;
  // Fragments like "(или", "(и", "или)", etc.
  if (/^\(?(?:или|и|тж\.?)\)?\.?$/.test(t)) return true;
  return false;
}

/**
 * Parse meanings from the main text (before ◊).
 * Splits numbered meanings "1) ... 2) ..." and extracts examples.
 */
function parseMeanings(text: string): Meaning[] {
  const stripped = cleanText(text);
  const meaningTexts = splitMeanings(stripped);

  return meaningTexts.map((mt) => {
    // Extract per-meaning grammar marker: <i>м </i>, <i>ж </i>, <i>несов.</i> etc.
    const gram = extractGrammarMarker(mt);
    let source = mt;
    if (gram) {
      const tagM = source.match(/^<i>([^<]*)<\/i>\s*/);
      if (tagM && /см\./.test(tagM[1])) {
        source = "<i>см.</i> " + source.substring(tagM[0].length);
      } else {
        source = source.replace(/<i>[^<]*<\/i>\s*/, "").trim();
      }
    }

    // Extract per-meaning style/domain label: <i>перен.</i>, <i>разг.</i> etc.
    const label = extractMeaningLabel(source);
    if (label) {
      const tagM = source.match(/^<i>([^<]*)<\/i>\s*/);
      if (tagM && /см\./.test(tagM[1])) {
        source = "<i>см.</i> " + source.substring(tagM[0].length);
      } else {
        source = source.replace(/<i>[^<]*<\/i>\s*/, "").trim();
      }
    }

    // Extract cross-reference: <i>см.</i> <b>word</b> or "см. <b>word</b>"
    const crossRef = extractCrossRef(source);
    if (crossRef) {
      // Strip the full "см. <b>word</b> N" pattern (including homonym numbers)
      source = source
        .replace(/(?:<i>\s*)?см\.(?:\s*<\/i>)?\s*<b>[^<]+<\/b>\s*\d*/g, "")
        .trim();
    }

    // Derivational references: text ending with <i>...от </i><b>word</b>
    // Simple: <i>и т. д. буд. от </i><b>зачесть</b>
    // Multi-tag: <i>и т. д.,</i> берегут <i>наст. от </i><b>беречь</b>
    // Chained: <i>наст. от </i><b>стлать</b> <i>и от </i><b>стелить</b>
    // With forms: <i>мн.</i> <b>сейте</b> <i>повел. от </i><b>сеять</b>
    // Parenthesized: (<i>сравн. ст. от </i><b>большой</b>) доккхаха долу
    const derivPat =
      /^(\(?)((?:<i>[^<]*<\/i>\s*|<b>[^<]*<\/b>\s*|[^<])*<i>[^<]*(?:\s+от|\s+к)\s*<\/i>\s*<b>[^<]+<\/b>)\)?\s*/;
    const derivRefMatch = source.match(derivPat);
    if (derivRefMatch) {
      let derivHtml = derivRefMatch[2];
      const paren = derivRefMatch[1];
      let afterDeriv = source.substring(derivRefMatch[0].length).trim();
      // Absorb chained derivations: <i>и от </i><b>word2</b>
      let chainMatch: RegExpMatchArray | null;
      while (
        (chainMatch = afterDeriv.match(
          /^((?:<i>[^<]*<\/i>\s*|<b>[^<]*<\/b>\s*|[^<])*<i>[^<]*(?:\s+от|\s+к)\s*<\/i>\s*<b>[^<]+<\/b>)\s*/,
        ))
      ) {
        derivHtml += " " + chainMatch[1];
        afterDeriv = afterDeriv.substring(chainMatch[0].length).trim();
      }
      const derivText = `${paren}${stripStressMarks(stripHtml(derivHtml))
        .replace(/[;,.\s]+$/, "")
        .trim()}${paren ? ")" : ""}`.trim();
      if (!afterDeriv || /^[;,.]/.test(afterDeriv)) {
        // Entire meaning is just the derivation
        const rest = afterDeriv.replace(/^[;,.]\s*/, "");
        if (rest) {
          // There's more text after the derivation — parse it with examples
          source = rest;
        } else {
          return { translation: derivText };
        }
      } else {
        // Derivation + more content — put derivation in note, parse the rest
        source = afterDeriv;
      }
    }

    const examples = extractRuNahExamples(source);

    // Translation is the Chechen text, after removing example blocks
    let translation = source
      .replace(/<b>[^<]*<\/b>(?:[^<;◊]|<i>[^<]*<\/i>)*/g, "") // remove example pairs (including <i> inside)
      .replace(/<[^>]*>/g, "") // strip remaining HTML
      .replace(/\[?\/?[bi]\]/g, "") // strip broken bracket markup: b], i], [b, etc.
      .replace(/\s+/g, " ")
      .replace(/(?:;\s*){2,}/g, "; ") // collapse multiple semicolons
      .replace(/[;:\s]+$/, "") // remove trailing semicolons/colons
      .replace(/^\s*[;:\s]+/, "") // remove leading semicolons/colons
      .replace(/\(\s*\)\s*:?\s*/g, "") // remove empty parentheses (with optional trailing colon)
      .replace(/\s+/g, " ")
      .trim();
    translation = stripStressMarks(translation);

    // Build note from label + cross-ref
    const noteParts: string[] = [];
    if (label) noteParts.push(label);
    if (crossRef) noteParts.push(`см. ${crossRef}`);
    const note = noteParts.length > 0 ? noteParts.join(" ") : undefined;

    // If translation is empty or just "см." and we have a cross-ref, use note as translation
    if (!translation && note) {
      translation = note;
    }

    return {
      translation:
        translation ||
        stripHtml(stripStressMarks(mt))
          .replace(/\(\s*\)\s*:?\s*/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      ...(note && note !== translation ? { note } : {}),
      examples: examples.length > 0 ? examples : undefined,
    };
  });
}

/**
 * Extract grammatical gender/aspect markers from the beginning of translate text.
 * These appear as <i>м </i>, <i>ж </i>, <i>несов.</i>, <i>сов.</i> etc.
 * Returns the implied POS (сущ. for gender, гл. for aspect).
 */
function extractGrammarMarker(
  text: string,
): { marker: string; pos: string } | undefined {
  // Match <i>м ... </i>, <i>ж ... </i>, <i>несов. ...</i>, <i>сов. ...</i>
  // The tag may also contain domain labels like "м тех., стр."
  const m = text.match(
    /^<i>\s*(м и ж|м|ж|ср\.?|несов\.|сов\.)(?=[\s,;<])[^<]*<\/i>/,
  );
  if (!m) return undefined;
  const raw = m[1].trim();
  if (/^(м и ж|м|ж|ср\.?)$/.test(raw)) return { marker: raw, pos: "сущ." };
  if (raw === "несов.") return { marker: "несов.", pos: "гл." };
  if (raw === "сов.") return { marker: "сов.", pos: "гл." };
  return undefined;
}

/**
 * Extract cross-reference target(s) from text containing "см." patterns.
 * Returns the referenced word(s), e.g. "беж" from "<i>см.</i> <b>беж</b>".
 */
function extractCrossRef(text: string): string | undefined {
  // Pattern: <i>см.</i> <b>word</b> or just см. <b>word</b>
  const refs: string[] = [];
  const regex = /(?:<i>\s*)?см\.(?:\s*<\/i>)?\s*<b>([^<]+)<\/b>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const ref = stripStressMarks(match[1])
      .replace(/[;,\s]+$/, "")
      .trim();
    if (ref) refs.push(ref);
  }
  return refs.length > 0 ? refs.join(", ") : undefined;
}

/**
 * Extract a style/domain label from the start of a single meaning text.
 * Handles both <i>перен.</i> and plain-text labels like "перен."
 */
function extractMeaningLabel(text: string): string | undefined {
  // Try <i>label</i> format first
  const m = text.match(/^<i>([^<]+)<\/i>/);
  if (m) {
    const label = m[1].trim().toLowerCase();
    for (const known of SUBJECT_LABELS) {
      if (label.startsWith(known)) return known;
    }
  }
  // Try plain-text label at start (e.g. "перен. текст")
  const lower = text.toLowerCase().trimStart();
  for (const known of SUBJECT_LABELS) {
    if (lower.startsWith(known)) return known;
  }
  return undefined;
}
