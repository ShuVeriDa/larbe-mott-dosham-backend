import { readFileSync, writeFileSync } from "fs";
import { parseIsmailovCeRuEntries, parseIsmailovRuCeEntries } from "./src/merge/parsers/ismailov.parser";
import type { RawDictEntry } from "./src/merge/parsers/types";

// CE→RU
const ceRuJson = readFileSync("dictionaries/ismailov_ce_ru.json", "utf-8");
const ceRuRaw: unknown = JSON.parse(ceRuJson);
if (!Array.isArray(ceRuRaw)) throw new Error("Expected array");
const ceRuParsed = parseIsmailovCeRuEntries(ceRuRaw as RawDictEntry[]);
writeFileSync("dictionaries/parsed/ismailov-nah-ru.json", JSON.stringify(ceRuParsed, null, 2), "utf-8");
console.log("CE→RU parsed:", ceRuParsed.length);

// RU→CE
const ruCeJson = readFileSync("dictionaries/ismailov_ru_ce.json", "utf-8");
const ruCeRaw: unknown = JSON.parse(ruCeJson);
if (!Array.isArray(ruCeRaw)) throw new Error("Expected array");
const ruCeParsed = parseIsmailovRuCeEntries(ruCeRaw as RawDictEntry[]);
writeFileSync("dictionaries/parsed/ismailov-ru-nah.json", JSON.stringify(ruCeParsed, null, 2), "utf-8");
console.log("RU→CE parsed:", ruCeParsed.length);
