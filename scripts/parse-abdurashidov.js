/**
 * Parses Abdurashidov Chechen-Russian / Russian-Chechen Legal Terms Dictionary
 * from the original txt file and saves as a clean JSON.
 *
 * Structure:
 *   - CE-RU section: lines ~160–4186
 *   - RU-CE section: lines ~4200–7348
 */

const fs = require("fs");
const path = require("path");

const TXT_PATH =
  "C:/Users/ShuVarhiDa/Desktop/Abdurashidov_E.D._Chechensko-russkiy_russko-chechenskiy_slovar_uridicheskih_terminov.txt";
const OUTPUT_PATH = path.join(
  __dirname,
  "../dictionaries/abdurashidov_ce_ru_ru_ce.json"
);

const text = fs.readFileSync(TXT_PATH, "utf-8");
const lines = text.split("\n");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSpaces(s) {
  return s
    // Rejoin hyphenated line breaks: "ав- тономига" → "автономига"
    .replace(/(\S)-\s+/g, "$1")
    // Ensure space before ;~ and before ~ (so "автор;~ан" → "автор; ~ан")
    .replace(/;~/g, "; ~")
    .replace(/([^\s])~/g, "$1 ~")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Check if a word contains Chechen-specific characters.
 * Chechen markers: Ӏ/ӏ (palochka), аь/оь/уь/юь/еь (umlauted vowels),
 * хь (h-soft), къ (ejective k), ~(tilde abbreviation)
 */
function hasChechenChars(word) {
  const w = word.toLowerCase();
  if (/[ӀӏI]/.test(w)) return true;
  if (/[аоуюе]ь/.test(w)) return true;
  if (/хь/.test(w)) return true;
  if (/къ/.test(w)) return true;
  if (/цӏ|тӏ|дӏ|чӏ|гӏ/i.test(word)) return true;
  if (/~/.test(w)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Step 1: Extract raw entries (keeping main line and continuations separate)
// ---------------------------------------------------------------------------

function isNoiseLine(trimmed, sp) {
  if (trimmed.length === 0) return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (sp >= 10 && trimmed.length <= 5 && /^[А-ЯЁӀа-яёӀIi]+$/.test(trimmed))
    return true;
  if (/^ж+$/.test(trimmed) || /^х+$/.test(trimmed)) return true;
  if (
    trimmed.startsWith("РУССКО") ||
    trimmed.startsWith("НОХЧИЙН") ||
    trimmed.startsWith("СЛОВАРЬ") ||
    trimmed.startsWith("ЮРИДИЧЕСКИХ") ||
    trimmed.startsWith("ТЕРМИНИЙН") ||
    trimmed.startsWith("ӀЕДАЛЦА") ||
    trimmed.startsWith("ЧЕЧЕНСКО") ||
    trimmed.startsWith("Приложение") ||
    trimmed.startsWith("Юххедиллар") ||
    trimmed.startsWith("Кхиэлехь")
  )
    return true;
  return false;
}

function extractRawEntries(startLine, endLine) {
  const entries = [];
  let current = null;

  for (let i = startLine; i < endLine; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const sp = line.match(/^(\s*)/)[1].length;

    if (isNoiseLine(trimmed, sp)) continue;

    if (sp >= 4) {
      if (current) entries.push(current);
      current = { main: trimmed, cont: [] };
    } else if (current) {
      current.cont.push(trimmed);
    }
  }
  if (current) entries.push(current);
  return entries;
}

// ---------------------------------------------------------------------------
// Step 2: Split CE-RU entry into word (Chechen) and translate (Russian)
// ---------------------------------------------------------------------------

/**
 * CE-RU entries with ~ (tilde): extract first Russian translation.
 *
 * The first Russian translation sits between the grammar block and
 * the first semicolon or tilde that begins sub-entries.
 *
 * Approach: split the full text into segments by ";" and "~".
 * The first segment contains headword + grammar + main translation.
 * Find where the Russian translation starts inside that first segment.
 */
function splitCeRuTildeEntry(fullText) {
  // Find the first ~ in the text. Everything before the semicolon-delimited
  // segment containing ~ is the headword+grammar+translation zone.
  // We need to find the first Russian translation BEFORE any ~ sub-entries.

  // Find the first ~. Go back to the ";" immediately before the Chechen phrase
  // that precedes ~. That ";" marks where sub-entries begin.
  const firstTildeIdx = fullText.indexOf("~");
  let mainEntryEnd = fullText.length;
  if (firstTildeIdx !== -1) {
    const beforeFirstTilde = fullText.substring(0, firstTildeIdx).trimEnd();
    // Find the last ";" before ~
    const lastSemi = beforeFirstTilde.lastIndexOf(";");
    if (lastSemi !== -1) {
      // Check if the segment between lastSemi and ~ contains Chechen words
      const segBetween = beforeFirstTilde.substring(lastSemi + 1).trim();
      const segWords = segBetween.split(/\s+/);
      const hasChechen = segWords.some(
        (w) => hasChechenChars(w.replace(/[(),.;:]/g, ""))
      );
      if (hasChechen) {
        mainEntryEnd = lastSemi;
      } else {
        mainEntryEnd = firstTildeIdx;
      }
    } else {
      mainEntryEnd = firstTildeIdx;
    }
  }

  const beforeTilde = fullText.substring(0, mainEntryEnd).trim();
  const afterPart = fullText.substring(mainEntryEnd).trim();

  const words = beforeTilde.split(/\s+/);

  // Find the first word that looks Russian and is NOT a grammar marker,
  // coming after at least one Chechen word or grammar marker.
  let translateStart = -1;
  let pastFirstWord = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[(),.;:]/g, "");
    const wLower = w.toLowerCase();

    // Skip empty tokens
    if (!w) continue;

    // Grammar markers
    if (/^[бвдйю]$/.test(wLower)) { pastFirstWord = true; continue; }

    // Class pairs like "б,б" or "д,д"
    if (/^[бвдйю],[бвдйю]$/.test(wLower)) { pastFirstWord = true; continue; }

    // Words with Chechen markers
    if (hasChechenChars(w)) { pastFirstWord = true; continue; }

    // Tilde or tilde-compounds
    if (w.includes("~")) { pastFirstWord = true; continue; }

    // Etymology markers: (фр.), (лат.), (гр.), etc.
    if (/^\(/.test(words[i]) || /\)$/.test(words[i])) { pastFirstWord = true; continue; }

    // Numbering: "1.", "2-", "3-"
    if (/^\d[.\-)]/.test(w)) { pastFirstWord = true; continue; }

    // "уст." abbreviation
    if (/^уст\.?$/.test(wLower)) { pastFirstWord = true; continue; }

    // If we haven't passed any Chechen content yet, this word is part of the headword
    if (!pastFirstWord) { pastFirstWord = true; continue; }

    // If the NEXT word is a class marker, this word is a Chechen grammatical form
    // (e.g. "авторш б" = plural + class), not Russian translation
    const nextW = (words[i + 1] || "").replace(/[(),.;:]/g, "").toLowerCase();
    if (/^[бвдйю]$/.test(nextW)) { continue; }

    // If the PREVIOUS word ended with a comma and looks like a Chechen case form,
    // we're in a comma-separated case forms sequence (gen, dat, erg, loc)
    if (i > 0 && words[i - 1].endsWith(",")) {
      const prevBase = words[i - 1].replace(/,$/, "").toLowerCase();
      // Chechen case endings: -ан/-ин (gen), -на/-нна (dat), -о/-но (erg)
      if (/(?:ан|ин|на|нна|о|но)$/.test(prevBase)) { continue; }
    }

    // If this word ends with comma and looks like a case form, skip it
    if (words[i].endsWith(",")) {
      const base = words[i].replace(/,$/, "").toLowerCase();
      if (/(?:ан|ин|на|нна|о|но)$/.test(base)) { continue; }
    }

    // This word looks Russian and comes after Chechen/grammar content
    translateStart = i;
    break;
  }

  if (translateStart <= 0) return { word: fullText, translate: "" };

  // Extract the translation: everything from translateStart in beforeTilde
  const translateRaw = words.slice(translateStart).join(" ");

  // Rebuild word: Chechen grammar part + sub-entries
  const wordPart = words.slice(0, translateStart).join(" ");
  const word = normalizeSpaces(
    wordPart + (afterPart ? "; " + afterPart : "")
  );

  return { word, translate: normalizeSpaces(translateRaw) };
}

/**
 * CE-RU: Chechen headword + grammar, then Russian translation at the end.
 */
function splitCeRuEntry(raw) {
  const fullText = normalizeSpaces([raw.main, ...raw.cont].join(" "));

  // If entry contains ~, it has sub-entries.
  // Extract the FIRST Russian translation that appears after grammar block,
  // before the first ";" or "~" that starts sub-entries.
  if (fullText.includes("~")) {
    return splitCeRuTildeEntry(fullText);
  }

  // Strategy A: If entry has case forms (gen,dat,erg,loc pattern),
  // the translation is after the last case form.
  // The locative case form must be preceded by a comma (part of case form sequence).
  {
    // Match locative form preceded by comma: ", locForm TRANSLATION"
    const re =
      /,\s*(\S+(?:уьнга|чуьнга|нга|га|ге|е))\s+(\([^)]*\)\s+)?([А-Яа-яёЁA-Za-z(].+)$/;
    const m = fullText.match(re);
    if (m) {
      const locWord = m[1];
      const afterLoc = m[3];
      const firstWord = afterLoc.split(/[\s,;(]/)[0];
      // The locative word should look Chechen (share root with headword, not a common Russian word)
      // Simple check: it must not be a common Russian word ending in -е
      if (!hasChechenChars(firstWord) && locWord.length > 3) {
        const splitPos = fullText.indexOf(afterLoc, m.index);
        const word = normalizeSpaces(fullText.substring(0, splitPos));
        const translate = normalizeSpaces(afterLoc);
        return { word, translate };
      }
    }
  }

  // Strategy B: Split after closing paren that contains class info
  // e.g. "( гечдар д,д) амнистия"
  {
    const re = /(\([^)]*[бвдйю][,)][^)]*\))\s+([А-Яа-яёЁ].+)$/;
    const m = fullText.match(re);
    if (m) {
      const afterParen = m[2];
      const firstWord = afterParen.split(/[\s,;]/)[0];
      if (!hasChechenChars(firstWord)) {
        const parenEnd = m.index + m[1].length;
        return {
          word: normalizeSpaces(fullText.substring(0, parenEnd)),
          translate: normalizeSpaces(afterParen),
        };
      }
    }
  }

  // Strategy C: Split after class pair (б,б / д,д / ю,ю / в,ю,б)
  {
    const re =
      /([бвдйю]\s*,\s*[бвдйю](?:\s*,\s*[бвдйю])?)\s+([А-Яа-яёЁA-Za-z(].+)$/;
    const m = fullText.match(re);
    if (m) {
      const after = m[2];
      const firstWord = after.split(/[\s,;(]/)[0];
      if (!hasChechenChars(firstWord)) {
        const markerEnd = m.index + m[1].length;
        return {
          word: normalizeSpaces(fullText.substring(0, markerEnd)),
          translate: normalizeSpaces(after),
        };
      }
    }
  }

  // Strategy D: Split after standalone class marker (ю, в, д, б)
  // Find the LAST standalone class marker followed by Russian text
  {
    const re = /\s([бвдйю])\s+([А-Яа-яёЁA-Za-z(].+)$/;
    const m = fullText.match(re);
    if (m) {
      const after = m[2];
      const firstWord = after.split(/[\s,;(]/)[0];
      if (!hasChechenChars(firstWord)) {
        const splitPos = fullText.lastIndexOf(m[0]) + 1 + m[1].length;
        return {
          word: normalizeSpaces(fullText.substring(0, splitPos)),
          translate: normalizeSpaces(fullText.substring(splitPos)),
        };
      }
    }
  }

  // Strategy E: For entries without grammar markers, scan words right-to-left
  // Find the boundary between Chechen and Russian text
  {
    const words = fullText.split(/\s+/);
    // Go from right to left: find the leftmost word that starts a continuous
    // Russian-only suffix
    let boundary = words.length; // no split
    for (let i = words.length - 1; i >= 1; i--) {
      const w = words[i].replace(/[(),.;:]/g, "");
      if (hasChechenChars(w)) break;
      // Check if this word looks Russian (common Russian word patterns)
      boundary = i;
    }
    if (boundary < words.length && boundary >= 1) {
      return {
        word: normalizeSpaces(words.slice(0, boundary).join(" ")),
        translate: normalizeSpaces(words.slice(boundary).join(" ")),
      };
    }
  }

  // Fallback
  return { word: fullText, translate: "" };
}

// ---------------------------------------------------------------------------
// Step 3: Split RU-CE entry into word (Russian) and translate (Chechen)
// ---------------------------------------------------------------------------

/**
 * Build a set of known Russian words from:
 * 1. CE-RU translate fields (guaranteed Russian)
 * 2. First words of all RU-CE entries (always Russian)
 * 3. Common Russian prepositions, conjunctions, etc.
 */
function buildRussianVocabulary(ceRuEntries, ruCeRawEntries) {
  const vocab = new Set();

  // From CE-RU translations — add all words but filter strictly:
  // only add words that look like standard Russian (no Chechen digraphs)
  for (const raw of ceRuEntries) {
    const { translate } = splitCeRuEntry(raw);
    if (translate) {
      translate.split(/[\s,;()]+/).forEach((w) => {
        const clean = w.toLowerCase().replace(/[^а-яёа-яё-]/g, "");
        if (clean.length < 2 || hasChechenChars(clean)) return;
        // Reject words that look Chechen (common Chechen patterns without markers)
        // Chechen words often end in: -ар, -ор, -ам, -алла, -хо, -дар, -бар
        // Only add if word has a recognizable Russian morphological ending
        if (
          /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ых|их|ую|юю)$/.test(clean) ||
          /(?:ние|ция|ство|ость|мент|ент|тель|ник|чик|щик|лец|арь|нок|сия|тия|зия)$/.test(clean) ||
          /(?:ать|ять|ить|еть|оть|уть|ть|ти|чь)$/.test(clean) ||
          /(?:нный|нная|нное|нные|тый|тая|тое|тые|мый|мая|мое|мые)$/.test(clean) ||
          /(?:кт|нт|рд|зм|аж|еж|ыск|иск|атор|анка|нка|лка|зка|тка)$/.test(clean) ||
          clean.length <= 3
        ) {
          vocab.add(clean);
        }
      });
    }
  }

  // All words from RU-CE headwords are Russian.
  // Collect words until we hit something non-Russian.
  // Collect Russian headword words from RU-CE entries.
  // Add words that are adjacent to known vocab AND look Russian morphologically.
  const ruMorphWide =
    /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|их|ых|ую|юю|ой|ей|ом|ем|ам|ям|ах|ях|ов|ев|ами|ями|ние|ция|ство|ость|мент|тель|ник|кт|нт|зм|аж|еж|ка|ец|та|да|ок|ор|ер|ус|ра|ва|ия|ья|ье|ьи|ей|щий|щая|щее|щие|нный|нная|нное|тый|тая|мый|мая|сия|тия|нка|лка|тка|ата|ина|атор|ать|ять|ить|еть|ть|чь|ти|сти)$/;
  for (let pass = 0; pass < 3; pass++) {
    for (const raw of ruCeRawEntries) {
      const fullText = normalizeSpaces([raw.main, ...raw.cont].join(" "));
      const words = fullText.split(/\s+/);
      for (const w of words) {
        const clean = w.toLowerCase().replace(/[(),.;:~\"]/g, "");
        if (!clean || clean.length < 2) continue;
        if (hasChechenChars(clean)) break;
        if (/^[бвдйю]$/.test(clean)) break;
        const stripped = w.replace(/[(),.;:]/g, "");
        if (/^[бвдйю]+$/.test(stripped) && stripped.length <= 3) break;
        if (vocab.has(clean)) continue; // already known from CE-RU translations
        // Add only if Russian morphology matches
        if (ruMorphWide.test(clean)) {
          vocab.add(clean);
        } else if (clean.length <= 3) {
          vocab.add(clean); // short prepositions etc.
        } else {
          break; // non-Russian-looking word → stop collecting
        }
      }
    }
  }

  // Common Russian function words and juridical terms (incl. case forms)
  [
    "в", "на", "с", "к", "о", "у", "из", "от", "по", "за", "до", "об",
    "без", "над", "под", "при", "через", "для", "не", "ни", "во", "со",
    "ко", "и", "а", "но", "или", "же", "ли", "бы", "как", "что", "чем",
    "где", "его", "её", "их", "все", "это", "то", "одной", "одного",
    "момент", "сторон", "между", "путем", "путём",
    // Nouns: nom/gen/dat/acc/instr/prep forms
    "лицо", "лица", "лицу", "лицом", "лице",
    "суд", "суда", "суду", "судом", "суде",
    "дело", "дела", "делу", "делом", "деле",
    "закон", "закона", "закону", "законом", "законе",
    "право", "права", "праву", "правом", "праве",
    "иск", "иска", "иску", "иском", "иске",
    "вред", "вреда", "вреду", "вредом", "вреде",
    "мера", "меры", "мере", "меру", "мерой",
    "форма", "формы", "форме", "форму", "формой",
    "норма", "нормы", "норме", "норму", "нормой",
    "часть", "части", "частью",
    "найма", "найму", "наймом", "найме", "наём",
    "брак", "брака", "браку", "браком", "браке",
    "штраф", "штрафа", "штрафу", "штрафом", "штрафе",
    "долг", "долга", "долгу", "долгом", "долге",
    "срок", "срока", "сроку", "сроком", "сроке",
    "указ", "указа", "указу", "указом", "указе",
    "устав", "устава", "уставу", "уставом", "уставе",
    "след", "следа", "следу", "следом", "следе",
    "обыск", "обыска", "обыску", "обыском", "обыске",
    "арест", "ареста", "аресту", "арестом", "аресте",
    "кодекс", "кодекса", "кодексу", "кодексом", "кодексе",
    "процесс", "процесса", "процессу", "процессом", "процессе",
    // Common RU-CE multi-word term components
    "договор", "договора", "договору", "договором", "договоре",
    "помещения", "помещение", "помещению", "помещением",
    "жилого", "жилое", "жилой", "жилым", "жилых",
    "документ", "документа", "документов", "документы",
    "доказательств", "доказательства", "доказательство",
    "преступления", "преступление", "преступлений",
    "решения", "решение", "решений", "решению",
    "обвинения", "обвинение", "обвинений",
    "свободы", "свобода", "свободу", "свободой",
    "власти", "власть", "властью", "властей",
    "порядка", "порядок", "порядку", "порядком",
    "ответственности", "ответственность", "ответственностью",
    "показаний", "показания", "показание",
    "обязанности", "обязанность", "обязанностей",
    "сторон", "стороны", "сторону", "стороной", "сторонам",
    "работника", "работник", "работников", "работнику",
    "помощи", "помощь", "помощью",
    "защиты", "защита", "защиту", "защитой",
    "вины", "вину", "виной", "вине",
  ].forEach((w) => vocab.add(w));

  return vocab;
}

/**
 * RU-CE: Russian word/phrase first, then Chechen translation.
 *
 * Uses vocabulary-based approach: scan words left-to-right,
 * as long as words are in Russian vocabulary, they are part of the headword.
 * First non-Russian word = start of Chechen translation.
 */
function splitRuCeEntry(raw, russianVocab) {
  const fullText = normalizeSpaces([raw.main, ...raw.cont].join(" "));
  const words = fullText.split(/\s+/);
  if (words.length <= 1) return { word: fullText, translate: "" };

  // Find the boundary: last consecutive Russian word from the start
  let boundary = 1; // at minimum, the first word is Russian
  for (let i = 1; i < words.length; i++) {
    const w = words[i].toLowerCase().replace(/[(),.;:\"]/g, "");
    if (!w) { boundary = i + 1; continue; }

    // Chechen-specific chars → definitely not Russian
    if (hasChechenChars(words[i])) break;

    // Class markers → Chechen grammar, translation already started
    if (/^[бвдйю]$/.test(w)) break;
    if (/^[бвдйю],[бвдйю]/.test(w)) break;
    // Token like "в,ю,б" or "(б)" — class markers with punctuation
    const stripped = words[i].replace(/[(),.;:]/g, "");
    if (/^[бвдйю]+$/.test(stripped) && stripped.length <= 3) break;

    // Check if word is in Russian vocabulary
    if (russianVocab.has(w)) {
      // But if next word is a class marker (ю, б, д, в) or class pair,
      // then THIS word is the start of the Chechen translation (borrowed word)
      const nxtRaw = (words[i + 1] || "");
      const nxt = nxtRaw.replace(/[(),.;:]/g, "").toLowerCase();
      if (/^[бвдйю]+$/.test(nxt) && nxt.length <= 3) {
        break; // this word is Chechen borrowed form, not Russian headword
      }
      boundary = i + 1;
      continue;
    }

    // Check if word looks like Russian by morphological patterns
    if (
      /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ых|их|ую|юю)$/.test(w) || // adj
      /(?:ние|ция|ство|ость|мент|ент|тель|ник|чик|щик|лец|арь|нок|сия|тия|зия|нка|лка|зка|тка|дка|жка|рка|вка|йка)$/.test(w) || // nouns
      /(?:ать|ять|ить|еть|оть|уть|ть|ти|сти|чь)$/.test(w) || // verbs
      /(?:нный|нная|нное|нные|тый|тая|тое|тые|мый|мая|мое|мые)$/.test(w) || // participles
      /(?:кт|нт|рд|зм|аж|еж|ёж|ыск|иск|ёнок|енок|атор)$/.test(w) || // borrowed nouns
      /(?:анец|анка|ство|ация|еция|иция|уция|яция)$/.test(w) || // more nouns
      /(?:суд|суда|иск|иска|лиц|лица|дела|дело|вина|вред|меры|мера|право|закон|кодекс|устав|штраф|долг|срок|след|грабеж|обыск)$/.test(w) // specific terms
    ) {
      boundary = i + 1;
      continue;
    }

    // Check if it's a compound with hyphen where both parts are Russian
    if (w.includes("-") && w.split("-").every((p) => russianVocab.has(p) || p.length <= 2)) {
      boundary = i + 1;
      continue;
    }

    // Not recognized as Russian → this is the start of Chechen translation
    break;
  }

  if (boundary >= words.length) {
    // All words look Russian — no translation found
    return { word: fullText, translate: "" };
  }

  return {
    word: normalizeSpaces(words.slice(0, boundary).join(" ")),
    translate: normalizeSpaces(words.slice(boundary).join(" ")),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ceRuRaw = extractRawEntries(159, 4186);
console.log("CE-RU raw entries:", ceRuRaw.length);

const ruCeRaw = extractRawEntries(4199, 7349);
console.log("RU-CE raw entries:", ruCeRaw.length);

// Build Russian vocabulary for RU-CE splitting
const russianVocab = buildRussianVocabulary(ceRuRaw, ruCeRaw);
console.log("Russian vocabulary:", russianVocab.size, "words");

let allEntries = [];
let id = 1;

for (const raw of ceRuRaw) {
  const { word, translate } = splitCeRuEntry(raw);
  allEntries.push({ id: String(id), section: "ce_ru", word, translate });
  id++;
}

for (const raw of ruCeRaw) {
  const { word, translate } = splitRuCeEntry(raw, russianVocab);
  allEntries.push({ id: String(id), section: "ru_ce", word, translate });
  id++;
}

// --- Post-processing: fix broken parentheticals ---
for (const entry of allEntries) {
  // Case 1: word ends with "(" — move "text)" from translate into word
  if (entry.word.trimEnd().endsWith("(") && entry.translate) {
    const closeIdx = entry.translate.indexOf(")");
    if (closeIdx !== -1) {
      const parenContent = entry.translate.substring(0, closeIdx + 1);
      entry.word = normalizeSpaces(entry.word + parenContent);
      entry.translate = normalizeSpaces(entry.translate.substring(closeIdx + 1));
    }
  }

  // Case 2: translate starts with "(..." — move the parenthetical group into word
  // These are Chechen clarifications/alternatives that belong with the headword.
  // Repeat until translate no longer starts with "("
  while (entry.translate && entry.translate.trimStart().startsWith("(")) {
    let depth = 0;
    let closeIdx = -1;
    for (let i = 0; i < entry.translate.length; i++) {
      if (entry.translate[i] === "(") depth++;
      if (entry.translate[i] === ")") {
        depth--;
        if (depth === 0) { closeIdx = i; break; }
      }
    }
    if (closeIdx === -1) break; // unmatched paren — stop
    const parenGroup = entry.translate.substring(0, closeIdx + 1);
    const rest = entry.translate.substring(closeIdx + 1).trim();
    entry.word = normalizeSpaces(entry.word + " " + parenGroup);
    entry.translate = normalizeSpaces(rest);
  }

  // Case 3: Fix unmatched open parens in word — move text up to ")" from translate
  {
    const opens = (entry.word.match(/\(/g) || []).length;
    const closes = (entry.word.match(/\)/g) || []).length;
    if (opens > closes && entry.translate) {
      // Find the closing paren(s) we need in translate
      let needed = opens - closes;
      let closeIdx = -1;
      let depth = needed;
      for (let i = 0; i < entry.translate.length; i++) {
        if (entry.translate[i] === "(") depth++;
        if (entry.translate[i] === ")") {
          depth--;
          if (depth === 0) { closeIdx = i; break; }
        }
      }
      if (closeIdx !== -1) {
        const moveToWord = entry.translate.substring(0, closeIdx + 1);
        entry.word = normalizeSpaces(entry.word + " " + moveToWord);
        entry.translate = normalizeSpaces(entry.translate.substring(closeIdx + 1));
      }
    }
  }

  // Case 4: Clean up "; ;" artifacts in word
  entry.word = entry.word.replace(/;\s*;/g, ";");

  // Case 4: RU-CE — if word starts with duplicated first word, remove the duplicate
  // e.g. "авантюрист авантюрист (...)" → word should be just "авантюрист"
  if (entry.section === "ru_ce") {
    const words = entry.word.split(/\s+/);
    if (words.length >= 2 && words[0].toLowerCase() === words[1]?.toLowerCase().replace(/[(),.;:]/g, "")) {
      // Move the duplicate and everything after it into translate
      entry.translate = normalizeSpaces(words.slice(1).join(" ") + (entry.translate ? " " + entry.translate : ""));
      entry.word = words[0];
    }
  }
}

// --- Post-processing: clean Chechen segments from CE-RU translate ---
// In CE-RU tilde entries, translate may contain trailing ";"-segments
// that are Chechen sub-entry phrases (not Russian translation).
// Move them back to word.
for (const entry of allEntries) {
  if (entry.section === "ce_ru" && entry.translate && entry.translate.includes(";")) {
    const segments = entry.translate.split(";");
    const russianSegs = [];
    const chechenSegs = [];
    let hitNonRussian = false;

    for (const seg of segments) {
      const trimmed = seg.trim();
      if (!trimmed) continue;
      if (hitNonRussian) {
        chechenSegs.push(trimmed);
        continue;
      }
      // Check: does this segment look Russian?
      const segWords = trimmed.split(/\s+/);
      // A segment is considered non-Russian only if NO word in it looks Russian
      const anyRussian = segWords.some((w) => {
        const clean = w.toLowerCase().replace(/[(),.;:~\"-]/g, "");
        if (!clean) return true;
        if (clean.length <= 3) return true; // short words ambiguous, assume Russian
        if (hasChechenChars(clean)) return false;
        if (russianVocab.has(clean)) return true;
        // Comprehensive Russian morphology check
        if (
          /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|их|ых|ую|юю)$/.test(clean) ||
          /(?:ние|ция|ство|ость|мент|тель|ник|кт|нт|зм|аж|еж|ка|ец|та|да)$/.test(clean) ||
          /(?:ать|ять|ить|еть|ть|чь|ти|сти)$/.test(clean) ||
          /(?:нный|нная|нное|нные|тый|тая|тое|мый|мая|мое|щий|щая|щее|щие)$/.test(clean) ||
          /(?:сия|тия|зия|нка|лка|зка|тка|жка|рка|вка|йка|шка|пка)$/.test(clean) ||
          /(?:ация|еция|иция|уция|яция|ение|ание|ство|ость)$/.test(clean) ||
          /(?:ство|вие|тие|ище|ище|ина|ата|ота|ута|ёнок|енок|атор)$/.test(clean) ||
          /(?:анец|анка|ёр|ер|ор|ёж|еж|ёк|ок|ёт|ет|ус|ум|ёз|ёзд)$/.test(clean)
        ) return true;
        return false;
      });
      if (anyRussian) {
        russianSegs.push(trimmed);
      } else {
        hitNonRussian = true;
        chechenSegs.push(trimmed);
      }
    }

    if (chechenSegs.length > 0) {
      entry.translate = russianSegs.join("; ").trim();
      entry.word = normalizeSpaces(
        entry.word + "; " + chechenSegs.join("; ")
      );
    }
  }
}

// --- Second pass: clean Chechen from translate (after all paren fixes) ---
for (const entry of allEntries) {
  if (entry.section === "ce_ru" && entry.translate && entry.translate.includes(";")) {
    const segments = entry.translate.split(";");
    const keep = [];
    const move = [];
    let hitNonRussian = false;
    for (const seg of segments) {
      const trimmed = seg.trim();
      if (!trimmed) continue;
      if (hitNonRussian) { move.push(trimmed); continue; }
      const segWords = trimmed.split(/\s+/);
      const isRussian = segWords.some((w) => {
        const c = w.toLowerCase().replace(/[(),.;:~\"-]/g, "");
        if (!c || c.length <= 3) return true;
        if (hasChechenChars(c)) return false;
        if (russianVocab.has(c)) return true;
        if (/(?:ый|ий|ой|ая|ое|ее|ые|ие|ого|его|ому|ему|ым|их|ых|ую|ние|ция|ство|ость|мент|тель|ник|кт|нт|зм|ка|ец|та|да|ок|ор|ер|ра|ва|ия|ей|ов|ам|ями|ами|ать|ять|ить|ть|нный|нная|тый|мый|сия|тия|ата|ина)$/.test(c)) return true;
        return false;
      });
      if (isRussian) { keep.push(trimmed); } else { hitNonRussian = true; move.push(trimmed); }
    }
    if (move.length > 0) {
      entry.translate = keep.join("; ");
      entry.word = normalizeSpaces(entry.word + "; " + move.join("; "));
    }
  }
}

// --- Final cleanup pass ---
for (const entry of allEntries) {
  // Clean "; ;" artifacts
  while (entry.word.includes("; ;")) entry.word = entry.word.replace(/;\s*;/g, ";");
  while (entry.translate.includes("; ;")) entry.translate = entry.translate.replace(/;\s*;/g, ";");
  // Clean leading/trailing semicolons and spaces
  entry.word = entry.word.replace(/^[;\s]+/, "").replace(/[;\s]+$/, "").trim();
  entry.translate = entry.translate.replace(/^[;\s]+/, "").trim();
  // Re-normalize spaces
  entry.word = normalizeSpaces(entry.word);
  entry.translate = normalizeSpaces(entry.translate);
}

console.log("Total entries:", allEntries.length);

// --- Save ---
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allEntries, null, 2), "utf-8");
console.log("\nSaved to:", OUTPUT_PATH);

// --- Stats ---
const ceRu = allEntries.filter((e) => e.section === "ce_ru");
const ruCe = allEntries.filter((e) => e.section === "ru_ce");
const emptyTranslate = allEntries.filter((e) => !e.translate);
const ceRuEmpty = emptyTranslate.filter((e) => e.section === "ce_ru");
const ruCeEmpty = emptyTranslate.filter((e) => e.section === "ru_ce");

console.log("\n--- Stats ---");
console.log("CE-RU:", ceRu.length, " (empty translate:", ceRuEmpty.length + ")");
console.log("RU-CE:", ruCe.length, " (empty translate:", ruCeEmpty.length + ")");

// Show samples
console.log("\n=== CE-RU samples ===");
ceRu.slice(0, 12).forEach((e) =>
  console.log(
    `  id=${e.id}: word='${e.word.substring(0, 55)}' | translate='${e.translate.substring(0, 40)}'`
  )
);

console.log("\n=== RU-CE samples ===");
ruCe.slice(0, 12).forEach((e) =>
  console.log(
    `  id=${e.id}: word='${e.word.substring(0, 45)}' | translate='${e.translate.substring(0, 40)}'`
  )
);

console.log("\n=== CE-RU empty translate ===");
ceRuEmpty.slice(0, 10).forEach((e) =>
  console.log(`  id=${e.id}: '${e.word.substring(0, 70)}'`)
);

console.log("\n=== RU-CE empty translate ===");
ruCeEmpty.slice(0, 10).forEach((e) =>
  console.log(`  id=${e.id}: '${e.word.substring(0, 70)}'`)
);
