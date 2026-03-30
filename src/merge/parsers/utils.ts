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
  return text.normalize("NFD").replace(/\u0301/g, "").normalize("NFC");
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

/** Извлекает пары <b>nah </b>ru из текста */
export function extractExamples(
  text: string,
): { nah: string; ru: string }[] {
  const results: { nah: string; ru: string }[] = [];
  const regex = /<b>([^<]+)<\/b>\s*([^<;◊]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const nah = cleanText(stripStressMarks(match[1]))
      .replace(/[\s.,]+$/, "")
      .replace(/\d+$/, "")
      .replace(/[\s.,]+$/, "")
      .trim();
    const ru = cleanText(stripStressMarks(match[2]))
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
    const nah = cleanText(stripStressMarks(match[1]));
    const ru = cleanText(stripStressMarks(match[2]));
    if (nah && ru) results.push({ nah, ru });
  }
  // Также формат: <b>nah</b> – ru (тире снаружи)
  const regex2 = /<b>([^<]+)<\/b>\s*[–\-]\s*([^<;]*)/g;
  while ((match = regex2.exec(text)) !== null) {
    const nah = cleanText(stripStressMarks(match[1]));
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
  const m = text.match(
    /<i>((?:прил|сущ|гл|нареч|числ|мест|союз|предлог|послелог|межд|частица|прич|дееприч|собир|звукоподр)[^<]*)<\/i>/,
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

const STYLE_LABELS = [
  "Прост.",
  "Старин.",
  "Устар.",
  "Уст.",
  "Разг.",
  "Религ.",
  "Диал.",
  "Ирон.",
  "Жарг.",
  "Поэт.",
  "Шутл.-ирон.",
  "Шутл-ирон.",
  "Книжн.",
  "Бран.",
  "Презр.",
  "Пренебр.",
  "Груб.",
];

export function extractStyleLabel(text: string): string | undefined {
  for (const label of STYLE_LABELS) {
    if (text.startsWith(label)) return label;
  }
  return undefined;
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
