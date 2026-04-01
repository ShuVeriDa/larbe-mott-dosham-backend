import { readFileSync, writeFileSync } from "fs";
import { parseBaisultanovEntries } from "./src/merge/parsers/baisultanov.parser";
import type { RawDictEntry } from "./src/merge/parsers/types";

const raw = JSON.parse(
  readFileSync("dictionaries/baisultanov_ce_ru.json", "utf-8"),
) as RawDictEntry[];

const parsed = parseBaisultanovEntries(raw);
writeFileSync(
  "dictionaries/parsed/baisultanov-nah-ru.json",
  JSON.stringify(parsed, null, 2),
  "utf-8",
);
console.log("Parsed:", parsed.length);

const e = parsed.find((e) => e.word === "Авиакхийсар");
console.log("Авиакхийсар plural:", e?.grammar?.plural);
