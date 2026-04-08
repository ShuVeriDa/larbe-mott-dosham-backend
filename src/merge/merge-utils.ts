import type {
  Citation,
  GrammarInfo,
  Meaning,
  ParsedEntry,
  Phrase,
} from "./parsers";

// ---------------------------------------------------------------------------
// Логика слияния двух записей одного слова
// ---------------------------------------------------------------------------

export function mergeInto(target: ParsedEntry, source: ParsedEntry): void {
  if (!target.wordAccented && source.wordAccented)
    target.wordAccented = source.wordAccented;
  if (!target.partOfSpeech && source.partOfSpeech)
    target.partOfSpeech = source.partOfSpeech;
  if (!target.partOfSpeechNah && source.partOfSpeechNah)
    target.partOfSpeechNah = source.partOfSpeechNah;
  if (!target.nounClass && source.nounClass)
    target.nounClass = source.nounClass;
  if (!target.nounClassPlural && source.nounClassPlural)
    target.nounClassPlural = source.nounClassPlural;

  if (source.grammar) {
    if (!target.grammar) {
      target.grammar = source.grammar;
    } else {
      mergeGrammar(target.grammar, source.grammar);
    }
  }

  mergeMeanings(target.meanings, source.meanings);

  if (source.phraseology?.length) {
    if (!target.phraseology) {
      target.phraseology = [...source.phraseology];
    } else {
      mergePhrases(target.phraseology, source.phraseology);
    }
  }
  if (source.citations?.length) {
    if (!target.citations) {
      target.citations = [...source.citations];
    } else {
      mergeCitations(target.citations, source.citations);
    }
  }
  if (!target.latinName && source.latinName)
    target.latinName = source.latinName;
  if (!target.styleLabel && source.styleLabel)
    target.styleLabel = source.styleLabel;
  if (!target.domain && source.domain) target.domain = source.domain;
  if (!target.entryType && source.entryType)
    target.entryType = source.entryType;
}

function mergeGrammar(target: GrammarInfo, source: GrammarInfo): void {
  for (const key of Object.keys(source) as (keyof GrammarInfo)[]) {
    if (!target[key] && source[key]) {
      (target as any)[key] = source[key];
    }
  }
}

function mergeMeanings(target: Meaning[], source: Meaning[]): void {
  const existing = new Set(
    target.map((m) => m.translation.toLowerCase().trim()),
  );
  for (const sm of source) {
    const key = sm.translation.toLowerCase().trim();
    if (!key) continue;
    if (existing.has(key)) {
      const match = target.find(
        (m) => m.translation.toLowerCase().trim() === key,
      );
      if (match && sm.examples?.length) {
        if (!match.examples) {
          match.examples = [...sm.examples];
        } else {
          mergePhrases(match.examples, sm.examples);
        }
      }
    } else {
      target.push(sm);
      existing.add(key);
    }
  }
}

function mergePhrases(target: Phrase[], source: Phrase[]): void {
  const existing = new Set(target.map((p) => p.nah.toLowerCase()));
  for (const sp of source) {
    if (!existing.has(sp.nah.toLowerCase())) {
      target.push(sp);
      existing.add(sp.nah.toLowerCase());
    }
  }
}

function mergeCitations(target: Citation[], source: Citation[]): void {
  const existing = new Set(
    target.map((c) => c.text.toLowerCase().substring(0, 50)),
  );
  for (const sc of source) {
    const key = sc.text.toLowerCase().substring(0, 50);
    if (!existing.has(key)) {
      target.push(sc);
      existing.add(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Нормализация стилевых помет
// ---------------------------------------------------------------------------

const STYLE_LABEL_MAP: Record<string, string> = {
  прост: "Прост.",
  разг: "Разг.",
  уст: "Устар.",
  устар: "Устар.",
  ирон: "Ирон.",
  старинное: "Старин.",
  старин: "Старин.",
  стар: "Старин.",
  архаич: "Устар.",
  диал: "Диал.",
  религ: "Религ.",
  поэт: "Поэт.",
  груб: "Груб.",
  презр: "Презр.",
  презрит: "Презр.",
  пренебр: "Пренебр.",
  шутл: "Шутл.",
  жарг: "Жарг.",
  неол: "Неол.",
  калька: "Калька",
  губ: "Груб.",
  лит: "Лит.",
  обл: "Обл.",
};

export function normalizeStyleLabel(label: string): string {
  const parts = label.split(/[\s.\-]+/).filter(Boolean);
  const normalized = parts.map((p) => {
    const lower = p.toLowerCase();
    return (
      STYLE_LABEL_MAP[lower] ?? p.charAt(0).toUpperCase() + p.slice(1) + "."
    );
  });
  return [...new Set(normalized)].join(" ");
}

// ---------------------------------------------------------------------------
// Оценка уровня CEFR (A1–C2)
// ---------------------------------------------------------------------------

const SPECIALIZED_DOMAINS: Record<string, "B2" | "C1"> = {
  sport: "B2",
  computer: "B2",
  law: "C1",
  math: "C1",
  anatomy: "C1",
  geology: "C1",
};

const STYLE_CEFR: Record<string, string> = {
  "Прост.": "A2",
  "Разг.": "A2",
  "Книжн.": "B2",
  "Религ.": "B2",
  "Диал.": "B2",
  "Ирон.": "B2",
  "Жарг.": "B1",
  "Шутл.-ирон.": "B2",
  "Шутл-ирон.": "B2",
  "Бран.": "B1",
  "Груб.": "B1",
  "Презр.": "B2",
  "Пренебр.": "B2",
  "Устар.": "C1",
  "Уст.": "C1",
  "Старин.": "C2",
  "Поэт.": "C2",
};

const COMPLEX_POS = new Set(["прич.", "дееприч.", "масд."]);
const CEFR_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

function cefrMax(a: string, b: string): string {
  const ia = CEFR_ORDER.indexOf(a as (typeof CEFR_ORDER)[number]);
  const ib = CEFR_ORDER.indexOf(b as (typeof CEFR_ORDER)[number]);
  return ia >= ib ? a : b;
}

export function estimateCefr(
  entry: ParsedEntry & { sources: string[] },
): string {
  if (entry.entryType === "neologism") return "C1";

  const srcCount = entry.sources.length;

  let level: string;
  if (srcCount >= 6) level = "A1";
  else if (srcCount >= 4) level = "A2";
  else if (srcCount >= 2) level = "B1";
  else level = "B2";

  if (entry.domain && entry.domain in SPECIALIZED_DOMAINS)
    level = cefrMax(level, SPECIALIZED_DOMAINS[entry.domain]);
  if (entry.styleLabel && entry.styleLabel in STYLE_CEFR)
    level = cefrMax(level, STYLE_CEFR[entry.styleLabel]);
  if (entry.partOfSpeech && COMPLEX_POS.has(entry.partOfSpeech))
    level = cefrMax(level, "B1");

  return level;
}
