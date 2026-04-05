const fs = require('fs');
const path = require('path');

const inputPath =
  'H:/MyDocument/MyArhiv/OneDrive - Medical College/MyArhiv/Изучение языков/чеченские словари/Исмаилов-А.-Русско-чеченский-словарь-из-книги-Дош.txt';
const outputSimple = path.join(
  __dirname,
  '..',
  'dictionaries',
  'ismailov_ru_ce.json',
);
const outputParsed = path.join(
  __dirname,
  '..',
  'dictionaries',
  'parsed',
  'ismailov-ru-nah.json',
);

const text = fs.readFileSync(inputPath, 'utf-8');
const lines = text.split(/\r?\n/);

// Noun class pattern: (ду), (ю), (бу), (бу-ду), (ву-бу), (ву-ю-бу), (д), etc.
const NOUN_CLASS_RE = /\(([вбдю][у]?(?:-[вбдю][у]?)*)\)/g;
const NOUN_CLASS_SINGLE_RE = /\(([вбдю][у]?(?:-[вбдю][у]?)*)\)/;

/**
 * Parse a single dictionary line.
 *
 * Format: "русское слово – чеченский перевод; -суффикс (класс)"
 * or:     "русское слово (пояснение) – 1.перевод1; 2.перевод2; -аш (ду)"
 *
 * Some lines have continuations on the next line (rare).
 */

function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Split by " – " (space-dash-space)
  const dashIdx = trimmed.indexOf(' – ');
  if (dashIdx === -1) return null;

  const wordPart = trimmed.substring(0, dashIdx).trim();
  const translatePart = trimmed.substring(dashIdx + 3).trim();

  if (!wordPart || !translatePart) return null;

  return { word: wordPart, rawTranslate: translatePart };
}

/**
 * Parse the translation part to extract:
 * - meanings (possibly numbered: 1.xxx 2.xxx)
 * - plural suffix (-аш, -наш, etc.)
 * - noun class (ду, ю, бу, etc.)
 */
function parseTranslation(raw) {
  let text = raw.trim();

  // Normalize spaces inside parens: "( ю)" → "(ю)"
  text = text.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

  // Extract noun classes from the end or throughout
  const nounClasses = [];
  let match;
  const classRe = /\(([вбдю][у]?(?:-[вбдю][у]?)*)\)/g;
  while ((match = classRe.exec(text)) !== null) {
    nounClasses.push(match[1]);
  }
  // Use the last noun class as the main one (usually applies to the whole entry)
  const nounClass = nounClasses.length > 0 ? nounClasses[nounClasses.length - 1] : null;

  // Remove noun classes from text for cleaner output
  let cleanText = text.replace(/\s*\([вбдю][у]?(?:-[вбдю][у]?)*\)/g, '').trim();

  // Extract plural suffix patterns: -аш, -наш, -еш, -ий, -ой, -й, -ш, etc.
  // These appear like: "слово; -аш" or "слово; -наш"
  let pluralSuffix = null;
  const pluralMatch = cleanText.match(/;\s*-\s*(аш|наш|еш|ерий|арий|ш|й|ой|ий|рш|рчий|рий|дой|аьршаш|наш|еш|гӀар)(?:\s|$|;|,)/);
  if (pluralMatch) {
    pluralSuffix = pluralMatch[1];
  }

  // Also check for standalone plural suffixes: "; -аш" at end
  const endPluralMatch = cleanText.match(/;\s*-\s*(аш|наш|еш|ерий|арий|ш|й|ой|ий|рш|рчий|дой)$/);
  if (endPluralMatch && !pluralSuffix) {
    pluralSuffix = endPluralMatch[1];
  }

  // Check if there are numbered meanings: 1.xxx 2.xxx or 1.xxx; 2.xxx
  // Match "1." at start, or "2." preceded by space/semicolon
  const hasNumbered = /(?:^|[;\s])\d+\s*[.)]\s*/.test(cleanText);

  const meanings = [];

  if (hasNumbered) {
    // Split by numbered items: "1." "2." etc, possibly preceded by ";", space, or at start
    const parts = cleanText.split(/(?:^|[;\s]+)\d+\s*[.)]\s*/);

    // parts[0] is text before the first number — if non-empty, it's the first meaning
    // (e.g. "дахка, охьадахка, тӀедахка; 2.класть дрова..." → parts[0] = "дахка, охьадахка, тӀедахка")
    if (parts[0] && parts[0].trim()) {
      let preamble = parts[0].trim().replace(/[;\s]+$/, '').trim();
      if (preamble) {
        preamble = preamble.replace(/;\s*-\s*(аш|наш|еш|ш|й|ой|ий|рш)\s*$/, '').trim();
        meanings.push(cleanMeaning(preamble));
      }
    }

    for (let i = 1; i < parts.length; i++) {
      let part = parts[i].trim().replace(/;\s*$/, '').trim();
      if (part) {
        // Clean up plural suffixes from individual meaning
        part = part.replace(/;\s*-\s*(аш|наш|еш|ш|й|ой|ий|рш)\s*$/, '').trim();
        meanings.push(cleanMeaning(part));
      }
    }

    // If no parts were captured (edge case), treat whole text as one meaning
    if (meanings.length === 0) {
      meanings.push(cleanMeaning(cleanText));
    }
  } else {
    // Single meaning (may contain semicolons for synonyms, keep together)
    // Remove trailing plural suffix for cleaner display
    let meaningText = cleanText
      .replace(/;\s*-\s*(аш|наш|еш|ерий|арий|ш|й|ой|ий|рш|рчий|дой|гӀар|аьршаш)\s*$/g, '')
      .replace(/;\s*$/, '')
      .trim();

    if (meaningText) {
      meanings.push(cleanMeaning(meaningText));
    }
  }

  return { meanings, nounClass, pluralSuffix };
}

function cleanMeaning(text) {
  // Remove trailing commas, semicolons, spaces
  let cleaned = text.replace(/[,;\s]+$/, '').trim();
  // Remove leading/trailing dashes with spaces
  cleaned = cleaned.replace(/^–\s*/, '').replace(/\s*–$/, '').trim();
  return cleaned;
}

// Parse all lines, handling multi-line entries
const entries = [];
let pendingEntry = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  if (!trimmed) continue;

  // Check if this line is a continuation of the previous entry
  // Continuation lines start with a digit + period (like "2.класть дрова...")
  // or don't contain " – " and aren't a new entry
  if (pendingEntry && !trimmed.includes(' – ')) {
    // This is a continuation line
    pendingEntry.rawTranslate += ' ' + trimmed;
    continue;
  }

  // Flush pending entry
  if (pendingEntry) {
    entries.push(pendingEntry);
    pendingEntry = null;
  }

  const parsed = parseLine(trimmed);
  if (!parsed) continue;

  // Check if next line is a continuation
  pendingEntry = parsed;
}

// Flush last entry
if (pendingEntry) {
  entries.push(pendingEntry);
}

console.log(`Parsed ${entries.length} entries`);

// Generate simple format
const simpleEntries = entries.map((entry, idx) => ({
  id: String(idx + 1),
  word: entry.word,
  translate: entry.rawTranslate,
}));

// Generate parsed format
const parsedEntries = entries.map((entry) => {
  const { meanings, nounClass, pluralSuffix } = parseTranslation(
    entry.rawTranslate,
  );

  const result = { word: entry.word };

  // Build meanings array
  if (meanings.length > 0) {
    result.meanings = meanings.map((m) => {
      const obj = { translation: m };
      return obj;
    });
  }

  // Grammar info
  if (nounClass || pluralSuffix) {
    result.grammar = {};
    if (nounClass) result.grammar.nounClass = nounClass;
    if (pluralSuffix) result.grammar.pluralSuffix = pluralSuffix;
  }

  return result;
});

// Write outputs
fs.writeFileSync(outputSimple, JSON.stringify(simpleEntries, null, 2), 'utf-8');
console.log(`Simple format written to: ${outputSimple}`);

fs.writeFileSync(
  outputParsed,
  JSON.stringify(parsedEntries, null, 2),
  'utf-8',
);
console.log(`Parsed format written to: ${outputParsed}`);

// Show samples
console.log('\n--- First 10 entries (simple) ---');
for (const e of simpleEntries.slice(0, 10)) {
  console.log(`[${e.id}] ${e.word} → ${e.translate.substring(0, 80)}`);
}

console.log('\n--- First 5 entries (parsed) ---');
console.log(JSON.stringify(parsedEntries.slice(0, 5), null, 2));

console.log('\n--- Middle entries 3000-3005 (parsed) ---');
console.log(JSON.stringify(parsedEntries.slice(3000, 3005), null, 2));

console.log('\n--- Last 5 entries (parsed) ---');
console.log(JSON.stringify(parsedEntries.slice(-5), null, 2));

// Stats
const withNounClass = parsedEntries.filter(
  (e) => e.grammar && e.grammar.nounClass,
).length;
const withPlural = parsedEntries.filter(
  (e) => e.grammar && e.grammar.pluralSuffix,
).length;
const multiMeaning = parsedEntries.filter(
  (e) => e.meanings && e.meanings.length > 1,
).length;
console.log(`\n--- Stats ---`);
console.log(`Total entries: ${parsedEntries.length}`);
console.log(`With noun class: ${withNounClass}`);
console.log(`With plural suffix: ${withPlural}`);
console.log(`Multi-meaning: ${multiMeaning}`);
