/**
 * Extracts missing dictionary entries from the Baisultanov txt file.
 *
 * HYBRID APPROACH:
 * 1. Use a broad entry-detection heuristic to find all candidate entry-start lines.
 * 2. Use anchor words from baisultanov_ce_ru.json to align candidate entries with IDs.
 * 3. Between aligned anchors, assign sequential IDs to intermediate candidates.
 * 4. Collect entries whose IDs are in the missing list.
 */

const fs = require("fs");
const path = require("path");

const TXT_PATH =
  "C:/Users/ShuVarhiDa/Desktop/Байсултанов нохчийн-оьрсийн дошам.txt";
const JSON_PATH = path.join(
  __dirname,
  "../dictionaries/baisultanov_ce_ru.json",
);
const OUTPUT_PATH = path.join(
  __dirname,
  "../dictionaries/baisultanov_ce_ru_missing.json",
);

// ---------------------------------------------------------------------------
// 1. Parse missing IDs
// ---------------------------------------------------------------------------

const MISSING_RANGES =
  "8, 11, 14, 17-18, 20-21, 25, 28, 30-34, 42-45, 47, 52, 54-56, 61, 65, 67-73, 75, 81, 86-87, 90, 93-96, 98, 106-108, 112, 114, 116-117, 120-121, 125-126, 137, 142, 144-145, 148-149, 154, 156, 158, 161, 168, 170-171, 178, 180, 182, 188, 190-191, 193-195, 202, 205-206, 209, 217, 219, 233, 237-238, 244, 248-250, 254, 258-259, 261, 265-266, 275, 278, 281, 283-285, 288, 290, 295-296, 298, 306-307, 310, 314, 320, 326, 329, 333, 336-338, 340-341, 345-346, 352, 355, 357, 366-367, 373-374, 377, 380, 386-387, 389-390, 396-397, 403-405, 410, 415, 419, 423, 427, 435, 438, 440, 443, 445-446, 448, 450, 457, 460, 463, 466-468, 470-472, 483, 485, 490, 494-496, 499-500, 503, 508-509, 511, 513, 515-516, 518-519, 527, 536, 540-541, 544, 546-548, 551-552, 559-560, 562, 566, 569-571, 575-579, 581, 585, 587, 590, 592, 601, 603, 605-606, 610-612, 614, 616-618, 620-625, 632, 635, 638-639, 642, 648-651, 654, 657, 659, 663-665, 671-672, 679, 682, 685, 691, 695-696, 702, 711-714, 716, 718, 720, 722-724, 727, 730, 732-733, 737, 740, 742, 744, 746-747, 749, 754, 757-760, 763-764, 771, 777-778, 784-786, 788-789, 791, 793, 800, 803, 806-807, 812, 814-815, 817-821, 824-825, 828, 831, 838, 845, 849-850, 855, 857, 865-866, 869-870, 877-881, 884, 886, 888, 897, 901, 907, 909, 913, 917, 919, 929, 938-939, 941, 954, 962, 967-968, 970-971, 974, 976, 980, 991-993, 1006, 1009, 1011-1013, 1017-1018, 1020-1021, 1024-1025, 1034, 1036, 1043, 1045, 1047, 1061-1062, 1068, 1072-1073, 1075-1077, 1081, 1084, 1089, 1091, 1101, 1105, 1107-1108, 1112, 1115, 1118-1119, 1123-1127, 1130-1131, 1134-1137, 1139, 1142, 1149-1153, 1155, 1159, 1161-1164, 1169, 1171-1174, 1178-1180, 1184-1185, 1188-1189, 1192, 1199, 1205, 1207, 1209-1210, 1212, 1216-1219, 1222-1225, 1228-1231, 1233, 1239, 1241-1242, 1244, 1247, 1254, 1258, 1265, 1267-1268, 1270, 1272, 1277-1278, 1282, 1287-1289, 1291, 1293, 1295, 1300, 1302, 1304-1305, 1308, 1311, 1316, 1333, 1335, 1344, 1353, 1359, 1361-1363, 1366-1367, 1369, 1376-1378, 1385, 1397, 1399, 1404, 1407, 1411, 1419, 1424, 1426, 1431-1468, 1472-1475, 1477, 1489, 1493-1494, 1496, 1498-1500, 1503, 1508, 1511, 1513-1514, 1517-1521, 1523, 1525-1526, 1528, 1530-1532, 1534, 1537-1538, 1543-1546, 1549, 1552, 1555-1559, 1564, 1566, 1570-1571, 1581-1582, 1590-1592, 1594-1595, 1599, 1605-1609, 1613, 1616, 1620-1621, 1626, 1636, 1640, 1643-1645, 1647, 1656-1658, 1661-1662, 1664-1665, 1668-1669, 1671, 1677, 1679, 1682-1683, 1685-1686, 1689, 1691, 1699-1701, 1704-1705, 1712-1713, 1717-1718, 1722, 1731-1733, 1736-1737, 1741, 1743-1748, 1751, 1754, 1758-1760, 1763-1764, 1768-1769, 1771-1772, 1780, 1794, 1801-1802, 1804-1805, 1808, 1811-1812, 1814-1815, 1817-1818, 1820, 1823, 1825-1827, 1833, 1839-1840, 1842, 1844, 1849, 1853-1854, 1856-1858, 1860-1861, 1864-1866, 1872, 1877-1879, 1886-1887, 1889, 1892, 1895, 1900-1901, 1903-1905, 1910-1912, 1915, 1917, 1919, 1921, 1924, 1927-1929, 1933-1936, 1940-1942, 1947, 1949, 1951, 1955, 1957, 1961-1962, 1966, 1968, 1972-1978, 1980-1984, 1986-1990, 1992-1994, 1997, 1999, 2001-2002, 2008-2009, 2011, 2016-2017, 2019, 2023-2024, 2028, 2031-2032, 2038, 2040, 2042-2045, 2053-2055";

function parseRanges(rangesStr) {
  const ids = new Set();
  for (const part of rangesStr.split(",").map((s) => s.trim())) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) ids.add(i);
    } else {
      ids.add(Number(part));
    }
  }
  return ids;
}

const missingIds = parseRanges(MISSING_RANGES);
console.log(`Missing IDs count: ${missingIds.size}`);

// ---------------------------------------------------------------------------
// 2. Load files
// ---------------------------------------------------------------------------

const text = fs.readFileSync(TXT_PATH, "utf-8");
const lines = text.split("\n");

const existingEntries = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
console.log(`Existing entries in JSON: ${existingEntries.length}`);

// ---------------------------------------------------------------------------
// 3. Normalization
// ---------------------------------------------------------------------------

function norm(s) {
  return s
    .replace(/<\/?b>/g, "")
    .replace(/<br\s*\/?>/g, "")
    .replace(/Ӏ/g, "1")
    .replace(/ӏ/g, "1")
    .replace(/I/g, "1")
    .replace(/«/g, "")
    .replace(/»/g, "")
    .replace(/\u00AD/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// 4. Find all candidate entry-start lines using a BROAD heuristic
// ---------------------------------------------------------------------------

function isPageNumber(t) {
  return /^\d+$/.test(t);
}
function isSectionHeader(t) {
  return /^[А-ЯЁӀ]$/.test(t);
}

// Find dictionary section start
let dictStart = 0;
for (let i = 0; i < lines.length; i++) {
  if (/^\s{10,}А\s*$/.test(lines[i]) && i > 800) {
    dictStart = i + 1;
    break;
  }
}
console.log(`Dictionary starts at line ${dictStart + 1}`);

// Broad entry detection: any line starting with uppercase letter that has ". " pattern
// We'll be VERY broad here and then use anchors to filter.
const candidateLines = []; // line indices

for (let i = dictStart; i < lines.length; i++) {
  const trimmed = lines[i].trim();
  if (!trimmed || isPageNumber(trimmed) || isSectionHeader(trimmed)) continue;
  if (!/^[А-ЯЁӀ1«]/.test(trimmed)) continue;

  // Find ". " with paren tracking (including depth-1 fallback for unbalanced)
  let parenDepth = 0;
  let found = false;
  let foundAt1 = false;
  for (let j = 0; j < Math.min(trimmed.length - 1, 150); j++) {
    if (trimmed[j] === "(") parenDepth++;
    else if (trimmed[j] === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (trimmed[j] === "." && trimmed[j + 1] === " ") {
      if (parenDepth === 0) {
        found = true;
        break;
      }
      if (parenDepth === 1) {
        foundAt1 = true;
      }
    }
  }

  if (found || foundAt1) {
    candidateLines.push(i);
  }
}

console.log(`Candidate entry-start lines: ${candidateLines.length}`);

// ---------------------------------------------------------------------------
// 5. Build anchors from existing JSON and find them in candidates
// ---------------------------------------------------------------------------

// Extract first word from each anchor for matching
const anchors = existingEntries
  .map((e) => {
    const clean = e.word
      .replace(/<\/?b>/g, "")
      .replace(/<br\s*\/?>/g, " ")
      .trim();
    return {
      id: Number(e.id),
      word: e.word,
      normFirstWord: norm(clean.split(/[\s(,]/)[0]),
    };
  })
  .sort((a, b) => a.id - b.id);

// For each candidate line, compute its normalized first word
const candidateInfo = candidateLines.map((lineIdx) => {
  const trimmed = lines[lineIdx].trim();
  const firstWord = norm(trimmed.split(/[\s(.,:;!?«»<>]/)[0]);
  return { lineIdx, firstWord };
});

// For each anchor, find the BEST matching candidate (globally, not sequentially)
// using normalized first word match. We need matches to be in order.
// Strategy: for each anchor, find all candidates that match its first word,
// then use dynamic programming or greedy to find the longest ordered subsequence.

// Build a map: normFirstWord -> list of candidate indices (positions in candidateLines)
const wordToCandidates = new Map();
for (let ci = 0; ci < candidateInfo.length; ci++) {
  const w = candidateInfo[ci].firstWord;
  if (!wordToCandidates.has(w)) wordToCandidates.set(w, []);
  wordToCandidates.get(w).push(ci);
}

// Smart ordered matching: go through anchors in order, for each find the
// best matching candidate that's after the previous match, but within a
// reasonable distance. If no match found nearby, skip this anchor.
// This prevents one bad match from cascading and blocking all subsequent matches.

let lastMatchedCandidate = -1;
let lastMatchedAnchorId = 0;
const anchorToCandidate = new Map(); // anchorId -> candidateIndex

for (const anchor of anchors) {
  const candidates = wordToCandidates.get(anchor.normFirstWord) || [];
  if (candidates.length === 0) continue;

  // Find first candidate after lastMatchedCandidate
  let bestCi = -1;
  for (const ci of candidates) {
    if (ci > lastMatchedCandidate) {
      bestCi = ci;
      break;
    }
  }

  if (bestCi >= 0) {
    // Sanity check: the candidate shouldn't be unreasonably far ahead
    // Expected: roughly (anchor.id - lastMatchedAnchorId) * 1.5 candidates apart
    const expectedGap = anchor.id - lastMatchedAnchorId;
    const actualGap = bestCi - lastMatchedCandidate;

    // Allow up to 3x the expected gap (generous margin for extra candidates)
    if (actualGap <= expectedGap * 3 + 20 || lastMatchedCandidate === -1) {
      anchorToCandidate.set(anchor.id, bestCi);
      lastMatchedCandidate = bestCi;
      lastMatchedAnchorId = anchor.id;
    }
    // If too far, skip this anchor to avoid cascading errors
  }
}

// Second pass: try to fill in skipped anchors by looking backwards
// For anchors that weren't matched, see if there's a candidate between
// the previous and next matched anchors
const matchedAnchorIds = [...anchorToCandidate.keys()].sort((a, b) => a - b);

for (const anchor of anchors) {
  if (anchorToCandidate.has(anchor.id)) continue;
  const candidates = wordToCandidates.get(anchor.normFirstWord) || [];
  if (candidates.length === 0) continue;

  // Find the closest matched anchors before and after
  let prevCi = -1;
  let nextCi = candidateLines.length;
  for (const mid of matchedAnchorIds) {
    if (mid < anchor.id) prevCi = anchorToCandidate.get(mid);
    if (mid > anchor.id && nextCi === candidateLines.length) {
      nextCi = anchorToCandidate.get(mid);
    }
  }

  // Find a candidate between prevCi and nextCi
  for (const ci of candidates) {
    if (ci > prevCi && ci < nextCi) {
      anchorToCandidate.set(anchor.id, ci);
      break;
    }
  }
}

const matchedAnchors = anchorToCandidate.size;
console.log(`Anchors matched: ${matchedAnchors}/${anchors.length}`);

// ---------------------------------------------------------------------------
// 6. Assign IDs to all candidates using anchor alignment
// ---------------------------------------------------------------------------

// Convert anchor matches to sorted list
const anchorMatches = [...anchorToCandidate.entries()]
  .map(([id, ci]) => ({ id, ci }))
  .sort((a, b) => a.ci - b.ci);

// Build the final ID assignment
// Between consecutive anchor matches, we know:
// - anchor A at candidate index ci_a has ID id_a
// - anchor B at candidate index ci_b has ID id_b
// - The candidates between ci_a and ci_b (exclusive) should have IDs id_a+1, id_a+2, ..., id_b-1
// - There should be exactly (id_b - id_a - 1) candidates between them
// - If there are more: some are false positives; if fewer: some entries were not detected

const idAssignment = new Map(); // candidateIndex -> id

// Assign anchor IDs
for (const m of anchorMatches) {
  idAssignment.set(m.ci, m.id);
}

// Process each gap between consecutive anchors
let totalExcess = 0;
let totalDeficit = 0;

// Handle gap before first anchor
if (anchorMatches.length > 0) {
  const first = anchorMatches[0];
  const beforeCount = first.ci; // candidates before first anchor
  const expectedBefore = first.id - 1; // IDs 1 to first.id-1

  if (beforeCount <= expectedBefore) {
    // Assign IDs from the end (closest to first anchor get highest IDs)
    for (let j = 0; j < beforeCount; j++) {
      idAssignment.set(j, first.id - beforeCount + j);
    }
  } else {
    // More candidates than expected — assign best guess
    // Take last `expectedBefore` candidates
    const start = beforeCount - expectedBefore;
    for (let j = start; j < beforeCount; j++) {
      idAssignment.set(j, first.id - (beforeCount - j));
    }
    totalExcess += beforeCount - expectedBefore;
  }
}

// Gaps between consecutive anchors
for (let ai = 0; ai < anchorMatches.length - 1; ai++) {
  const curr = anchorMatches[ai];
  const next = anchorMatches[ai + 1];
  const expectedGap = next.id - curr.id - 1;

  // Candidates between (exclusive)
  const between = [];
  for (let ci = curr.ci + 1; ci < next.ci; ci++) {
    between.push(ci);
  }

  if (between.length === expectedGap) {
    // Perfect — assign sequential IDs
    for (let j = 0; j < between.length; j++) {
      idAssignment.set(between[j], curr.id + 1 + j);
    }
  } else if (between.length > expectedGap) {
    // Too many candidates — need to select the best ones
    // Score each candidate by how "entry-like" it is
    const scored = between.map((ci) => {
      const trimmed = lines[candidateLines[ci]].trim();
      let score = 0;

      // Grammar in parens: strong signal — look for actual grammar patterns
      // Real grammar: (-аш), (-й), (в, й, д, б), (-наш), (-рш), (обобщ. смысл...)
      // The grammar typically appears RIGHT AFTER the headword and BEFORE ". "
      // Pattern: headword is short, then (grammar) then ". "
      {
        const dotPos = trimmed.indexOf(". ");
        const headSection = dotPos > 0 ? trimmed.substring(0, dotPos) : "";

        // Check head section word count (excluding parens content)
        const headWithoutParens = headSection
          .replace(/\([^)]*\)/g, "")
          .replace(/«[^»]*»/g, "")
          .trim();
        const headWords = headWithoutParens
          .split(/[\s\-]+/)
          .filter((w) => w.length > 0);
        // If headword part has > 4 words (excl parens), not a dictionary entry
        if (headWords.length > 4) score -= 3;

        // Look for grammar parens RIGHT AFTER the first word in the head
        // Grammar typically appears as: Word (-аш) or Word (grammar-info)
        // Not as part of a long phrase
        const grammarInHead = headSection.match(
          /\((-?[а-яёӀ1ӏА-ЯЁшйьоуюеа,\s.:\-]+)\)/g,
        );
        if (grammarInHead && headWords.length <= 3) {
          for (const gm of grammarInHead) {
            const content = gm.slice(1, -1);
            // Grammar is short AND doesn't contain full words separated by spaces
            // (unless it's a class list like "в, й, д, б")
            const grammarWords = content.trim().split(/\s+/);
            const isGrammar =
              content.length < 25 &&
              (grammarWords.length <= 2 || // Short phrase
                grammarWords.every((w) => w.length <= 3) || // All short tokens
                /^-/.test(content)); // Starts with dash
            if (isGrammar) {
              score += 5;
              break;
            }
          }
        }
      }

      // Style labels
      if (
        /\.\s+(Устар|Прост|Разг|Старин|Диал|Ирон|Бран|Груб|Книжн|Шутл|Арабск|Зоол|Анатом|Мед|Экспресс|Звукоподр|Неодобр|Презр|Ласк|Одобр|Уничиж)\.?/i.test(
          trimmed,
        )
      )
        score += 4;

      // Short headword before first ". "
      const dotIdx = trimmed.indexOf(". ");
      if (dotIdx > 0 && dotIdx < 30) score += 3;
      else if (dotIdx > 0 && dotIdx < 50) score += 2;
      else if (dotIdx > 0 && dotIdx < 70) score += 1;

      // Has indentation (typical for entries)
      if (/^\s{3,}/.test(lines[candidateLines[ci]])) score += 1;

      // Penalty: ends with ) before dot — likely citation end
      const headPart = dotIdx > 0 ? trimmed.substring(0, dotIdx).trim() : "";
      if (headPart.endsWith(")") && !headPart.includes("(")) score -= 5;

      // Penalty: looks like author reference "X.Surname"
      if (/^[А-ЯЁ]\.[А-ЯЁа-яё]/.test(headPart)) score -= 4;
      if (/^[А-ЯЁ]\.-/.test(headPart)) score -= 4;

      // Penalty: head part contains common citation text
      if (/фольклор|философи|кн\.\s/i.test(headPart)) score -= 3;

      // Numbered definition like "1.Маленький"
      const afterDot = dotIdx > 0 ? trimmed.substring(dotIdx + 2).trim() : "";
      if (/^\d+\./.test(afterDot)) score += 2;

      return { ci, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const selected = scored.slice(0, expectedGap).sort((a, b) => a.ci - b.ci);

    for (let j = 0; j < selected.length; j++) {
      idAssignment.set(selected[j].ci, curr.id + 1 + j);
    }
    totalExcess += between.length - expectedGap;
  } else {
    // Too few candidates — assign what we have
    for (let j = 0; j < between.length; j++) {
      idAssignment.set(between[j], curr.id + 1 + j);
    }
    totalDeficit += expectedGap - between.length;
  }
}

// Handle gap after last anchor
if (anchorMatches.length > 0) {
  const last = anchorMatches[anchorMatches.length - 1];
  const maxId = 2057;
  const expectedAfter = maxId - last.id;
  const afterCandidates = [];
  for (let ci = last.ci + 1; ci < candidateLines.length; ci++) {
    afterCandidates.push(ci);
  }

  const toAssign = Math.min(afterCandidates.length, expectedAfter);
  for (let j = 0; j < toAssign; j++) {
    idAssignment.set(afterCandidates[j], last.id + 1 + j);
  }
}

console.log(`IDs assigned: ${idAssignment.size}`);
console.log(
  `Excess candidates filtered: ${totalExcess}, Deficit: ${totalDeficit}`,
);

// ---------------------------------------------------------------------------
// 7. Verify alignment
// ---------------------------------------------------------------------------

let verifyMatch = 0;
let verifyMismatch = 0;
const mismatchSamples = [];

for (const anchor of anchors) {
  const ci = anchorToCandidate.get(anchor.id);
  if (ci !== undefined) {
    const assignedId = idAssignment.get(ci);
    if (assignedId === anchor.id) {
      verifyMatch++;
    } else {
      verifyMismatch++;
      if (mismatchSamples.length < 5) {
        mismatchSamples.push(
          `  Anchor ${anchor.id} matched candidate ${ci}, but assigned ID ${assignedId}`,
        );
      }
    }
  }
}
console.log(
  `Anchor ID verification: ${verifyMatch} correct, ${verifyMismatch} wrong`,
);
for (const s of mismatchSamples) console.log(s);

// Also verify some specific entries
console.log("\n--- Sample entries ---");
const sampleIds = [1, 2, 7, 8, 9, 10, 22, 100, 500, 1000, 1500, 2000, 2057];
for (const id of sampleIds) {
  // Find candidate with this assigned ID
  let found = false;
  for (const [ci, assignedId] of idAssignment) {
    if (assignedId === id) {
      const trimmed = lines[candidateLines[ci]].trim();
      const firstWord = trimmed.split(/[\s(.,:;!?]/)[0];
      const jsonEntry = existingEntries.find((e) => Number(e.id) === id);
      const jsonWord = jsonEntry
        ? jsonEntry.word.replace(/<\/?b>/g, "").split(/[\s(,]/)[0]
        : "(missing from json)";
      console.log(
        `  ID ${id}: txt="${firstWord}" json="${jsonWord}" line=${candidateLines[ci] + 1}`,
      );
      found = true;
      break;
    }
  }
  if (!found) console.log(`  ID ${id}: NOT FOUND`);
}

// ---------------------------------------------------------------------------
// 8. Extract entry text and format missing entries
// ---------------------------------------------------------------------------

// Sort all assigned entries by candidate index
const sortedAssigned = [...idAssignment.entries()]
  .map(([ci, id]) => ({ ci, id, lineIdx: candidateLines[ci] }))
  .sort((a, b) => a.ci - b.ci);

function extractEntryText(sortedIdx) {
  const entry = sortedAssigned[sortedIdx];
  const startLine = entry.lineIdx;
  const endLine =
    sortedIdx + 1 < sortedAssigned.length
      ? sortedAssigned[sortedIdx + 1].lineIdx
      : lines.length;

  const entryLines = [];
  for (let i = startLine; i < endLine; i++) {
    const trimmed = lines[i].trim();
    if (isPageNumber(trimmed)) continue;
    if (isSectionHeader(trimmed)) continue;
    entryLines.push(trimmed);
  }
  while (entryLines.length > 0 && !entryLines[entryLines.length - 1]) {
    entryLines.pop();
  }
  return entryLines;
}

function formatEntry(id, entryLines) {
  if (!entryLines.length) return { id: String(id), word: "", translate: "" };

  const firstLine = entryLines[0];

  // Find first ". " outside (or at depth 1 for unbalanced) parens
  let parenDepth = 0;
  let splitIdx = -1;
  let splitAt1 = -1;
  for (let i = 0; i < firstLine.length - 1; i++) {
    if (firstLine[i] === "(") parenDepth++;
    else if (firstLine[i] === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (firstLine[i] === "." && firstLine[i + 1] === " ") {
      if (parenDepth === 0) {
        splitIdx = i;
        break;
      }
      if (parenDepth === 1 && splitAt1 < 0) splitAt1 = i;
    }
  }
  if (splitIdx < 0) splitIdx = splitAt1;

  let word, translate;
  if (splitIdx >= 0) {
    word = firstLine.substring(0, splitIdx).trim();
    const restOfFirst = firstLine.substring(splitIdx + 2).trim();
    const rest = [restOfFirst, ...entryLines.slice(1)].filter(
      (l) => l.length > 0,
    );
    translate = rest.join("\n");
  } else {
    word = firstLine.trim();
    translate = entryLines
      .slice(1)
      .filter((l) => l.length > 0)
      .join("\n");
  }

  return { id: String(id), word, translate };
}

// Build a lookup: id -> sortedAssigned index
const idToSortedIdx = new Map();
for (let i = 0; i < sortedAssigned.length; i++) {
  idToSortedIdx.set(sortedAssigned[i].id, i);
}

const missingEntries = [];
const notFound = [];

for (const id of [...missingIds].sort((a, b) => a - b)) {
  const sortedIdx = idToSortedIdx.get(id);
  if (sortedIdx !== undefined) {
    const entryLines = extractEntryText(sortedIdx);
    missingEntries.push(formatEntry(id, entryLines));
  } else {
    notFound.push(id);
  }
}

console.log(`\nMissing entries extracted: ${missingEntries.length}`);
if (notFound.length > 0) {
  console.log(
    `Could not find ${notFound.length} IDs: ${notFound.slice(0, 30).join(", ")}${notFound.length > 30 ? "..." : ""}`,
  );
}

// Show samples
console.log("\nFirst 5 missing entries:");
for (const e of missingEntries.slice(0, 5)) {
  console.log(
    `  ID ${e.id}: "${e.word}" => "${e.translate.substring(0, 70)}..."`,
  );
}
console.log("Last 5 missing entries:");
for (const e of missingEntries.slice(-5)) {
  console.log(
    `  ID ${e.id}: "${e.word}" => "${e.translate.substring(0, 70)}..."`,
  );
}

// ---------------------------------------------------------------------------
// 9. Post-processing: filter out likely false positive entries
// ---------------------------------------------------------------------------

const cleanedEntries = missingEntries.filter((e) => {
  const word = e.word;
  // Remove entries where the "word" is clearly not a dictionary headword:
  if (word.length === 0) return false;
  if (word.length > 60) return false; // Too long for a headword
  if (/\)/.test(word) && !/\(/.test(word)) return false; // Unbalanced closing paren (citation end)
  if (/^[А-ЯЁ]\.\s*[А-ЯЁа-яё]/.test(word)) return false; // Author initial "X.Surname"
  if (/^[А-ЯЁ]\.-/.test(word)) return false; // Author double initial
  return true;
});

const removed = missingEntries.length - cleanedEntries.length;
if (removed > 0) {
  console.log(
    `\nRemoved ${removed} likely false positive entries during post-processing`,
  );
}

// ---------------------------------------------------------------------------
// 10. Save
// ---------------------------------------------------------------------------

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(cleanedEntries, null, 2), "utf-8");
console.log(`\nSaved ${cleanedEntries.length} entries to ${OUTPUT_PATH}`);
