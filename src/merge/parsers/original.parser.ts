import type { RawDictEntry } from "./types";

/**
 * Парсер для оригинальных словарей:
 * — удаляет дубликаты (по id + word + translate)
 * — сортирует по id (числовой порядок)
 *
 * Не трансформирует данные — возвращает исходные записи как есть.
 */
export function deduplicateAndSort(raws: RawDictEntry[]): RawDictEntry[] {
  const seen = new Set<string>();
  const unique: RawDictEntry[] = [];

  for (const e of raws) {
    const key = `${e.id ?? ""}|${e.word}|${e.translate}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  unique.sort((a, b) => {
    const idA = Number(a.id ?? 0);
    const idB = Number(b.id ?? 0);
    return idA - idB;
  });

  return unique;
}
