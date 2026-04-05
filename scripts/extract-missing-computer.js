const fs = require('fs');
const path = require('path');

const txtPath = 'C:/Users/ShuVarhiDa/Desktop/Umarhagiev_S.M_i_dr._Russko-chechenskiy_chechensko-russkiy_slovar_komputernoy_leksiki.txt';
const txtContent = fs.readFileSync(txtPath, 'utf-8');
const lines = txtContent.split('\n');

const missingRangesStr = '1-88, 90-201, 203-280, 282-413, 415-440, 442-481, 483-525, 527-528, 532, 534, 539, 543, 546-548, 553-554, 560, 563, 565, 567, 569, 572, 574, 586, 593, 601-603, 607, 623, 626, 632, 637, 641-642, 644, 654-656, 658-660, 662-666, 669, 671, 673-674, 676-677, 679-680, 683, 686, 699-700, 705-706, 718-719, 724, 727, 741, 753, 765-767, 774, 778-779, 782-785, 787, 790, 792-793, 797-798, 800-803, 805, 808-809, 812, 823-825, 831-835, 837, 850, 853, 855, 860-861, 864-865, 872, 885, 887, 890, 895, 902, 906, 912, 914, 926, 929, 931-932, 934, 936, 938, 941, 943, 946-948, 956, 958, 960-962, 967, 969-970, 973, 991, 994-995, 999, 1001, 1005, 1009, 1014, 1016-1017, 1021, 1025, 1027-1028, 1034, 1036, 1038, 1040-1041, 1043, 1045, 1047, 1051-1053, 1059, 1062, 1064-1065, 1067, 1070-1071, 1073, 1075-1077, 1080-1081, 1084-1088, 1090-1091, 1093, 1095-1096';

function parseRanges(s) {
  const ids = new Set();
  for (const p of s.split(',').map(x => x.trim())) {
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(Number);
      for (let i = a; i <= b; i++) ids.add(i);
    } else ids.add(Number(p));
  }
  return ids;
}
const missingIds = parseRanges(missingRangesStr);

function getIndent(line) { return (line.match(/^(\s*)/) || ['',''])[1].length; }
function isPageNumber(s) { return /^\d+$/.test(s.trim()); }
function isSectionHeader(s) {
  const t = s.trim();
  return /^[А-ЯЁ]$/.test(t) || /^[А-ЯЁ][а-яёьӀI]$/.test(t) ||
    /^ОЬРСИЙН|^РУССКО|^НОХЧИЙН|^ЧЕЧЕНСКО|^СЛОВАРЬ|^ДОШАМ/.test(t);
}
function normalize(s) {
  return s.replace(/<[^>]*>/g, '').replace(/[\u0300-\u036f]/g, '')
    .replace(/Ӏ/g, 'I').replace(/ӏ/g, 'I').toLowerCase().trim();
}

// ==============================================================
// RU-CE: Clean — id = 1-based entry number. 525 entries.
// ==============================================================
function parseRuCe() {
  const entries = [];
  let current = null;
  for (let i = 328; i < 4268; i++) {
    const trimmed = lines[i].trim();
    const indent = getIndent(lines[i]);
    if (trimmed === '' || isPageNumber(trimmed) || isSectionHeader(trimmed)) continue;
    if (indent <= 1 && /[а-яёА-ЯЁIӀ]/.test(trimmed)) {
      if (current) entries.push(current);
      current = { lines: [trimmed] };
    } else if (indent >= 2 && current) {
      current.lines.push(trimmed);
    }
  }
  if (current) entries.push(current);
  return entries;
}

// ==============================================================
// CE-RU: Parse ALL content lines individually (not grouped).
// Then use anchors to map id -> line range.
// ==============================================================
function collectCeRuContentLines() {
  const result = [];
  for (let i = 4269; i < 8303; i++) {
    const trimmed = lines[i].trim();
    const indent = getIndent(lines[i]);
    if (trimmed === '' || isPageNumber(trimmed) || isSectionHeader(trimmed)) continue;
    if (trimmed.startsWith('Пайдаэцна литература')) break;
    if (/^\d+\.\s+[А-ЯЁ]/.test(trimmed) && i > 8200) break;
    result.push({ lineNum: i, indent, text: trimmed });
  }
  return result;
}

// Build raw entries from content lines
function buildRawEntries(cls) {
  const entries = [];
  let current = null;
  for (const cl of cls) {
    if (cl.indent <= 1) {
      if (current) entries.push(current);
      current = { lines: [cl.text], startLine: cl.lineNum };
    } else if (current) {
      current.lines.push(cl.text);
    }
  }
  if (current) entries.push(current);
  return entries;
}

const ruCeEntries = parseRuCe();
const ceRuCL = collectCeRuContentLines();
const ceRuRaw = buildRawEntries(ceRuCL);

console.log(`RU-CE: ${ruCeEntries.length}`);
console.log(`CE-RU raw: ${ceRuRaw.length}`);

// Load JSON and build anchors
const existingJson = require('../dictionaries/ru_ce_ce_ru_computer.json');
const ceRuJson = existingJson
  .filter(e => parseInt(e.id) >= 526 && (e.word1 || '').trim() !== '')
  .sort((a, b) => parseInt(a.id) - parseInt(b.id));

// Anchor: rawIdx -> id (matching each JSON entry to a raw entry)
const anchorMap = new Map();
let sf = 0;
for (const je of ceRuJson) {
  const id = parseInt(je.id);
  const jw = normalize(je.word1 || '').split(/[\s(]/)[0];
  if (jw.length < 2) continue;
  let found = false;
  // Try exact first-word match first
  for (let i = sf; i < Math.min(sf + 60, ceRuRaw.length); i++) {
    const hw = normalize(ceRuRaw[i].lines[0]).split(/[\s(]/)[0];
    if (hw === jw) {
      anchorMap.set(i, id);
      sf = i + 1;
      found = true;
      break;
    }
  }
  // Then try prefix match with longer prefix (6 chars)
  if (!found) {
    for (let i = sf; i < Math.min(sf + 60, ceRuRaw.length); i++) {
      const hw = normalize(ceRuRaw[i].lines[0]).split(/[\s(]/)[0];
      const ml = Math.min(hw.length, jw.length, 6);
      if (ml >= 3 && hw.substring(0, ml) === jw.substring(0, ml)) {
        anchorMap.set(i, id);
        sf = i + 1;
        found = true;
        break;
      }
    }
  }
  // Fallback: shorter prefix
  if (!found) {
    for (let i = sf; i < Math.min(sf + 60, ceRuRaw.length); i++) {
      const hw = normalize(ceRuRaw[i].lines[0]).split(/[\s(]/)[0];
      const ml = Math.min(hw.length, jw.length, 4);
      if (ml >= 2 && hw.substring(0, ml) === jw.substring(0, ml)) {
        anchorMap.set(i, id);
        sf = i + 1;
        break;
      }
    }
  }
}
console.log(`Anchored: ${anchorMap.size}/${ceRuJson.length}`);

// Build sorted anchor list: [{rawIdx, id}]
const anchors = [...anchorMap.entries()]
  .map(([rawIdx, id]) => ({ rawIdx, id }))
  .sort((a, b) => a.rawIdx - b.rawIdx);

// For any target id, find its rawIdx using interpolation between anchors
function getRawIdxForId(targetId) {
  // Find surrounding anchors
  let before = null, after = null;
  for (const a of anchors) {
    if (a.id <= targetId) before = a;
    if (a.id >= targetId && !after) after = a;
  }

  // Exact match
  if (before && before.id === targetId) return before.rawIdx;
  if (after && after.id === targetId) return after.rawIdx;

  if (before && after) {
    // Linear interpolation
    if (before.id === after.id) return before.rawIdx;
    const ratio = (targetId - before.id) / (after.id - before.id);
    return Math.round(before.rawIdx + ratio * (after.rawIdx - before.rawIdx));
  } else if (before) {
    // Extrapolate forward using average offset from last few anchors
    const lastAnchors = anchors.slice(-5);
    if (lastAnchors.length >= 2) {
      const avgRatio = lastAnchors.reduce((sum, a, i) => {
        if (i === 0) return 0;
        return sum + (a.rawIdx - lastAnchors[i-1].rawIdx) / (a.id - lastAnchors[i-1].id);
      }, 0) / (lastAnchors.length - 1);
      return Math.round(before.rawIdx + (targetId - before.id) * avgRatio);
    }
    return before.rawIdx + (targetId - before.id);
  } else if (after) {
    return Math.max(0, after.rawIdx - (after.id - targetId));
  }
  return targetId - 526; // fallback
}

// For a given rawIdx, build the full entry (headword + all following lines until next headword)
function getEntryAtRawIdx(rawIdx) {
  if (rawIdx < 0 || rawIdx >= ceRuRaw.length) return null;

  const entry = ceRuRaw[rawIdx];
  // Check if next raw entry is a "false headword" that should be merged
  // We merge following raw entries that look like examples/continuations
  const allLines = [...entry.lines];

  // Look ahead: if the next rawIdx is NOT an anchor and looks like an example, merge it
  for (let i = rawIdx + 1; i < ceRuRaw.length; i++) {
    // Stop if this rawIdx is an anchor (it's a known headword)
    if (anchorMap.has(i)) break;

    // Stop if this is the target rawIdx for any nearby id
    // (We don't know this easily, so just check if it looks like a headword)
    const text = ceRuRaw[i].lines[0];
    const ntext = normalize(text);

    // It's a headword if it has grammar class marker or accent
    const hasGrammar = /\([йдбв][\s,\/]*[йдбв]?\)/.test(text);
    const hasAccent = /\u0301/.test(text);

    if (hasGrammar || hasAccent) break; // new headword

    // Otherwise check if it looks like a continuation
    const hasExample = text.includes(' – ');
    const prevFirst = normalize(entry.lines[0]).split(/[\s(,]/)[0];
    const currFirst = ntext.split(/[\s(,]/)[0];
    const sameWord = currFirst === prevFirst;
    // Short wrap continuation: 1-2 words, same first letter as parent, starts lowercase
    const isShortWrap = text.split(' ').length <= 2 && !hasExample && !hasGrammar &&
      !/^[А-ЯЁA-ZIӀ]/.test(text.trim()) &&
      currFirst[0] === prevFirst[0];

    if (sameWord || hasExample || isShortWrap) {
      allLines.push(...ceRuRaw[i].lines);
    } else {
      break;
    }
  }

  return { lines: allLines };
}

// Verify anchors
let ok = 0, fail = 0;
for (const a of anchors) {
  const computed = getRawIdxForId(a.id);
  if (computed === a.rawIdx) ok++;
  else fail++;
}
console.log(`Anchor interpolation verify: ${ok} OK, ${fail} FAIL`);

// Additional verification with known JSON entries
console.log('\n=== Sample verifications ===');
const sampleIds = [526, 529, 530, 757, 800, 900, 1000, 1095, 1098];
for (const id of sampleIds) {
  const rawIdx = getRawIdxForId(id);
  const je = ceRuJson.find(e => parseInt(e.id) === id);
  const jeWord = je ? normalize(je.word1 || '').split(/[\s(]/)[0].substring(0, 10) : 'N/A';
  const rawWord = rawIdx >= 0 && rawIdx < ceRuRaw.length
    ? normalize(ceRuRaw[rawIdx].lines[0]).split(/[\s(]/)[0].substring(0, 10)
    : 'OOB';
  const entry = getEntryAtRawIdx(rawIdx);
  const entryWord = entry ? entry.lines[0].substring(0, 40) : 'null';
  console.log(`  id=${id}: rawIdx=${rawIdx} raw="${rawWord}" json="${jeWord}" entry="${entryWord}"`);
}

// Build output
function cleanWord(text) {
  return text.replace(/[\u0300-\u036f]/g, '').trim();
}

const result = [];
for (const targetId of [...missingIds].sort((a, b) => a - b)) {
  let entry;
  if (targetId <= 525) {
    const idx = targetId - 1;
    if (idx < 0 || idx >= ruCeEntries.length) continue;
    entry = ruCeEntries[idx];
  } else {
    const rawIdx = getRawIdxForId(targetId);
    entry = getEntryAtRawIdx(rawIdx);
    if (!entry) {
      console.error(`CE-RU OOB: id=${targetId} rawIdx=${rawIdx}`);
      continue;
    }
  }

  result.push({
    id: String(targetId),
    word1: cleanWord(entry.lines[0]),
    word: entry.lines[0],
    translate: entry.lines.join('\r\n') + '\r\n'
  });
}

console.log(`\nExtracted: ${result.length}`);

// Spot checks
console.log('\n=== Checks ===');
const checks = [
  [1, 'адаптер'], [2, 'администратор'], [89, null], [90, 'дефрагмент'],
  [525, 'ящик'], [526, null], [527, 'агIонан'], [528, 'адаптер'],
  [757, 'кор'], [800, 'лардар'], [900, 'оьвсаралла'],
  [1000, 'тIеттаIовдар'], [1095, 'Iалашдан'], [1096, 'Iовда'],
];
for (const [id, expected] of checks) {
  const e = result.find(r => r.id === String(id));
  if (e) {
    if (expected === null) console.log(`  ${id}: IN RESULT (UNEXPECTED!) "${e.word1.substring(0, 40)}"`);
    else {
      const n1 = normalize(e.word1).substring(0, 5);
      const n2 = normalize(expected).substring(0, 5);
      console.log(`  ${id}: ${n1.startsWith(n2.substring(0, 3)) ? 'OK' : 'MISMATCH'} "${e.word1.substring(0, 50)}" (expected ~"${expected}")`);
    }
  } else {
    console.log(`  ${id}: ${expected === null ? 'NOT IN RESULT (correct)' : 'MISSING!'}`);
  }
}

const outputPath = path.join(__dirname, '..', 'dictionaries', 'ru_ce_ce_ru_computer_missing.json');
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
console.log(`\nWritten ${result.length} entries to ${outputPath}`);
