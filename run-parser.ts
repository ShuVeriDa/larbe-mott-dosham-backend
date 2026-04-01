import { readFileSync, writeFileSync } from "fs";
import { parseAslahanovEntries } from "./src/merge/parsers/aslahanov.parser";
import type { RawDictEntry } from "./src/merge/parsers/types";

const rawJson = readFileSync("dictionaries/aslahanov_ru_ce.json", "utf-8");
const rawParsed: unknown = JSON.parse(rawJson);

if (!Array.isArray(rawParsed)) {
  throw new Error("Expected dictionaries/aslahanov_ru_ce.json to be an array");
}

const parsed = parseAslahanovEntries(rawParsed as RawDictEntry[]);
writeFileSync(
  "dictionaries/parsed/aslahanov-ru-nah.json",
  JSON.stringify(parsed, null, 2),
  "utf-8",
);
console.log("Parsed:", parsed.length);
