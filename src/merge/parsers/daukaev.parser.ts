import type { ParsedEntry, RawDictEntry } from "./types";
import { cleanText, dedup, stripHtml, stripStressMarks } from "./utils";

/**
 * Парсер для геологического словаря Даукаева (daukaev_ru_ce.json).
 * ~2387 записей, ~1793 уникальных. Русско-чеченский.
 *
 * Формат word:
 *   Русский термин, иногда с аннотацией в <i>: м-л, г.п., п.н., (этимология), синонимы
 *
 * Формат translate:
 *   ВСЕГДА начинается с " – ", затем чеченский перевод.
 *   Может содержать класс: <i>(ду/бу/йу/ву)</i> или <i>...(ю)</i>
 *   Может содержать маркеры: м-л, л.м., п.к.
 *   Может содержать чеченские уточнения: <i>(пардонийн)</i>, <i>(тӀулг тайпа...)</i>
 *   Может содержать чеченские синонимы: <i>сурьмин къегар, м-л (ду)</i>
 *
 * Классификация (из word):
 *   м-л = минерал → geology:mineral
 *   г.п. = горная порода → geology:rock
 *   п.н. = палеонтологическое название → geology:paleontology
 */
export function parseDaukaevEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const results: ParsedEntry[] = [];

  for (const raw of unique) {
    const wordRaw = raw.word?.trim();
    const translate = raw.translate?.trim();

    if (!wordRaw || !translate) continue;

    const wordCleaned = cleanText(wordRaw);

    // --- Извлекаем классификацию из <i> тегов в word ---
    const classifMatch = wordCleaned.match(
      /<i>[^<]*(м-л|г\.п\.|п\.н\.)[^<]*<\/i>/,
    );
    const classification = classifMatch?.[1];

    // --- Извлекаем описания из <i> блоков в word (кроме классификаторов) ---
    const wordDescriptions: string[] = [];
    let word = wordCleaned.replace(
      /<i>([^<]*)<\/i>/g,
      (_match, content: string) => {
        const inner = content.trim();
        // Если блок содержит только классификатор — пропускаем (уже извлечён выше)
        if (/^(м-л|г\.п\.|п\.н\.)$/.test(inner)) return "";
        // Убираем классификатор из смешанного блока, оставляем описание
        const desc = inner
          .replace(/,?\s*(м-л|г\.п\.|п\.н\.)\s*/g, "")
          .replace(/^[\s,()+]+|[\s,()+]+$/g, "") // убираем скобки и пунктуацию по краям
          .trim();
        if (desc) wordDescriptions.push(desc);
        return "";
      },
    );
    word = word
      .replace(/\s+/g, " ")
      .replace(/[.,\s]+$/, "") // trailing punctuation
      .trim();

    word = stripStressMarks(stripHtml(word));
    if (!word) continue;

    // --- Обрабатываем translate ---
    let remaining = translate.replace(/^\s*–\s*/, "").trim();
    if (!remaining) continue;

    let nounClass: string | undefined;
    const markers = new Set<string>();

    // Собираем маркеры из word (м-л, г.п., п.н.)
    if (classification) markers.add(classification);

    // Обрабатываем каждый <i>...</i> блок в translate
    remaining = remaining.replace(
      /<i>([^<]*)<\/i>/g,
      (_match, content: string) => {
        let inner = content;

        // Извлекаем класс: (ду), (бу), (йу), (ву)
        const fullClassMatch = inner.match(/\((ду|бу|йу|ву)\)/);
        if (fullClassMatch) {
          nounClass = nounClass || fullClassMatch[1];
          inner = inner.replace(/\((ду|бу|йу|ву)\)/g, "");
        }

        // Краткая форма: (ю) → йу
        const shortMatch = inner.match(/\(ю\)/);
        if (shortMatch) {
          nounClass = nounClass || "йу";
          inner = inner.replace(/\(ю\)/g, "");
        }

        // Извлекаем маркеры: м-л, л.м., п.к. — сохраняем в note
        const markerRe = /м-л|л\.м\.|п\.к\./g;
        let markerMatch: RegExpExecArray | null;
        while ((markerMatch = markerRe.exec(inner)) !== null) {
          markers.add(markerMatch[0]);
        }
        inner = inner.replace(markerRe, "");

        // Чистим
        inner = inner
          .replace(/\s+/g, " ")
          .replace(/^[\s,]+|[\s,]+$/g, "")
          .trim();

        // Если ничего не осталось — убираем блок
        if (!inner) return "";

        // Иначе оставляем содержимое inline (без <i> тегов)
        return ` ${inner}`;
      },
    );

    // Финальная очистка перевода
    const translation = stripStressMarks(
      stripHtml(remaining)
        .replace(/,\s*\(/g, " (") // ", (" → " (" — запятая перед скобкой-уточнением
        .replace(/\s+/g, " ")
        .replace(/^[\s,–]+|[\s,;.]+$/g, "")
        .trim(),
    );

    if (!translation) continue;

    // Домен на основе классификации
    let domain = "geology";
    if (classification === "м-л") domain = "geology:mineral";
    else if (classification === "г.п.") domain = "geology:rock";
    else if (classification === "п.н.") domain = "geology:paleontology";

    const label = markers.size > 0 ? [...markers].join(", ") : undefined;
    const note =
      wordDescriptions.length > 0 ? wordDescriptions.join("; ") : undefined;

    results.push({
      word: stripStressMarks(word),
      nounClass,
      meanings: [{ translation, note, label }],
      domain,
    });
  }

  return results;
}
