/**
 * Extracts missing entries from the Ismailov Chechen-Russian dictionary txt file
 * that are not present in ismailov_ce_ru.json, and saves them as a new JSON file.
 *
 * Strategy:
 * 1. Parse all candidate entries from txt (lines at col 0, starting with uppercase Cyrillic,
 *    not letter headers, not examples, not numbered prefix lines 1./2./3.)
 * 2. Use existing JSON entries as anchors — match them to parsed entries by word
 * 3. Between anchors, assign sequential IDs
 * 4. Extract entries whose IDs are not in existing JSON
 */

const fs = require("fs");
const path = require("path");

const TXT_PATH =
  "C:/Users/ShuVarhiDa/Desktop/Исмаилов-А.-Чеченско-русский-словарь-из-книги-Дош.txt";
const JSON_PATH = path.join(
  __dirname,
  "../dictionaries/ismailov_ce_ru.json"
);
const OUTPUT_PATH = path.join(
  __dirname,
  "../dictionaries/ismailov_ce_ru_missing.json"
);

const text = fs.readFileSync(TXT_PATH, "utf-8");
const lines = text.split("\n");
const existingData = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
const existingIds = new Set(existingData.map((e) => parseInt(e.id)));

console.log("Existing entries in JSON:", existingData.length);
console.log("Lines in txt:", lines.length);

// --- Step 1: Extract all raw entries from txt ---
// An entry is a line at column 0 starting with uppercase Cyrillic (including Ӏ)
// that contains " – " or "–" (dash separator for word – translation)
// Exclude: letter headers, example lines (*), empty lines, indented lines

const cyrillicUpper = /^[А-ЯЁӀ]/;
const letterHeader = /^[А-ЯЁӀ]\s*$/;
const numberedEntry = /^(\d+)\.\s*([А-ЯЁӀа-яёӀ])/;

let rawEntries = []; // { idx, word, translate, lineNum, fullLine }

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  if (trimmed === "") continue;

  const leadingSpaces = line.match(/^(\s*)/)[1].length;
  if (leadingSpaces > 0) continue;
  if (trimmed.startsWith("*")) continue;
  if (letterHeader.test(trimmed)) continue;

  // Handle numbered entries (1.А, 2.А, 3.А)
  const numMatch = trimmed.match(numberedEntry);
  if (numMatch) {
    const rest = trimmed.substring(numMatch[0].length - numMatch[2].length).trim();
    // Try " – " first, then "–" with possible missing space
    const dashIdx = rest.indexOf(" – ");
    const altDashIdx = rest.indexOf("–");
    let word, translate;
    if (dashIdx !== -1) {
      word = rest.substring(0, dashIdx).trim();
      translate = rest.substring(dashIdx + 3).trim();
    } else if (altDashIdx !== -1 && altDashIdx > 0) {
      word = rest.substring(0, altDashIdx).trim();
      translate = rest.substring(altDashIdx + 1).trim();
    } else {
      word = rest;
      translate = "";
    }
    rawEntries.push({
      idx: rawEntries.length,
      word,
      translate: " – " + translate,
      lineNum: i + 1,
      fullLine: trimmed,
    });
    continue;
  }

  // Regular entry — must start with uppercase Cyrillic
  if (!cyrillicUpper.test(trimmed)) continue;

  // Must contain a dash to be a dictionary entry
  const dashIdx = trimmed.indexOf(" – ");
  const altDashIdx = trimmed.indexOf("–");
  let word, translate;

  if (dashIdx !== -1) {
    word = trimmed.substring(0, dashIdx).trim();
    translate = trimmed.substring(dashIdx).trim();
  } else if (altDashIdx !== -1 && altDashIdx > 1) {
    word = trimmed.substring(0, altDashIdx).trim();
    translate = trimmed.substring(altDashIdx).trim();
  } else {
    // No dash — likely not a dictionary entry (continuation line, comment)
    continue;
  }

  // Skip if "word" part is too long (likely a sentence, not a headword)
  if (word.length > 60) continue;

  // Skip lines that look like Russian sentences (start with common Russian words)
  if (/^(Кроме|После|Вернее|Осенью|Слово|Стелы|Вуно|Однако|Кстати|Например|Таким|Также|Следует|Нередко|Иногда|Поэтому|Помимо|Вместе|Сюда|Наверное|Между|Заметим)/i.test(trimmed)) continue;

  // Skip lines where the "word" part has more than 4 space-separated tokens (likely a sentence)
  if (word.split(/\s+/).length > 4) continue;

  // Collect continuation lines for the translation
  let fullTranslate = translate;
  let j = i + 1;
  while (j < lines.length) {
    const nextLine = lines[j];
    const nextTrimmed = nextLine.trim();
    if (nextTrimmed === "") break;
    const nextSpaces = nextLine.match(/^(\s*)/)[1].length;

    if (nextTrimmed.startsWith("*") || nextSpaces > 0) {
      // Example or indented continuation
      fullTranslate += "\n" + nextTrimmed;
      j++;
    } else if (!cyrillicUpper.test(nextTrimmed) && !numberedEntry.test(nextTrimmed)) {
      // Lowercase continuation at col 0
      fullTranslate += " " + nextTrimmed;
      j++;
    } else {
      break;
    }
  }

  rawEntries.push({
    idx: rawEntries.length,
    word,
    translate: fullTranslate,
    lineNum: i + 1,
    fullLine: trimmed,
  });
}

console.log("Raw entries from txt:", rawEntries.length);

// --- Step 2: Match existing JSON entries to raw entries (anchors) ---

function normalizeForMatch(s) {
  return s
    .replace(/[\u04C0\u04CF]/g, "I") // Chechen palochka Ӏ/ӏ -> Latin I
    .replace(/1(?=[а-яёА-ЯЁa-zA-Z])/g, "I") // digit 1 before letters -> I (common OCR artifact)
    .toLowerCase()
    .replace(/[,\-\s()]/g, "")
    .replace(/\d+$/, "")
    .trim();
}

let anchors = []; // { jsonId, rawIdx }
let scanFrom = 0;

for (const je of existingData) {
  const jId = parseInt(je.id);
  const jWord = normalizeForMatch(je.word);
  if (!jWord || jWord.length < 2) continue;

  // Search forward from last match position with a large window
  let found = false;
  const maxSearch = Math.min(scanFrom + 1000, rawEntries.length);
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
    // Try partial match (first N characters)
    const jShort = jWord.substring(0, Math.min(10, jWord.length));
    for (let k = scanFrom; k < maxSearch; k++) {
      const rWord = normalizeForMatch(rawEntries[k].word);
      const rShort = rWord.substring(0, Math.min(10, rWord.length));
      if (rShort === jShort && Math.abs(rWord.length - jWord.length) <= 5) {
        anchors.push({ jsonId: jId, rawIdx: k });
        scanFrom = k + 1;
        found = true;
        break;
      }
    }
  }
}

console.log("Anchors matched:", anchors.length, "out of", existingData.length);

// Show first and last few anchors
console.log("\nFirst 5 anchors:");
anchors.slice(0, 5).forEach((a) => {
  console.log(
    `  jsonId=${a.jsonId} -> rawIdx=${a.rawIdx} word='${rawEntries[a.rawIdx].word.substring(0, 40)}'`
  );
});
console.log("Last 5 anchors:");
anchors.slice(-5).forEach((a) => {
  console.log(
    `  jsonId=${a.jsonId} -> rawIdx=${a.rawIdx} word='${rawEntries[a.rawIdx].word.substring(0, 40)}'`
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
for (const anchor of anchors.slice(0, 5)) {
  const before = rawEntries[anchor.rawIdx - 1];
  const at = rawEntries[anchor.rawIdx];
  const after = rawEntries[anchor.rawIdx + 1];
  const idBefore = rawToId.get(anchor.rawIdx - 1);
  const idAt = rawToId.get(anchor.rawIdx);
  const idAfter = rawToId.get(anchor.rawIdx + 1);
  console.log(
    `  [${idBefore}] ${before ? before.word.substring(0, 30) : "?"} | [${idAt}] ${at.word.substring(0, 30)} (anchor) | [${idAfter}] ${after ? after.word.substring(0, 30) : "?"}`
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
