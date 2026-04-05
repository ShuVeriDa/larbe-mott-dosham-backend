const fs = require('fs');
const path = require('path');

const txtPath = 'C:\\Users\\ShuVarhiDa\\Desktop\\Umarhagiev_S.M._Ahmatukaev_A.A.txt';
const txtContent = fs.readFileSync(txtPath, 'utf-8');
const lines = txtContent.split('\n');

const missingRangesStr = '3, 9, 15, 20, 26, 30, 39-40, 42, 44, 47, 49, 51-53, 56, 60, 63, 66, 75-76, 79-81, 85, 87, 95, 97-98, 101, 103, 105, 113, 118, 121, 127, 129-130, 135, 137, 139-141, 147-149, 152-153, 156, 160-161, 165-167, 171-172, 174-175, 177, 179, 182-184, 189-191, 193, 197, 200-201, 203, 205, 209, 212-214, 216-217, 220-222, 224-228, 230, 233, 235, 237-238, 240-242, 244, 247-248, 250-256, 259, 264, 266-267, 269-271, 273-274, 279, 284, 296-298, 300, 304-306, 308, 311-312, 314-320, 322-323, 325, 327-328, 333, 335-336, 340-341, 344, 347, 349, 351-353, 356, 360-361, 364, 369, 373-374, 377-383, 385, 387-388, 390, 392-394, 399, 401-402, 405, 407, 409, 411, 414-417, 420-422, 424-425, 428-431, 437, 439, 443-444, 446, 449-451, 455, 458, 464-466, 469, 471, 473, 478-479, 481, 487-488, 490, 496, 504, 507, 509, 511, 514-516, 518-520, 526-527, 529, 533-535, 544, 547, 551, 554-555, 558, 560, 563, 568-569, 571, 575, 588, 591, 594, 599, 601, 605, 611-612, 617-619, 624, 627, 630-631, 637, 639, 643-644, 653-654, 659-662, 664, 666-667, 670, 674, 676, 681, 690, 702, 705-706, 711, 714-715, 720, 727, 730, 733, 735, 740-743, 747, 749, 753-761, 763, 774, 776, 779-780, 782-784, 787-789, 791, 793-794, 796, 799-801, 805-806, 808, 810, 813-816, 819-820, 822-824, 831, 837, 842, 845, 849-856, 858-860, 862-864, 866-883, 888, 892-893, 897-898, 900-901, 903-905, 908-909, 912, 915-917, 924-930, 932-935, 940-942, 944, 946-947, 949, 953, 956, 962, 964-965, 970-971, 974-977, 979, 982-983, 987-990, 993, 999, 1005-1065, 1067-1157, 1159-1236, 1238-1243, 1245-1423, 1425-1477, 1479-2138, 2140-2319';

function parseRanges(s) {
  const ids = new Set();
  for (const p of s.split(',').map(x => x.trim())) {
    if (p.includes('-')) { const [a, b] = p.split('-').map(Number); for (let i = a; i <= b; i++) ids.add(i); }
    else ids.add(Number(p));
  }
  return ids;
}
const missingIds = parseRanges(missingRangesStr);

function getIndent(l) { return (l.match(/^(\s*)/) || ['',''])[1].length; }
function isPageNumber(s) { return /^\d+$/.test(s.trim()); }
const knownWordWraps = new Set(['квадратичная форма;']);

function isContinuation(line) {
  const indent = getIndent(line);
  const trimmed = line.trim();
  if (indent >= 6) return true;
  if (trimmed.includes('~')) return true;
  if (/^\d+\.\s/.test(trimmed)) return true;
  if (knownWordWraps.has(trimmed)) return true;
  return false;
}

function parseSection(startLine, endLine) {
  const entries = [];
  let currentEntry = null;
  let pendingLetter = null;

  let i = startLine;
  while (i < endLine) {
    const t = lines[i].trim();
    if (t === '' || isPageNumber(t) || /^ЧЕЧЕНСКО|^РУССКО|^СЛОВАРЬ/.test(t)) { i++; continue; }
    break;
  }

  for (; i < endLine; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = getIndent(line);
    if (trimmed === '' || isPageNumber(trimmed)) continue;

    // Single/double letter header at indent 0-1 (e.g. "Д", "Кх", "ЦӀ")
    if (indent <= 1 && /^[А-ЯЁA-ZIӀ][а-яёьӀ]?\s*$/.test(trimmed) && trimmed.length <= 3) {
      if (currentEntry) { entries.push(currentEntry); currentEntry = null; }
      pendingLetter = trimmed; continue;
    }
    // Sub-group header at indent 4-5 (e.g. "    Уь")
    if (indent >= 4 && indent <= 5 && /^[А-ЯЁ][а-яёьӀ]?\s*$/.test(trimmed) && trimmed.length <= 3) {
      if (currentEntry) { entries.push(currentEntry); currentEntry = null; }
      pendingLetter = trimmed; continue;
    }
    // Inline letter header (e.g. "С   а б;", "I   ад д;")
    if (/^[А-ЯЁA-ZIӀ]\s{2,}\S/.test(line)) {
      if (currentEntry) { entries.push(currentEntry); currentEntry = null; }
      pendingLetter = null;
      const m = line.match(/^([А-ЯЁA-ZIӀ])\s{2,}(.+)/);
      if (m) { let c = m[1]; if (c === 'I') c = 'Ӏ'; currentEntry = c.toLowerCase() + m[2]; }
      continue;
    }

    if (isContinuation(line)) {
      if (pendingLetter && !currentEntry) {
        currentEntry = pendingLetter.toLowerCase() + trimmed;
        pendingLetter = null;
      } else if (currentEntry !== null) {
        currentEntry += ' ' + trimmed;
      }
    } else {
      if (pendingLetter) {
        if (currentEntry) entries.push(currentEntry);
        const ll = pendingLetter.toLowerCase();
        currentEntry = trimmed.toLowerCase().startsWith(ll) ? trimmed : ll + trimmed;
        pendingLetter = null;
      } else {
        if (currentEntry) entries.push(currentEntry);
        currentEntry = trimmed;
      }
    }
  }
  if (currentEntry) entries.push(currentEntry);
  return entries;
}

// Find section boundaries
let ceStart = -1, ruStart = -1, appendixStart = -1;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t === 'ЧЕЧЕНСКО - РУССКИЙ' && ceStart === -1) ceStart = i;
  if (t === 'РУССКО - ЧЕЧЕНСКИЙ' && i > 100) ruStart = i;
  if (t === 'Юхедиллар' && i > 3000 && i < 3770) appendixStart = i;
}

const ceEntries = parseSection(ceStart, appendixStart);
const ruEntries = parseSection(ruStart, lines.length);
const allEntries = [...ceEntries, ...ruEntries];
const ceCount = ceEntries.length;

console.log(`CE: ${ceCount}, RU: ${ruEntries.length}, Total: ${allEntries.length}`);

// Load existing JSON and build alignment
const existingJson = require('../dictionaries/umarhadjiev_ahmatukaev_ce_ru_ru_ce.json');
const sortedJson = existingJson.sort((a, b) => parseInt(a.id) - parseInt(b.id));

// Build complete id->idx mapping by walking through both lists simultaneously
// For each id from 1 to max, determine which allEntries index it maps to
const maxId = 2320;
const idToIdx = new Map();

// Step 1: align known entries from JSON
let searchFrom = 0;
for (const entry of sortedJson) {
  const id = parseInt(entry.id);
  const word = entry.word.replace(/\s*[юдб];/g, '').trim().toLowerCase().split(' ')[0];
  const prefix = word.substring(0, Math.min(4, word.length));

  let found = false;
  const maxRange = id > 1000 ? 700 : 50;
  for (let i = searchFrom; i < Math.min(searchFrom + maxRange, allEntries.length); i++) {
    const ourWord = allEntries[i].split(/\s/)[0].toLowerCase().replace(/\/\//g, '');
    if (ourWord.startsWith(prefix) || prefix.startsWith(ourWord.substring(0, Math.min(4, ourWord.length)))) {
      idToIdx.set(id, i);
      searchFrom = i + 1;
      found = true;
      break;
    }
  }
}

console.log(`Aligned: ${idToIdx.size}/${sortedJson.length}`);

// Step 2: for missing IDs, interpolate based on neighbors
// Build sorted array of aligned pairs
const alignedPairs = [...idToIdx.entries()].sort((a, b) => a[0] - b[0]);

function getIdxForId(targetId) {
  // Already aligned?
  if (idToIdx.has(targetId)) return idToIdx.get(targetId);

  // Find nearest aligned neighbors
  let before = null, after = null;
  for (const [id, idx] of alignedPairs) {
    if (id < targetId) before = { id, idx };
    if (id > targetId && !after) { after = { id, idx }; break; }
  }

  if (before && after) {
    // Both neighbors available — use offset from before
    const offset = before.idx - (before.id - 1);
    return targetId - 1 + offset;
  } else if (before) {
    const offset = before.idx - (before.id - 1);
    return targetId - 1 + offset;
  } else if (after) {
    const offset = after.idx - (after.id - 1);
    return targetId - 1 + offset;
  }
  return targetId - 1; // fallback
}

// Format entry to extract word and translate
function formatCeEntry(raw) {
  // CE format: "word class; forms translation; examples"
  // First try to match: word [class]; forms...
  const classMatch = raw.match(/^(.+?\S)\s+([юдб]);(.*)$/s);
  if (classMatch) {
    const word = classMatch[1].replace(/\/\//g, '') + ' ' + classMatch[2] + ';';
    const rest = classMatch[3].trim();
    return { word, translate: rest };
  }

  // No class marker — adjective/verb/phrase
  // "абсолюте абсолютный; ~ барам ..."
  // word is the Chechen part, translate is the rest
  // Find the first Russian word (rough heuristic: word ending typical Russian suffixes)
  const m = raw.match(/^(\S+(?:\s+\S+)?)\s+([а-яё].*)$/s);
  if (m) {
    return { word: m[1].replace(/\/\//g, ''), translate: m[2] };
  }

  return { word: raw.split(/\s/)[0].replace(/\/\//g, ''), translate: raw.substring(raw.split(/\s/)[0].length).trim() };
}

function formatRuEntry(raw) {
  // RU format: "russianWord chechenTranslation (class)"
  // First word(s) is Russian, rest is Chechen translation
  const slashIdx = raw.indexOf('//');
  if (slashIdx >= 0) {
    // Has // like "абсолютн//ый абсолюте;..."
    const firstWord = raw.split(/\s/)[0];
    return { word: firstWord.replace(/\/\//g, ''), translate: raw.substring(firstWord.length).trim() };
  }
  const parts = raw.split(/\s+/);
  // Try to find where Chechen translation starts (after the Russian word(s))
  // Most entries: "word translation"
  return { word: parts[0], translate: parts.slice(1).join(' ') };
}

// Extract missing entries
const result = [];

for (const targetId of [...missingIds].sort((a, b) => a - b)) {
  const idx = getIdxForId(targetId);

  if (idx < 0 || idx >= allEntries.length) {
    console.error(`WARNING: id=${targetId} -> idx=${idx} out of bounds`);
    continue;
  }

  const raw = allEntries[idx];
  const isCe = idx < ceCount;
  const formatted = isCe ? formatCeEntry(raw) : formatRuEntry(raw);

  result.push({
    id: String(targetId),
    word: formatted.word,
    translate: formatted.translate
  });
}

console.log(`Extracted: ${result.length}`);

// Verify a few
console.log('\n=== CE samples ===');
result.filter(e => parseInt(e.id) <= 50).forEach(e => {
  console.log(`  ${e.id}: word="${e.word}" | translate="${e.translate.substring(0, 50)}"`);
});

// Verify against known patterns
console.log('\n=== Spot checks ===');
const checks = [
  [3, 'абсолюте'],
  [9, 'аддитиве'],
  [15, 'алсам'],
  [20, 'аналитике'],
  [377, 'кхаа сонар'],
  [1005, 'Ӏодан'],
  [1006, 'Абрис'],
];
for (const [id, expected] of checks) {
  const entry = result.find(e => e.id === String(id));
  if (entry) {
    const match = entry.word.toLowerCase().startsWith(expected.toLowerCase().substring(0, 3));
    console.log(`  id=${id}: ${match ? 'OK' : 'MISMATCH'} word="${entry.word}" (expected ~"${expected}")`);
  } else {
    console.log(`  id=${id}: NOT IN RESULT`);
  }
}

// Write output
const outputPath = path.join(__dirname, '..', 'dictionaries', 'umarhadjiev_ahmatukaev_missing.json');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
console.log(`\nWritten to ${outputPath}`);
console.log(`Total missing entries: ${result.length}`);
