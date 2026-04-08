import type { ParsedEntry, RawDictEntry } from "./types";
import { parseMacievEntries } from "./maciev.parser";
import { parseUmarhadjievEntries } from "./umarhadjiev.parser";
import { parseBaisultanovEntries } from "./baisultanov.parser";
import { parseAbdurashidovEntries } from "./abdurashidov.parser";
import { parseKarasaevEntries } from "./karasaev.parser";
import { parseAslahanovEntries } from "./aslahanov.parser";
import {
  parseAnatomyCeRuEntries,
  parseAnatomyRuCeEntries,
} from "./anatomy.parser";
import { parseComputerEntries } from "./computer.parser";
import { parseDaukaevEntries } from "./daukaev.parser";
import {
  parseIsmailovCeRuEntries,
  parseIsmailovRuCeEntries,
} from "./ismailov.parser";
import { parseCollectedEntries } from "./collected.parser";
import { parseNeologismEntries } from "./neologisms.parser";

export type BatchParser = (raws: RawDictEntry[]) => ParsedEntry[];

/** Возвращает batch-парсер для конкретного словаря по slug */
export function getParser(slug: string): BatchParser {
  switch (slug) {
    case "maciev":
      return parseMacievEntries;
    case "karasaev-maciev-ru-nah":
      return parseKarasaevEntries;
    case "baisultanov-nah-ru":
      return parseBaisultanovEntries;
    case "aslahanov-ru-nah":
      return parseAslahanovEntries;
    case "daukaev-ru-nah":
      return parseDaukaevEntries;
    case "abdurashidov":
      return parseAbdurashidovEntries;
    case "umarhadjiev-ahmatukaev":
      return parseUmarhadjievEntries;
    case "nah-ru-anatomy":
      return parseAnatomyCeRuEntries;
    case "ru-nah-anatomy":
      return parseAnatomyRuCeEntries;
    case "nah-ru-computer":
      return parseComputerEntries;
    case "ismailov-nah-ru":
      return parseIsmailovCeRuEntries;
    case "ismailov-ru-nah":
      return parseIsmailovRuCeEntries;
    case "collected":
      return parseCollectedEntries;
    case "neologisms":
      return parseNeologismEntries;
    default:
      throw new Error(`Неизвестный словарь: ${slug}`);
  }
}

export type {
  ParsedEntry,
  RawDictEntry,
  GrammarInfo,
  Meaning,
  Phrase,
  Citation,
} from "./types";
