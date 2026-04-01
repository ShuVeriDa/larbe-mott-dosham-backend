import type { RawDictEntry } from "./types";

// -------------------------------------------------------------------------
// Маппинг классов
// -------------------------------------------------------------------------
const CLASS_MAP: Record<string, string> = {
  в: "ву",
  й: "йу",
  д: "ду",
  б: "бу",
  ю: "йу",
};

export function expandClass(short: string): string | undefined {
  const trimmed = short.trim().toLowerCase();
  return CLASS_MAP[trimmed];
}

/** Парсит составной класс вида "в/й" → "ву/йу" */
export function expandClassCompound(raw: string): string | undefined {
  const parts = raw.split("/").map((p) => expandClass(p.trim()));
  if (parts.some((p) => !p)) return undefined;
  return parts.join("/");
}

// -------------------------------------------------------------------------
// Очистка текста
// -------------------------------------------------------------------------

export function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

export function stripStressMarks(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0301\u0303]/g, "") // acute accent + combining tilde
    .normalize("NFC");
}

/** Заменяет combining tilde (U+0303) на combining acute accent (U+0301).
 *  Используется для чеченских слов, где тильда в источнике обозначает ударение. */
export function tildeToAcute(text: string): string {
  return text.normalize("NFD").replace(/\u0303/g, "\u0301").normalize("NFC");
}

export function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// -------------------------------------------------------------------------
// Дедупликация
// -------------------------------------------------------------------------

/** Убирает дубликаты по id (словари часто содержат 2-3 копии) */
export function dedup(entries: RawDictEntry[]): RawDictEntry[] {
  const seen = new Set<string>();
  const result: RawDictEntry[] = [];
  for (const e of entries) {
    const key = `${e.id ?? ""}|${e.word}|${e.translate}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(e);
    }
  }
  return result;
}

// -------------------------------------------------------------------------
// Извлечение примеров
// -------------------------------------------------------------------------

/** Извлекает пары <b>nah </b>ru из текста.
 *  ru может содержать <i>...</i> теги (домен, пояснения: <i>анат.</i>, <i>кому-л.</i>)
 *  и буквенные подзначения: а) ...; б) ...; в) ... */
export function extractExamples(
  text: string,
): { nah: string; ru: string }[] {
  const results: { nah: string; ru: string }[] = [];
  // Разрешаем ";" когда за ним идёт подзначение (а), б), в), ...)
  const regex = /<b>([^<]+)<\/b>\s*((?:[^<;◊]|<i>[^<]*<\/i>|;\s*(?=[а-е]\)))*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const nah = cleanText(tildeToAcute(match[1]))
      .replace(/[\s.,]+$/, "")
      .replace(/\d+$/, "")
      .replace(/[\s.,]+$/, "")
      .trim();
    const ru = cleanText(stripStressMarks(stripHtml(match[2])))
      .replace(/[.,]+$/, "")
      .trim();
    if (nah) results.push({ nah, ru });
  }
  return results;
}

/** Извлекает пары <b>nah –</b> ru (формат computer словаря) */
export function extractDashExamples(
  text: string,
): { nah: string; ru: string }[] {
  const results: { nah: string; ru: string }[] = [];
  // Паттерн: <b>nah текст –</b> ru текст
  const regex = /<b>([^<]+?)\s*[–\-]\s*<\/b>\s*([^<]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const nah = cleanText(tildeToAcute(match[1]));
    const ru = cleanText(stripStressMarks(match[2]));
    if (nah && ru) results.push({ nah, ru });
  }
  // Также формат: <b>nah</b> – ru (тире снаружи)
  const regex2 = /<b>([^<]+)<\/b>\s*[–\-]\s*([^<;]*)/g;
  while ((match = regex2.exec(text)) !== null) {
    const nah = cleanText(tildeToAcute(match[1]));
    const ru = cleanText(stripStressMarks(match[2]));
    if (nah && ru && !results.some((r) => r.nah === nah)) {
      results.push({ nah, ru });
    }
  }
  return results;
}

// -------------------------------------------------------------------------
// Части речи
// -------------------------------------------------------------------------

export function extractPartOfSpeech(text: string): string | undefined {
  // Поддерживаем оба формата: <i>прил.</i> и <i>(союз)</i>
  const m = text.match(
    /<i>\(?((?:прил|сущ|гл|нареч|числ|мест|союз|предлог|послелог|межд|частица|прич|дееприч|собир|звукоподр)[^<]*?)\)?\s*<\/i>/,
  );
  if (!m) return undefined;
  // Не считаем деривационные пометы ("прич. от", "масд. от" и т.п.) частью речи
  const raw = m[1].replace(/\s+/g, " ").trim();
  if (/\s+от$/.test(raw)) return undefined;
  return normalizePos(raw);
}

const POS_MAP: Record<string, { ru: string; nah: string }> = {
  "сущ.":       { ru: "сущ.",       nah: "ц1ердош" },
  "прил.":      { ru: "прил.",      nah: "билгалдош" },
  "числ.":      { ru: "числ.",      nah: "терахьдош" },
  "мест.":      { ru: "мест.",      nah: "ц1ерметдош" },
  "гл.":        { ru: "гл.",        nah: "хандош" },
  "нареч.":     { ru: "нареч.",     nah: "куцдош" },
  "прич.":      { ru: "прич.",      nah: "хандош-билгалдош" },
  "дееприч.":   { ru: "дееприч.",   nah: "хандош-дештӀаьхье" },
  "межд.":      { ru: "межд.",      nah: "айдардош" },
  "междомет.":  { ru: "межд.",      nah: "айдардош" },
  "союз":       { ru: "союз",       nah: "хуттург" },
  "предлог":    { ru: "предлог",    nah: "дешхьалхе" },
  "послелог":   { ru: "послелог",   nah: "дештӀаьхье" },
  "частица":    { ru: "частица",    nah: "дакъалг" },
  "собир.":     { ru: "собир.",     nah: "гулдаран терахьдош" },
  "звукоподр.": { ru: "звукоподр.", nah: "гӀовгӀа-терадеш" },
};

export function normalizePos(pos: string | undefined): string | undefined {
  if (!pos) return undefined;
  const base = pos
    .replace(/\s+\./g, ".") // "нареч ." → "нареч."
    .replace(/\s+к$/, "")
    .replace(/\s+от$/, "")
    .replace(/\s+см\..*$/, "")
    .trim();

  for (const key of Object.keys(POS_MAP)) {
    if (base.startsWith(key)) return POS_MAP[key].ru;
  }
  return pos.trim();
}

export function posToNah(pos: string | undefined): string | undefined {
  if (!pos) return undefined;
  return POS_MAP[pos]?.nah;
}

// -------------------------------------------------------------------------
// Значения
// -------------------------------------------------------------------------

/**
 * Разбивает текст на нумерованные значения.
 * Формат: "1) text 2) text" или "1. text 2. text"
 */
export function splitMeanings(text: string): string[] {
  // Формат "1) ... 2) ..."
  const numbered = text.split(/(?:^|\s)(\d+)\)\s*/);
  if (numbered.length > 2) {
    const results: string[] = [];
    for (let i = 1; i < numbered.length; i += 2) {
      const meaning = numbered[i + 1]?.trim();
      if (meaning) results.push(meaning);
    }
    if (results.length > 0) return results;
  }

  // Формат "1. ... 2. ..."
  const dotNumbered = text.split(/(?:^|\s)(\d+)\.\s*/);
  if (dotNumbered.length > 2) {
    const results: string[] = [];
    for (let i = 1; i < dotNumbered.length; i += 2) {
      const meaning = dotNumbered[i + 1]?.trim();
      if (meaning) results.push(meaning);
    }
    if (results.length > 0) return results;
  }

  return [text.trim()];
}

// -------------------------------------------------------------------------
// Стилевые метки (baisultanov)
// -------------------------------------------------------------------------

// -------------------------------------------------------------------------
// Доменные (тематические) пометы
// -------------------------------------------------------------------------

const DOMAIN_LABELS = [
  "грам.",
  "миф.",
  "анат.",
  "бот.",
  "зоол.",
  "мед.",
  "лингв.",
  "мат.",
  "карт.",
  "астр.",
  "тех.",
  "ист.",
  "полит.",
  "муз.",
  "хим.",
  "этн.",
  "биол.",
  "мор.",
  "фольк.",
  "рел.",
  "эк.",
  "вет.",
  "перен.",
  "уст.",
  "разг.",
  "шутл.",
  "дет.",
];

/**
 * Извлекает доменную помету из начала текста.
 * Формат: <i>грам.</i> текст → { domain: "грам.", remaining: "текст" }
 */
export function extractDomain(text: string): {
  domain: string | undefined;
  remaining: string;
} {
  const m = text.match(/^<i>\s*([а-яё]+\.)\s*<\/i>\s*/);
  if (m && DOMAIN_LABELS.includes(m[1])) {
    return { domain: m[1], remaining: text.substring(m[0].length) };
  }
  return { domain: undefined, remaining: text };
}

const STYLE_LABELS = [
  // Compound labels first (longer match takes priority)
  "Прост.-разг.",
  "Прост-разг.",
  "Прост.-ирон.",
  "Прост-ирон.",
  "Прост.-шутл.",
  "Прост-шутл.",
  "Прост.-груб.",
  "Прост-губ.",
  "Прост-груб.",
  "Шутл.-ирон.",
  "Шутл-ирон.",
  "Старин-диал.",
  "Старин.-диал.",
  "Религ-лит.",
  "Религ.-лит.",
  "Разг-прост.",
  "Разг.-прост.",
  "Презрит-ирон.",
  "Презрит.-ирон.",
  "Презр.-ирон.",
  // Single labels
  "Прост.",
  "Старинное.",
  "Старин.",
  "Устар.",
  "Уст.",
  "Разг.",
  "Религ.",
  "Диал.",
  "Ирон.",
  "Жарг.",
  "Поэт.",
  "Книжн.",
  "Бран.",
  "Презрит.",
  "Презр.",
  "Пренебр.",
  "Груб.",
];

/**
 * Извлекает стилевую метку (или цепочку меток) из начала текста.
 * Поддерживает несколько меток подряд через пробел: "Прост. Презр. Текст" → "Прост. Презр."
 */
export function extractStyleLabel(text: string): string | undefined {
  let result = "";
  let remaining = text;

  // Greedily consume all leading style labels
  let found = true;
  while (found) {
    found = false;
    const trimmed = remaining.trimStart();
    for (const label of STYLE_LABELS) {
      if (trimmed.startsWith(label)) {
        result += (result ? " " : "") + label;
        remaining = trimmed.substring(label.length);
        found = true;
        break;
      }
    }
  }

  return result || undefined;
}

// -------------------------------------------------------------------------
// Цитаты (baisultanov)
// -------------------------------------------------------------------------

/** Извлекает источник цитаты: "(А.Автор. Название произведения)" */
export function extractCitationSource(text: string): string | undefined {
  // Ищем последние скобки с инициалами и точками: (X.Фамилия. Название) или (Нохчийн фольклор. Название)
  const m = text.match(
    /\(([А-ЯЁA-Z][а-яёa-zА-ЯЁA-Z.\-]+\.\s*[^)]+)\)\s*\.?\s*$/,
  );
  return m ? m[1].trim() : undefined;
}
