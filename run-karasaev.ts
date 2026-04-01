import { readFileSync, writeFileSync } from "fs";
import { parseKarasaevEntries } from "./src/merge/parsers/karasaev.parser";
import type { RawDictEntry } from "./src/merge/parsers/types";

const rawJson = readFileSync("dictionaries/karasaev_maciev_ru_ce.json", "utf-8");
const rawParsed: unknown = JSON.parse(rawJson);

if (!Array.isArray(rawParsed)) {
  throw new Error("Expected dictionaries/karasaev_maciev_ru_ce.json to be an array");
}

const parsed = parseKarasaevEntries(rawParsed as RawDictEntry[]);
writeFileSync(
  "dictionaries/parsed/karasaev-maciev-ru-nah.json",
  JSON.stringify(parsed, null, 2),
  "utf-8",
);
console.log("Parsed:", parsed.length);
