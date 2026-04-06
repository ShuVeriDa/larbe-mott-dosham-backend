import * as fs from "node:fs";
import { parseAbdurashidovEntries } from "src/merge/parsers/abdurashidov.parser";

const raw = JSON.parse(
  fs.readFileSync("./dictionaries/abdurashidov_ce_ru_ru_ce.json", "utf8"),
);
const result = parseAbdurashidovEntries(raw);
console.log("Total entries:", result.length);

// Check хьаькам
const h = result.filter((e: any) => e.word === "хьаькам");
console.log("\n=== хьаькам entries ===");
h.forEach((e: any) => console.log(JSON.stringify(e, null, 2)));

// Check анонимность -> should produce 2 entries
const anon = result.filter((e: any) =>
  e.meanings?.some((m: any) => m.translation?.includes("анонимность")),
);
console.log("\n=== анонимность entries ===");
anon.forEach((e: any) => console.log(JSON.stringify(e, null, 2)));

// Check выдел имущества -> should produce 2 entries
const vydel = result.filter((e: any) =>
  e.meanings?.some((m: any) => m.translation?.includes("выдел имущества")),
);
console.log("\n=== выдел имущества entries ===");
vydel.forEach((e: any) => console.log(JSON.stringify(e, null, 2)));

// Check автор phraseology
const avtor = result.filter((e: any) => e.word === "автор");
console.log("\n=== автор entries ===");
avtor.forEach((e: any) => console.log(JSON.stringify(e, null, 2)));

// Check administracja sub-entries
const admin = result.filter((e: any) =>
  e.meanings?.some((m: any) => m.translation === "администрация"),
);
console.log("\n=== администрация entries ===");
admin.forEach((e: any) => console.log(JSON.stringify(e, null, 2)));

// Count empty ru in phraseology
let emptyRu = 0;
for (const e of result) {
  if (e.phraseology) {
    for (const p of e.phraseology) {
      if (!p.ru) emptyRu++;
    }
  }
}
console.log("\n=== Empty ru in phraseology:", emptyRu, "===");

// Check арест entries
const arest = result.filter((e: any) =>
  e.meanings?.some((m: any) => m.translation?.includes("арест")),
);
console.log("\n=== арест entries (first 3) ===");
arest.slice(0, 3).forEach((e: any) => console.log(JSON.stringify(e, null, 2)));

// Sample empty ru phraseology
console.log("\n=== Sample empty ru phraseology (first 30) ===");
let emptyCount = 0;
for (const e of result) {
  if (e.phraseology) {
    for (const p of e.phraseology) {
      if (!p.ru) {
        console.log(`  word="${e.word}" nah="${p.nah}"`);
        emptyCount++;
        if (emptyCount >= 30) break;
      }
    }
  }
  if (emptyCount >= 30) break;
}
