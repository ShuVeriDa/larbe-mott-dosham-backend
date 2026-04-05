/**
 * Extracts missing entries from the Karasaev-Maciev Russian-Chechen dictionary txt file
 * that are not present in karasaev_maciev_ru_ce.json, and saves them as a new JSON file.
 */

const fs = require("fs");
const path = require("path");

const TXT_PATH =
  "C:/Users/ShuVarhiDa/Desktop/Karasaev_A.T._Maciev_A.G._Russko-chechenskiy_slovar.txt";
const JSON_PATH = path.join(
  __dirname,
  "../dictionaries/karasaev_maciev_ru_ce.json"
);
const OUTPUT_PATH = path.join(
  __dirname,
  "../dictionaries/karasaev_maciev_ru_ce_missing.json"
);

// --- Step 1: Build raw entries from txt ---
const text = fs.readFileSync(TXT_PATH, "utf-8");
const lines = text.split("\n");
const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));

let rawEntries = [];
for (let i = 416; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();
  const spaces = line.match(/^(\s*)/)[1].length;
  if (spaces >= 6 && trimmed.length > 0) {
    rawEntries.push({
      lineNum: i + 1,
      firstLine: trimmed,
      fullText: trimmed,
    });
  } else if (spaces === 0 && trimmed.length > 0 && rawEntries.length > 0) {
    rawEntries[rawEntries.length - 1].fullText += " " + trimmed;
  }
}

console.log("Raw entries from txt:", rawEntries.length);

// --- Step 2: Normalize function ---
function norm(s) {
  return s
    .toLowerCase()
    .replace(/\|\|/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .trim();
}

// --- Step 3: Map JSON entries to raw entries (anchors) ---
let jsonAnchors = [];
let scanFrom = 0;

for (let j = 0; j < data.length; j++) {
  const e = data[j];
  const id = parseInt(e.id);
  if (!e.word1 || e.word1.trim() === "" || e.word1.includes("<b>")) continue;

  const jFirst = norm(e.word1)
    .split(/[\s,]/)[0]
    .replace(/\d+$/, "");
  if (!jFirst) continue;

  for (let k = scanFrom; k < Math.min(scanFrom + 200, rawEntries.length); k++) {
    const rFirst = norm(rawEntries[k].firstLine)
      .split(/[\s,]/)[0]
      .replace(/\d+$/, "");
    if (rFirst === jFirst) {
      jsonAnchors.push({ id, rawIdx: k });
      scanFrom = k + 1;
      break;
    }
  }
}

console.log("Anchors found:", jsonAnchors.length);

// --- Step 4: Build rawToId mapping using anchors ---
let rawToId = new Map();
for (const a of jsonAnchors) {
  rawToId.set(a.rawIdx, a.id);
}

// Fill gaps between consecutive anchors
for (let a = 0; a < jsonAnchors.length - 1; a++) {
  const curr = jsonAnchors[a];
  const next = jsonAnchors[a + 1];

  const rawGap = next.rawIdx - curr.rawIdx - 1;
  const idGap = next.id - curr.id - 1;

  if (rawGap === idGap) {
    for (
      let r = curr.rawIdx + 1, id = curr.id + 1;
      r < next.rawIdx;
      r++, id++
    ) {
      rawToId.set(r, id);
    }
  } else if (rawGap > idGap) {
    // More raw entries than expected — identify noise
    let noiseInGap = new Set();
    for (let r = curr.rawIdx + 1; r < next.rawIdx; r++) {
      const t = rawEntries[r].firstLine.trim();
      if (/^[А-ЯЁ]$/.test(t) || /^\d+$/.test(t)) {
        noiseInGap.add(r);
      }
    }

    let id = curr.id + 1;
    for (let r = curr.rawIdx + 1; r < next.rawIdx; r++) {
      if (noiseInGap.has(r)) continue;
      if (id < next.id) {
        rawToId.set(r, id);
        id++;
      }
    }
  } else {
    // rawGap < idGap
    let id = curr.id + 1;
    for (let r = curr.rawIdx + 1; r < next.rawIdx && id < next.id; r++, id++) {
      rawToId.set(r, id);
    }
  }
}

// Handle entries before first anchor
const firstAnchor = jsonAnchors[0];
for (
  let r = firstAnchor.rawIdx - 1, id = firstAnchor.id - 1;
  r >= 0 && id >= 0;
  r--, id--
) {
  rawToId.set(r, id);
}

// Handle entries after last anchor
const lastAnchor = jsonAnchors[jsonAnchors.length - 1];
let lastId = lastAnchor.id;
for (let r = lastAnchor.rawIdx + 1; r < rawEntries.length; r++) {
  const t = rawEntries[r].firstLine.trim();
  if (
    /^[А-ЯЁ]$/.test(t) ||
    /^\d+$/.test(t) ||
    t.startsWith("ГЕОГРАФИЧЕСКИЕ")
  )
    break;
  lastId++;
  rawToId.set(r, lastId);
}

console.log("Total mapped entries:", rawToId.size);

// --- Step 5: Extract headword and translate from fullText ---
function extractWordAndTranslate(fullText) {
  const clean = fullText.replace(/\|\|/g, "");

  // Pattern 1: word (with optional endings and homonym number) + grammar marker
  const grammarPattern =
    /^(.*?(?:,\s*-\w+)*\s*\d*)\s+(м\s|м$|м,|ж\s|ж$|ж,|с\s|с$|с,|мн\.|нареч\.|предлог|союз|частица|межд\.|числ\.|мест\.|несов\.|сов\.|приставка|нескл\.|собир\.|вводн\.)/;

  let match = clean.match(grammarPattern);
  if (match) {
    const word = match[1].trim();
    const translate = clean.substring(match.index + match[1].length).trim();
    return { word1: word, translate };
  }

  // Pattern 2: adjective/participle — word, -ая, -ое translation
  const adjPattern =
    /^(.+?,\s*-[а-яёА-ЯЁ]+(?:,\s*-[а-яёА-ЯЁ]+)*(?::\s*[^а-яёА-ЯЁ(]*)?)\s+([а-яёА-ЯЁ(1-9].+)/;
  match = clean.match(adjPattern);
  if (match) {
    return { word1: match[1].trim(), translate: match[2].trim() };
  }

  // Fallback
  return { word1: clean, translate: "" };
}

// --- Step 6: Find missing entries and format ---
const existingIds = new Set(data.map((e) => parseInt(e.id)));

let missingEntries = [];
for (const [rawIdx, id] of rawToId) {
  if (!existingIds.has(id)) {
    const entry = rawEntries[rawIdx];
    const { word1, translate } = extractWordAndTranslate(entry.fullText);
    missingEntries.push({
      id: String(id),
      word1,
      word: word1,
      translate,
    });
  }
}

missingEntries.sort((a, b) => parseInt(a.id) - parseInt(b.id));
console.log("Missing entries found:", missingEntries.length);

// --- Step 7: Save ---
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(missingEntries, null, 2), "utf-8");
console.log(`\nSaved to: ${OUTPUT_PATH}`);

// Show first 10 entries as sample
console.log("\nSample entries:");
missingEntries.slice(0, 10).forEach((e) => {
  console.log(
    `  id=${e.id}: word1='${e.word1.substring(0, 40)}' translate='${e.translate.substring(0, 40)}'`
  );
});
