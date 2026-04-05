const fs = require('fs');
const path = require('path');

const inputPath = 'H:/MyDocument/MyArhiv/OneDrive - Medical College/MyArhiv/Изучение языков/чеченские словари/Исмаилов-А.-Чеченско-русский-словарь-из-книги-Дош.txt';
const outputSimple = path.join(__dirname, '..', 'dictionaries', 'ismailov_ce_ru.json');
const outputParsed = path.join(__dirname, '..', 'dictionaries', 'parsed', 'ismailov-nah-ru.json');

const text = fs.readFileSync(inputPath, 'utf-8');
const lines = text.split(/\r?\n/);

/**
 * Parse a dictionary entry line.
 *
 * Typical formats:
 *   АапIелг,– аш (бу-ду)– указательный палец руки
 *   Абаде (ю) – вечность (без конца)
 *   Абат, – аш (ду) – азбука; букварь
 *   Аганан – колыбельный
 *   АгIолаца – поддержать (морально)
 *   Ага, –наш (ду)– колыбель; (глаг.) долбить; скоблить, гравировать
 *   Агархо(ву-бу) – гравёр
 *   АвгIан (авхан) – афганец
 *   Аз, аьзнаш, (ду) – голос; грамм.звук
 *   Алу (ю) – пламя; уголья; жар
 *
 * Strategy:
 * The entry has a "head" part (word + grammar) and a "translation" part (Russian).
 * The translation always starts with a lowercase Russian letter or opening bracket.
 * We find the dash "–" that is immediately followed by a Russian word (lowercase Cyrillic).
 */

// Noun class pattern: (бу), (ду), (ю), (бу-ду), (ву-ю-бу), etc.
const NOUN_CLASS_RE = /\(([вбдю][у]?(?:-[вбдю][у]?)*)\)/;

// Search for translation-separating dash using a specific dash character
function findDashWithChar(line, dashChar) {
  let idx = 0;
  while (true) {
    idx = line.indexOf(dashChar, idx);
    if (idx === -1) return -1;

    // For regular hyphen "-", require space or closing paren before and space after: " - " or ")- "
    if (dashChar === '-') {
      const charBefore = idx > 0 ? line[idx - 1] : '';
      const charAfter = idx + 1 < line.length ? line[idx + 1] : '';
      if (!(charBefore === ' ' || charBefore === ')') || charAfter !== ' ') {
        idx = idx + 1;
        continue;
      }
    }

    const afterDash = line.substring(idx + dashChar.length).trimStart();

    if (/^[a-zA-Z\u0400-\u04FF\u00AB\u00BB\u201C\u201D\u201E\u201F]/.test(afterDash)) {
      // Skip plural suffixes: аш, наш, еш, etc.
      const suffixMatch = afterDash.match(/^(аш|наш|еш|ерий|арий|ш|й|ой|ий)(?=[\s()\-\u2013,;]|$)/);
      if (suffixMatch) {
        idx = idx + 1;
        continue;
      }
      return idx;
    }

    // "–" followed by "(" with content (may have space after paren)
    if (/^\(\s*[а-яА-Я]/.test(afterDash)) {
      // If it's a noun class like (ду), check if there's Russian text after it
      const nounClassAfterDash = afterDash.match(/^\([вбдю][у]?(?:-[вбдю][у]?)*\)\s*/);
      if (nounClassAfterDash) {
        // Check what's after the noun class
        const afterClass = afterDash.substring(nounClassAfterDash[0].length);
        if (/^[а-яёА-ЯЁ]/.test(afterClass)) {
          return idx; // Translation after noun class
        }
        idx = idx + 1;
        continue;
      }
      // Not a noun class — it's a style label like (диал.), (астрон.), etc.
      return idx;
    }

    idx = idx + 1;
  }
}

// Find the translation-separating dash (tries em-dash first, then regular hyphen)
function findTranslationDash(line) {
  const idx = findDashWithChar(line, '\u2013'); // em-dash –
  if (idx !== -1) return idx;
  return findDashWithChar(line, '-'); // fallback: regular hyphen
}

function parseEntryLine(line) {
  const dashIdx = findTranslationDash(line);

  let headPart, translation;
  if (dashIdx === -1) {
    headPart = line.trim();
    translation = '';
  } else {
    headPart = line.substring(0, dashIdx).trim();
    // Remove leading dash and whitespace from translation
    translation = line.substring(dashIdx + 1).trim();
  }

  // Clean trailing commas/dashes from head
  headPart = headPart.replace(/[,–\s]+$/, '').trim();

  // Extract noun class from head
  let nounClass = null;
  const classMatch = headPart.match(NOUN_CLASS_RE);
  if (classMatch) {
    nounClass = classMatch[1];
  }

  // Also check for noun class written without parens directly after word, e.g. "Агархо(ву-бу)"
  // Already handled by NOUN_CLASS_RE

  // Extract the base word (before comma, plural suffix, parenthetical)
  // First, get everything before the first comma or parenthetical grammar info
  let word = headPart;

  // Remove plural suffix patterns like ", – аш", ",– аш", ", –наш", ", аьзнаш,"
  // Pattern: optional comma, optional space, optional dash, space, plural word ending in аш/наш/etc
  word = word.replace(/,?\s*–?\s*(аш|наш|еш|ерий|арий|ш|й|ой|ий)(?=[\s()\-–,;]|$)/g, '');

  // Remove noun class in parens
  word = word.replace(/\s*\([^)]*\)\s*/g, ' ');

  // Remove explicit plural forms like "аьзнаш" after comma
  word = word.replace(/,\s*[а-яёА-ЯЁIӀiіa-zA-Z]+(?:наш|аш|ш)(?=[\s,;()\-–]|$)/, '');

  // Clean up
  word = word.replace(/[,\s]+$/, '').trim();

  // If still has commas (e.g. leftover from cleanup), take first part
  if (word.includes(',')) {
    word = word.split(',')[0].trim();
  }

  // Extract plural form from head
  let plural = null;
  // Pattern 1: "Слово, – аш" → plural = Слово + аш
  const pluralSuffixMatch = headPart.match(/,?\s*–\s*(аш|наш|еш|ерий|арий|ш|й|ой|ий)(?=[\s()\-–,;]|$)/);
  if (pluralSuffixMatch) {
    plural = word + pluralSuffixMatch[1];
  }
  // Pattern 2: "Аз, аьзнаш," → explicit plural
  const explicitPluralMatch = headPart.match(/,\s*([а-яёА-ЯЁIӀьъ]+(?:наш|аш|ш))(?=[\s,;()\-–]|$)/);
  if (explicitPluralMatch && !pluralSuffixMatch) {
    plural = explicitPluralMatch[1];
  }

  // Extract variant in parens like "АвгIан (авхан)" — but not noun classes
  let variant = null;
  const variantMatch = headPart.match(/\(([а-яёА-ЯЁIӀ][а-яёА-ЯЁIӀ]+)\)/);
  if (variantMatch && !NOUN_CLASS_RE.test('(' + variantMatch[1] + ')')) {
    variant = variantMatch[1];
  }

  return { word, headPart, translation, nounClass, plural, variant };
}

// Determine if a line is a new dictionary entry
function isEntryLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Must start with uppercase Cyrillic letter (or Ӏ which is used in Chechen)
  if (!/^[А-ЯЁӀI]/.test(trimmed)) return false;
  // Must NOT start with * (example)
  if (trimmed.startsWith('*')) return false;
  // Skip numbered sub-meanings at the beginning (1.А, 2.А, 3.А)
  if (/^\d+\./.test(trimmed)) return false;
  // Must not be a continuation line (starts with spaces in original)
  if (/^\s{2,}/.test(line)) return false;

  // Filter out lines that are clearly continuation text (long Russian sentences without "–")
  // Entry lines are typically shorter or contain "–"
  // A continuation line in Russian that starts with uppercase (e.g., "Здесь следует отметить...")
  // is NOT an entry. We check: does it have a Chechen word pattern at the start?

  // Chechen words use specific characters: I, Ӏ, гI, хI, etc.
  // Russian-only lines that happen to start with uppercase are continuations
  // Heuristic: if the line has " – " and the part before dash looks like a Chechen word (short, no spaces or few spaces)

  const dashIdx = findTranslationDash(trimmed);
  if (dashIdx !== -1) {
    const before = trimmed.substring(0, dashIdx).trim();
    // Head part should be relatively short (word + grammar)
    // and not be a full Russian sentence
    if (before.length > 120) return false;
    return true;
  }

  // No dash — could be a word without translation (e.g. "Ало,", "Мекара,")
  // or a line like "МаIашйолу," that has a continuation on next line
  // Reject if it ends with sentence-ending punctuation (it's a continuation sentence)
  if (/[.!?]$/.test(trimmed)) return false;
  // Accept if the line is short (word-like)
  if (trimmed.length <= 60) return true;

  // Long lines without dash are likely continuation text
  return false;
}

// Parse the dictionary
const rawEntries = [];
let currentLines = [];
let currentEntryFirstLine = null;

function flushLines() {
  if (!currentEntryFirstLine) return;

  const entryLine = currentEntryFirstLine;
  const extraLines = currentLines;

  const parsed = parseEntryLine(entryLine);

  // Separate examples and notes from extra lines
  const examples = [];
  const notes = [];
  const continuationTranslation = [];
  let seenNonContinuation = false; // Once we see a non-continuation line, stop adding to translation

  for (const extra of extraLines) {
    const trimmedExtra = extra.trim();
    if (trimmedExtra.startsWith('*')) {
      examples.push(trimmedExtra.substring(1).trim());
      seenNonContinuation = true;
    } else if (/^\s{2,}/.test(extra) || /^\t/.test(extra)) {
      // Indented line — author's note
      notes.push(trimmedExtra);
      seenNonContinuation = true;
    } else if (!seenNonContinuation && /^[а-яёa-z(]/.test(trimmedExtra) && trimmedExtra.length <= 80) {
      // Non-indented line starting with lowercase, short → likely continuation of translation
      // e.g. "глиняный шарик (в детских играх)" after "Авгол, – аш..."
      continuationTranslation.push(trimmedExtra);
    } else {
      // Everything else is a note
      notes.push(trimmedExtra);
      seenNonContinuation = true;
    }
  }

  // Append continuation to translation
  if (continuationTranslation.length > 0) {
    parsed.translation = (parsed.translation + ' ' + continuationTranslation.join(' ')).trim();
  }

  parsed.examples = examples.length > 0 ? examples : undefined;
  parsed.notes = notes.length > 0 ? notes : undefined;

  rawEntries.push(parsed);

  currentLines = [];
  currentEntryFirstLine = null;
}

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  if (!trimmed) continue;

  if (isEntryLine(line)) {
    flushLines();
    currentEntryFirstLine = trimmed;
  } else if (currentEntryFirstLine) {
    currentLines.push(line);
  }
}
flushLines();

console.log(`Parsed ${rawEntries.length} raw entries`);

// Filter out garbage entries (entries where word is empty or clearly not a word)
const entries = rawEntries.filter(e => {
  if (!e.word || e.word.length === 0) return false;
  // Filter out single letters that are section headers
  if (/^[А-ЯЁIӀ]$/.test(e.word)) return false;
  // Filter out lines that are clearly Russian continuation/commentary text
  // These start with common Russian words and contain spaces (full sentences, not dictionary words)
  if (/^(Здесь|Кроме|Наверное|Вместе|Сюда|Коснувшись|Имеется|Слово|Мила|Муьлш|В данном|В этот|В чеченском|Также|Он |Она |Они |Древне|Только|Когда|Масала|Масалш|Ткъа)/.test(e.word)) return false;
  // Filter out words that contain spaces and are clearly Russian phrases (not Chechen headwords)
  // Chechen headwords don't typically have spaces unless they're compound terms
  if (e.word.includes(' ') && !e.word.match(/[IӀ]/) && e.word.split(' ').length > 3) return false;
  return true;
});

console.log(`Filtered to ${entries.length} entries`);

// Manual corrections for errors in the original dictionary
const MANUAL_FIXES = {
  'Бендолу': 'небезразличный',
};

// Post-process: fill empty translations from the next entry
// Pattern in source: "Амалдоцу," (no translation) followed by "Амалдоцург – невозможный"
// Both words should have the same translation.
// Iterate backwards so chains of 3+ empty entries fill correctly.
let filledCount = 0;
for (let i = entries.length - 2; i >= 0; i--) {
  if (!entries[i].translation && entries[i + 1].translation) {
    entries[i].translation = entries[i + 1].translation;
    if (!entries[i].nounClass && entries[i + 1].nounClass) {
      entries[i].nounClass = entries[i + 1].nounClass;
    }
    filledCount++;
  }
}
console.log(`Filled ${filledCount} empty translations from next entry`);

// Apply manual fixes
for (const entry of entries) {
  if (MANUAL_FIXES[entry.word]) {
    entry.translation = MANUAL_FIXES[entry.word];
  }
}

// Generate simple format (like non-parsed dictionaries: id + word + translate)
const simpleEntries = entries.map((entry, idx) => {
  let translate = entry.translation || '';

  if (entry.examples) {
    translate += (translate ? '\n' : '') + entry.examples.map(ex => '* ' + ex).join('\n');
  }

  if (entry.notes) {
    translate += (translate ? '\n' : '') + entry.notes.join('\n');
  }

  // Build word display with grammar info
  let wordDisplay = entry.word;
  if (entry.plural) {
    wordDisplay += ' (' + entry.plural + ')';
  }
  if (entry.nounClass) {
    wordDisplay += ' [' + entry.nounClass + ']';
  }
  if (entry.variant) {
    wordDisplay += ' (' + entry.variant + ')';
  }

  return {
    id: String(idx + 1),
    word: wordDisplay,
    translate: translate.trim(),
  };
});

// Generate parsed format (like parsed dictionaries)
const parsedEntries = entries.map(entry => {
  const result = { word: entry.word };

  // Variant
  if (entry.variant) {
    result.variants = [entry.variant];
  }

  // Grammar
  const grammar = {};
  if (entry.plural) {
    grammar.plural = entry.plural;
  }
  if (Object.keys(grammar).length > 0) {
    result.grammar = grammar;
  }

  // Noun class
  if (entry.nounClass) {
    result.nounClass = entry.nounClass;
  }

  // Meanings — split by semicolons
  const meanings = [];
  if (entry.translation) {
    const parts = entry.translation.split(/;\s*/);
    for (const part of parts) {
      const trimPart = part.trim();
      if (!trimPart) continue;

      // Check for grammar/style labels
      const labelMatch = trimPart.match(/^\(?(перен\.?|глаг\.?|грамм\.?|араб\.?|анат\.?|погов\.?|буквально)\)?\s*/);
      if (labelMatch) {
        const rest = trimPart.substring(labelMatch[0].length).trim();
        meanings.push({
          translation: rest || trimPart,
          note: labelMatch[1].replace(/\.$/, ''),
        });
      } else {
        meanings.push({ translation: trimPart });
      }
    }
  }
  if (meanings.length > 0) {
    result.meanings = meanings;
  }

  // Citations/examples
  if (entry.examples && entry.examples.length > 0) {
    result.citations = entry.examples.map(ex => {
      // Try to split Chechen example from Russian translation by " – "
      const dashIdx = ex.search(/ – /);
      if (dashIdx !== -1) {
        return {
          text: ex.substring(0, dashIdx).trim(),
          translation: ex.substring(dashIdx + 3).trim(),
        };
      }
      return { text: ex };
    });
  }

  // Author notes
  if (entry.notes && entry.notes.length > 0) {
    result.authorNotes = entry.notes.join(' ');
  }

  return result;
});

// Write outputs
fs.writeFileSync(outputSimple, JSON.stringify(simpleEntries, null, 2), 'utf-8');
console.log(`Simple format written to: ${outputSimple}`);

fs.writeFileSync(outputParsed, JSON.stringify(parsedEntries, null, 2), 'utf-8');
console.log(`Parsed format written to: ${outputParsed}`);

// Show sample entries for verification
console.log('\n--- Sample simple entries (first 10) ---');
for (const e of simpleEntries.slice(0, 10)) {
  console.log(`[${e.id}] ${e.word} → ${e.translate.substring(0, 80)}`);
}

console.log('\n--- Sample parsed entries (first 5) ---');
console.log(JSON.stringify(parsedEntries.slice(0, 5), null, 2));

// Show some entries from the middle
console.log('\n--- Sample from middle (entries 100-105) ---');
console.log(JSON.stringify(parsedEntries.slice(100, 105), null, 2));

// Show last few entries
console.log('\n--- Last 5 entries ---');
console.log(JSON.stringify(parsedEntries.slice(-5), null, 2));
