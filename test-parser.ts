import { readFileSync } from "fs";
import { parseAbdurashidovEntries } from "./src/merge/parsers/abdurashidov.parser";
const data = JSON.parse(
  readFileSync("./dictionaries/abdurashidov_ce_ru_ru_ce.json", "utf8"),
);
const results = parseAbdurashidovEntries(data);
const withSemicolon = results.filter((e) => e.word.includes(";"));
console.log("Entries with ; in word:", withSemicolon.length);
for (const e of withSemicolon) console.log(JSON.stringify(e, null, 2));
