/**
 * Extracts missing entries from the Ismailov Russian-Chechen dictionary txt file
 * that are not present in ismailov_ru_ce.json, and saves them as a new JSON file.
 *
 * Strategy:
 * 1. Parse all entries from the txt file (format: "word – translation")
 * 2. Use existing JSON entries as anchors — match them to parsed entries by word
 * 3. Between anchors, assign sequential IDs
 * 4. Extract entries whose IDs are not in existing JSON
 */

const fs = require("fs");
const path = require("path");

const TXT_PATH =
  "C:/Users/ShuVarhiDa/Desktop/Исмаилов-А.-Русско-чеченский-словарь-из-книги-Дош.txt";
const JSON_PATH = path.join(
  __dirname,
  "../dictionaries/ismailov_ru_ce.json"
);
const OUTPUT_PATH = path.join(
  __dirname,
  "../dictionaries/ismailov_ru_ce_missing.json"
);

const text = fs.readFileSync(TXT_PATH, "utf-8");
const lines = text.split("\n");
const existingData = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
const existingIds = new Set(existingData.map((e) => parseInt(e.id)));

console.log("Existing entries in JSON:", existingData.length);
console.log("Lines in txt:", lines.length);

// --- Step 1: Extract all raw entries from txt ---
// Format: "word – translation" (Russian word on the left, Chechen translation on the right)
// Each line at column 0 with a dash separator is a dictionary entry.

const cyrillicStart = /^[а-яёА-ЯЁӀ]/;
const letterHeader = /^[А-ЯЁ]\s*$/;

let rawEntries = []; // { idx, word, translate, lineNum }

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Strip form feed characters (\f, 0x0C) which appear at page breaks
  const cleaned = line.replace(/^\f/, "");
  const trimmed = cleaned.trim();
  if (trimmed === "") continue;

  // Skip indented lines (continuations/examples)
  const leadingSpaces = cleaned.match(/^(\s*)/)[1].length;
  if (leadingSpaces > 0) continue;

  // Skip letter headers (single letter lines like "А", "Б")
  if (letterHeader.test(trimmed)) continue;

  // Must start with a Cyrillic character
  if (!cyrillicStart.test(trimmed)) continue;

  // Must contain a dash separator " – " or "–"
  const dashIdx = trimmed.indexOf(" – ");
  const altDashIdx = trimmed.indexOf("–");
  let word, translate;

  if (dashIdx !== -1) {
    word = trimmed.substring(0, dashIdx).trim();
    translate = " – " + trimmed.substring(dashIdx + 3).trim();
  } else if (altDashIdx !== -1 && altDashIdx > 1) {
    word = trimmed.substring(0, altDashIdx).trim();
    translate = " – " + trimmed.substring(altDashIdx + 1).trim();
  } else {
    // No dash — not a dictionary entry
    continue;
  }

  // Skip if "word" part is too long (likely a sentence)
  if (word.length > 80) continue;

  // Skip if word part has more than 5 space-separated tokens
  if (word.split(/\s+/).length > 5) continue;

  // Convert word to lowercase for consistency with the dictionary format
  word = word.toLowerCase();

  rawEntries.push({
    idx: rawEntries.length,
    word,
    translate,
    lineNum: i + 1,
  });
}

console.log("Raw entries from txt:", rawEntries.length);

// --- Step 2: Match existing JSON entries to raw entries (anchors) ---

function normalizeForMatch(s) {
  return s
    .replace(/[\u04C0\u04CF]/g, "I") // Chechen palochka Ӏ/ӏ -> Latin I
    .replace(/1(?=[а-яёА-ЯЁa-zA-Z])/g, "I")
    .toLowerCase()
    .replace(/\s*\(.*?\)\s*/g, "") // Remove parenthetical clarifications like (сказ.), (на теле)
    .replace(/[,\-\s()]/g, "")
    .replace(/\d+$/, "")
    .trim();
}

// Additional loose match: strip even more (and т.д., и т.п. etc.)
function looseNormalize(s) {
  return normalizeForMatch(s)
    .replace(/итд|итп/g, "")
    .replace(/и/g, ""); // remove all "и" for cases like "мать-и-мачеха"
}

let anchors = []; // { jsonId, rawIdx }
let scanFrom = 0;

for (const je of existingData) {
  const jId = parseInt(je.id);
  const jWord = normalizeForMatch(je.word);
  if (!jWord || jWord.length < 2) continue;

  let found = false;
  const maxSearch = Math.min(scanFrom + 1500, rawEntries.length);

  // Exact match
  for (let k = scanFrom; k < maxSearch; k++) {
    const rWord = normalizeForMatch(rawEntries[k].word);
    if (rWord === jWord) {
      anchors.push({ jsonId: jId, rawIdx: k });
      scanFrom = k + 1;
      found = true;
      break;
    }
  }

  if (!found) {
    // Try loose normalization (handles "мать-и-мачеха", parentheticals, etc.)
    const jLoose = looseNormalize(je.word);
    for (let k = scanFrom; k < maxSearch; k++) {
      const rLoose = looseNormalize(rawEntries[k].word);
      if (rLoose === jLoose) {
        anchors.push({ jsonId: jId, rawIdx: k });
        scanFrom = k + 1;
        found = true;
        break;
      }
    }
  }

  if (!found) {
    // Partial match
    const jShort = jWord.substring(0, Math.min(12, jWord.length));
    for (let k = scanFrom; k < maxSearch; k++) {
      const rWord = normalizeForMatch(rawEntries[k].word);
      const rShort = rWord.substring(0, Math.min(12, rWord.length));
      if (rShort === jShort && Math.abs(rWord.length - jWord.length) <= 5) {
        anchors.push({ jsonId: jId, rawIdx: k });
        scanFrom = k + 1;
        found = true;
        break;
      }
    }
  }

  if (!found) {
    console.log(`  WARNING: Could not match anchor: id=${jId} word='${je.word}'`);
  }
}

console.log("Anchors matched:", anchors.length, "out of", existingData.length);

// Show first and last few anchors
console.log("\nFirst 5 anchors:");
anchors.slice(0, 5).forEach((a) => {
  console.log(
    `  jsonId=${a.jsonId} -> rawIdx=${a.rawIdx} word='${rawEntries[a.rawIdx].word.substring(0, 50)}'`
  );
});
console.log("Last 5 anchors:");
anchors.slice(-5).forEach((a) => {
  console.log(
    `  jsonId=${a.jsonId} -> rawIdx=${a.rawIdx} word='${rawEntries[a.rawIdx].word.substring(0, 50)}'`
  );
});

// --- Step 3: Build rawIdx -> correctedId mapping using anchors ---
const rawToId = new Map();

// Between consecutive anchors
for (let a = 0; a < anchors.length - 1; a++) {
  const curr = anchors[a];
  const next = anchors[a + 1];

  rawToId.set(curr.rawIdx, curr.jsonId);

  const rawGap = next.rawIdx - curr.rawIdx - 1;
  const idGap = next.jsonId - curr.jsonId - 1;

  if (rawGap === idGap) {
    // Perfect 1:1 mapping
    for (let r = curr.rawIdx + 1, id = curr.jsonId + 1; r < next.rawIdx; r++, id++) {
      rawToId.set(r, id);
    }
  } else if (rawGap > idGap) {
    // More raw entries than IDs — assign IDs sequentially, extras get no mapping
    let id = curr.jsonId + 1;
    for (let r = curr.rawIdx + 1; r < next.rawIdx; r++) {
      if (id < next.jsonId) {
        rawToId.set(r, id);
        id++;
      }
    }
  } else {
    // Fewer raw entries than IDs — assign sequentially
    let id = curr.jsonId + 1;
    for (let r = curr.rawIdx + 1; r < next.rawIdx && id < next.jsonId; r++, id++) {
      rawToId.set(r, id);
    }
  }
}

// Last anchor
const lastAnchor = anchors[anchors.length - 1];
rawToId.set(lastAnchor.rawIdx, lastAnchor.jsonId);

// After last anchor — assign sequential IDs
let nextId = lastAnchor.jsonId + 1;
for (let r = lastAnchor.rawIdx + 1; r < rawEntries.length; r++, nextId++) {
  rawToId.set(r, nextId);
}

// Before first anchor — assign sequential IDs backwards
const firstAnchor = anchors[0];
rawToId.set(firstAnchor.rawIdx, firstAnchor.jsonId);
for (let r = firstAnchor.rawIdx - 1, id = firstAnchor.jsonId - 1; r >= 0 && id >= 1; r--, id--) {
  rawToId.set(r, id);
}

console.log("Total mapped entries:", rawToId.size);

// --- Step 4: Extract missing entries ---
let missingEntries = [];
for (const entry of rawEntries) {
  const correctedId = rawToId.get(entry.idx);
  if (correctedId !== undefined && !existingIds.has(correctedId)) {
    missingEntries.push({
      id: String(correctedId),
      word: entry.word,
      translate: entry.translate,
    });
  }
}

missingEntries.sort((a, b) => parseInt(a.id) - parseInt(b.id));
console.log(`\nMissing entries found: ${missingEntries.length}`);

// --- Step 5: Verify a few samples ---
console.log("\nVerification — entries around known anchors:");
for (const anchor of anchors.slice(0, 8)) {
  const before = rawEntries[anchor.rawIdx - 1];
  const at = rawEntries[anchor.rawIdx];
  const after = rawEntries[anchor.rawIdx + 1];
  const idBefore = rawToId.get(anchor.rawIdx - 1);
  const idAt = rawToId.get(anchor.rawIdx);
  const idAfter = rawToId.get(anchor.rawIdx + 1);
  console.log(
    `  [${idBefore}] ${before ? before.word.substring(0, 30) : "?"} | [${idAt}] ${at.word.substring(0, 30)} (anchor, json id=${anchor.jsonId}) | [${idAfter}] ${after ? after.word.substring(0, 30) : "?"}`
  );
}

// --- Step 6: Save ---
fs.writeFileSync(
  OUTPUT_PATH,
  JSON.stringify(missingEntries, null, 2),
  "utf-8"
);
console.log(`\nSaved to: ${OUTPUT_PATH}`);

// Show samples
console.log("\nFirst 10 missing entries:");
missingEntries.slice(0, 10).forEach((e) => {
  console.log(
    `  id=${e.id}: word='${e.word.substring(0, 50)}' translate='${e.translate.substring(0, 50)}'`
  );
});

const mid = Math.floor(missingEntries.length / 2);
console.log("\nMiddle entries:");
missingEntries.slice(mid, mid + 5).forEach((e) => {
  console.log(
    `  id=${e.id}: word='${e.word.substring(0, 50)}' translate='${e.translate.substring(0, 50)}'`
  );
});

console.log("\nLast 5 entries:");
missingEntries.slice(-5).forEach((e) => {
  console.log(
    `  id=${e.id}: word='${e.word.substring(0, 50)}' translate='${e.translate.substring(0, 50)}'`
  );
});
