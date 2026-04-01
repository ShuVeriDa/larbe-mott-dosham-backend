import { readFileSync, writeFileSync } from "fs";
import { parseDaukaevEntries } from "./src/merge/parsers/daukaev.parser";
import type { RawDictEntry } from "./src/merge/parsers/types";

const rawJson = readFileSync("dictionaries/daukaev_ru_ce.json", "utf-8");
const rawParsed: unknown = JSON.parse(rawJson);

if (!Array.isArray(rawParsed)) {
  throw new Error("Expected dictionaries/daukaev_ru_ce.json to be an array");
}

const parsed = parseDaukaevEntries(rawParsed as RawDictEntry[]);
writeFileSync(
  "dictionaries/parsed/daukaev-ru-nah.json",
  JSON.stringify(parsed, null, 2),
  "utf-8",
);
console.log("Parsed:", parsed.length);
