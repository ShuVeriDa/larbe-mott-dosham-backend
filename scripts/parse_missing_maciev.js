const fs = require('fs');

const text = fs.readFileSync('c:/Users/ShuVarhiDa/Desktop/Maciev_A.G_Chechensko-russkiy_slovar.txt', 'utf8');
const lines = text.split(/\r?\n/);

const DICT_START = 823;
const DICT_END = 27017;

function isPageNumber(line) { return /^\s{10,}\d+\s*$/.test(line); }
function isHomonymMarker(line) { return /^\s{1,9}\d{1}\s*$/.test(line); }
function isLetterHeader(line) { return /^\s{10,}[А-ЯӀЁ]\s*$/.test(line) || /^[А-ЯӀЁ]\s*$/.test(line); }

// ===== STEP 1: Parse entries from txt =====
const txtEntries = [];
let currentRaw = null;
let pendingHomonym = null;

for (let i = DICT_START; i < DICT_END; i++) {
  const line = lines[i];
  if (line.trim() === '' || isPageNumber(line) || isLetterHeader(line)) continue;
  if (isHomonymMarker(line)) { pendingHomonym = line.trim(); continue; }

  const startsWithSpace = /^\s/.test(line);

  if (!startsWithSpace) {
    if (currentRaw) txtEntries.push(currentRaw);
    let entryLine = line;
    if (pendingHomonym) {
      const idx = line.indexOf(' ');
      if (idx > 0) entryLine = line.substring(0, idx) + pendingHomonym + line.substring(idx);
      else entryLine = line + pendingHomonym;
      pendingHomonym = null;
    }
    currentRaw = entryLine.trim();
  } else {
    if (currentRaw) currentRaw += ' ' + line.trim();
  }
}
if (currentRaw) txtEntries.push(currentRaw);

console.log('Total entries parsed from txt:', txtEntries.length);

// ===== STEP 2: Load maciev.json =====
const maciev = JSON.parse(fs.readFileSync(
  'f:/programming/mott-larbe/mott-larbe-dosham-backend/dictionaries/maciev.json', 'utf8'
));

// Build index: normalize word1 for matching
function normalize(w) {
  let s = w.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  // Normalize Latin lookalikes to Cyrillic
  s = s.replace(/a/g, 'а').replace(/e/g, 'е').replace(/o/g, 'о')
       .replace(/p/g, 'р').replace(/c/g, 'с').replace(/x/g, 'х')
       .replace(/A/g, 'А').replace(/E/g, 'Е').replace(/O/g, 'О')
       .replace(/P/g, 'Р').replace(/C/g, 'С').replace(/X/g, 'Х')
       .replace(/H/g, 'Н').replace(/K/g, 'К').replace(/M/g, 'М')
       .replace(/T/g, 'Т').replace(/B/g, 'В').replace(/I/g, 'І');
  // Normalize spaces around commas: "а,б" → "а, б"  and "а , б" → "а, б"
  s = s.replace(/\s*,\s*/g, ', ');
  return s;
}

const macievByWord1 = new Map();
for (const e of maciev) {
  const key = normalize(e.word1);
  if (!macievByWord1.has(key)) macievByWord1.set(key, []);
  macievByWord1.get(key).push(e);
}

console.log('maciev.json entries:', maciev.length);

// ===== STEP 3: Match txt entries against maciev by "starts with" =====
// For each txt entry, check if any maciev word1 appears at the start.
// Sort maciev word1s by length descending to match longest first.

const macievWord1List = [...macievByWord1.keys()].sort((a, b) => b.length - a.length);

// Build a quick check: first N chars → possible word1s
// For efficiency, use a prefix trie approach or just check all (3250 entries is small)

const matchedTxtIndices = new Set();
const matchedMacievKeys = new Set();

for (let i = 0; i < txtEntries.length; i++) {
  const raw = txtEntries[i];
  const rawNorm = normalize(raw.replace(/\*/g, ''));

  for (const w1 of macievWord1List) {
    if (rawNorm.startsWith(w1)) {
      // Check that after the word1 there's a space, bracket, or end of string
      const after = rawNorm.charAt(w1.length);
      if (after === '' || after === ' ' || after === '[' || after === '*') {
        matchedTxtIndices.add(i);
        matchedMacievKeys.add(w1);
        break;
      }
    }
  }
}

console.log('Matched txt entries:', matchedTxtIndices.size);
console.log('Matched maciev word1s:', matchedMacievKeys.size);
console.log('Unmatched maciev word1s:', macievByWord1.size - matchedMacievKeys.size);

// ===== STEP 4: Extract word1 from unmatched entries =====
function extractWord1(raw) {
  const posMarkers = [
    ' союз ', ' частица,', ' частица ', ' прил. ', ' прил.;', ' нареч. ', ' нареч.;',
    ' масд. ', ' понуд. ', ' потенц. ', ' прич. ', ' межд. ', ' звукоподр. ',
    ' числ. ', ' мест. ', ' предл. ', ' посл. ', ' усил. ', ' вводн.',
    ' безл. ', ' сущ. ', ' деепр. ', ' собир. ', ' см. ', ' мн. от ',
    ' в разн. ', ' объект в ', ' субъект в ', ' 1. ', ' 1) '
  ];

  let cutPos = raw.length;

  const bracketPos = raw.indexOf('[');
  if (bracketPos >= 0 && bracketPos < cutPos) cutPos = bracketPos;

  // Handle asterisk: "word* translation" or "word1, word2* ..."
  const asteriskMatch = raw.match(/\*\s/);
  if (asteriskMatch && asteriskMatch.index + 1 < cutPos) cutPos = asteriskMatch.index + 1;

  // Check for "] " — closing bracket of grammar forms
  const closeBracket = raw.indexOf('] ');
  if (closeBracket >= 0 && closeBracket + 2 < cutPos) cutPos = closeBracket + 2;
  // Also just "]" at end or followed by number
  const closeBracketNum = raw.match(/\]\s*\d\)/);
  if (closeBracketNum && closeBracketNum.index < cutPos) cutPos = closeBracketNum.index;

  for (const marker of posMarkers) {
    const idx = raw.indexOf(marker);
    if (idx >= 0 && idx < cutPos) cutPos = idx;
  }

  // Fallback: detect Russian translation text after Chechen headword
  // Russian translations contain letters like ы, э, щ, ъ (not in Chechen)
  // Or common translation words: "от ", "к ", "из ", etc.
  // Simpler: if cutPos is still at end, look for common verb translation patterns
  if (cutPos === raw.length) {
    // Many entries are "headword translation" where translation is Russian infinitive
    // ending in -ть, -ться, or -ся, or Russian noun/adjective
    const russianStart = raw.match(/\s+([\p{L}]+-?[\p{L}]*(?:ть|ться|тся|ный|ная|ное|ной|ный|ник|тель|ция|ние|сть|ка|ок|ец)[\s,;.])/u);
    if (russianStart && russianStart.index < cutPos) {
      cutPos = russianStart.index;
    }
  }

  let word = raw.substring(0, cutPos).trim().replace(/\*$/, '').trim();

  // Handle grammar forms without brackets
  // Pattern: "headword genitive, dative, ergative, instrumental, class; мн. plural, class]"
  // The genitive shares the root with headword
  if (word.includes(' ') && !word.endsWith(',')) {
    const firstSpace = word.indexOf(' ');
    const headCandidate = word.substring(0, firstSpace).replace(/[0-9*]/g, '');
    const formCandidate = word.substring(firstSpace + 1).split(/[\s,]/)[0].replace(/[\[\]0-9*]/g, '');
    const root = headCandidate.substring(0, Math.min(3, headCandidate.length));
    if (root.length >= 2 && formCandidate.length >= 2 && formCandidate.startsWith(root)) {
      word = word.substring(0, firstSpace).replace(/\*$/, '');
    }
  }

  // Handle comma-separated forms that leaked: "word formA, formB, formC..."
  if (word.includes(',') && word.includes(' ')) {
    const firstComma = word.indexOf(',');
    const beforeComma = word.substring(0, firstComma).trim();
    if (beforeComma.includes(' ')) {
      const parts = beforeComma.split(/\s+/);
      const head = parts[0].replace(/[0-9*]/g, '');
      const form = parts[parts.length - 1].replace(/[0-9*]/g, '');
      const root = head.substring(0, Math.min(3, head.length));
      if (root.length >= 2 && form.startsWith(root) && !parts[0].endsWith(',')) {
        word = parts[0].replace(/\*$/, '');
      }
    }
  }

  // If word still contains ']' it means grammar forms leaked into word1
  // Trim everything from first space where next token is a grammar form
  if (word.includes(']')) {
    const firstSpace = word.indexOf(' ');
    if (firstSpace > 0) word = word.substring(0, firstSpace).replace(/\*$/, '');
  }

  word = word.replace(/[.\])]+$/, '').trim();
  return word;
}

// ===== STEP 5: Build missing entries =====
const missingEntries = [];
for (let i = 0; i < txtEntries.length; i++) {
  if (matchedTxtIndices.has(i)) continue;

  const raw = txtEntries[i];
  const word1 = extractWord1(raw);
  const translate = raw.substring(word1.length).trim();

  missingEntries.push({
    id: String(i + 1),
    word1: word1,
    word: word1,
    translate: translate
  });
}

console.log('\nMissing entries to save:', missingEntries.length);

// ===== Verification =====
console.log('\n--- First 30 entries ---');
for (let i = 0; i < 30; i++) {
  const isMatched = matchedTxtIndices.has(i);
  const w1 = isMatched ? '(matched)' : extractWord1(txtEntries[i]);
  console.log(`  #${i+1} ${isMatched ? 'OK   ' : 'MISS '} "${w1}" | ${txtEntries[i].substring(0, 55)}`);
}

// Show unmatched maciev entries
const unmatched = [...macievByWord1.entries()].filter(([k]) => !matchedMacievKeys.has(k));
console.log('\n--- Unmatched maciev entries (first 30) ---');
unmatched.slice(0, 30).forEach(([k, entries]) => {
  console.log(`  "${k}" (id=${entries[0].id})`);
});

// Save
const outPath = 'f:/programming/mott-larbe/mott-larbe-dosham-backend/dictionaries/maciev_missing.json';
fs.writeFileSync(outPath, JSON.stringify(missingEntries, null, 2), 'utf8');
console.log('\nSaved', missingEntries.length, 'entries to', outPath);
