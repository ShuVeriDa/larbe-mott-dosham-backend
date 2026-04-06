import type { GrammarInfo, Meaning, ParsedEntry, RawDictEntry } from "./types";
import {
  cleanText,
  dedup,
  expandClass,
  extractDomain,
  extractExamples,
  extractPartOfSpeech,
  posToNah,
  splitMeanings,
  stripHtml,
  stripStressMarks,
  tildeToAcute,
} from "./utils";

/**
 * Парсер для словаря Мациева (maciev.json).
 *
 * Форматы translate:
 * 1. Существительные: [gen, dat, erg, instr, <i>CLASS; мн.</i> plural, <i>CLASS</i>] перевод
 * 2. Глаголы:          [present, past, participle] перевод
 * 3. Прилагательные:   <i>прил.</i> перевод
 * 4. Примеры:          <b>нохчийн </b>русский
 * 5. Фразеология:      ◊ <b>нохчийн</b> русский
 */
export function parseMacievEntry(raw: RawDictEntry): ParsedEntry | null {
  let translate = raw.translate?.trim();
  if (!translate) return null;

  // Фикс BBCode-артефактов: word="-[" + translate="b]м ..." → word="-м", translate="..."
  // и word="..., [/" + translate="i]] ..." → word="...", translate="..."
  let rawWord = raw.word ?? "";
  let rawWord1 = raw.word1 ?? raw.word ?? "";

  if (rawWord.endsWith("-[") && translate.startsWith("b]")) {
    // -[b]м → -м  /  -[b]те → -те
    const restored = translate.match(/^b\](\S+)\s*(.*)/s);
    if (restored) {
      rawWord = rawWord.slice(0, -1) + restored[1]; // "-[" → "-" + "м"
      rawWord1 = rawWord;
      translate = restored[2];
    }
  } else if (rawWord.endsWith(", [/") && translate.startsWith("i]]")) {
    // "диссимиляцеш, [/" + "i]] диссимиляция" → "диссимиляцеш" + "диссимиляция"
    rawWord = rawWord.slice(0, -4).trim(); // убираем ", [/"
    rawWord1 = rawWord;
    translate = translate.slice(3).trim(); // убираем "i]]"
  }

  // Пропускаем сломанные записи где word — это часть translate предыдущей записи
  if (/^\d+\)\s/.test(rawWord) || /<b>/.test(rawWord)) return null;

  // Фикс: word1 заканчивается запятой ("цӀийIано,") + translate начинается с формы + POS:
  //   "цӀийIанорг прич. кровопролитный" → word = "цӀийIано, цӀийIанорг", translate = "прич. ..."
  if (rawWord1.trim().endsWith(",") && !translate.startsWith("<") && !translate.startsWith("[") && !translate.startsWith("*")) {
    const formPosMatch = translate.match(/^(\S+)\s+(прич|масд|нареч|прил|сущ|гл)\.\s*/);
    if (formPosMatch) {
      rawWord1 = rawWord1.trim() + " " + formPosMatch[1];
      rawWord = rawWord.trim().endsWith(",") ? rawWord1 : rawWord;
      // Убираем "форма POS. " из начала translate, оставляем только перевод с POS тегом
      const afterFormPos = translate.slice(formPosMatch[0].length).trim();
      translate = `<i>${formPosMatch[2]}.</i> ${afterFormPos}`;
    }
  }

  const [word, homonymIndex] = cleanWordWithIndex(rawWord1);
  if (!word || /^\d+$/.test(word)) return null;

  const [wordAccented] = cleanWordWithIndex(rawWord);

  // Очистка translate от артефактов вёрстки
  translate = translate
    .replace(/¬\s*/g, "") // мягкий перенос
    .replace(/^\]+/, "") // в��дущие "]" (остатки BBCode)
    .replace(/^[,;.\s]+/, ""); // ведущая пунктуация (артефакт разрыва записей)

  let remaining = translate;
  let grammar: GrammarInfo | undefined;
  let nounClass: string | undefined;

  // 1. Извлекаем грамматический блок [...]
  //    Часть записей в исходных данных не имеет открывающей скобки "[",
  //    но содержит закрывающую "]" после грамматических форм:
  //      "дешан, дашна, дашо, даше, д; мн. дешнаш, д] слово; ..."
  //      "* айдо, айдира, айдина] поднять; ..."
  const bracketMatch = remaining.match(/^\[([^\]]+)\]/);
  const missingOpenBracket =
    !bracketMatch && remaining.includes("]") && !remaining.startsWith("]")
      ? remaining.match(/^(\*?\s*[^[\]]{5,})\]/)
      : null;
  if (bracketMatch || missingOpenBracket) {
    const grammarBlock = bracketMatch ? bracketMatch[1] : missingOpenBracket![1];
    const fullMatch = bracketMatch ? bracketMatch[0] : missingOpenBracket![0];
    remaining = remaining.substring(fullMatch.length).trim();

    const parsed = parseGrammarBlock(grammarBlock);
    grammar = parsed.grammar;
    nounClass = parsed.nounClass;
  } else if (!remaining.startsWith("[") && !remaining.includes("]") && !/<[bi]>/.test(remaining.slice(0, 60))) {
    // Нет скобок и нет HTML — возможно grammar напрямую: "форма1, форма2, форма3 перевод"
    // Определяем boundary: берём слова до первого явно русского
    const words = remaining.split(/\s+/);
    let grammarEnd = 0;
    let hasGrammarWords = false;
    for (let i = 0; i < words.length && i < 6; i++) {
      const w = words[i].replace(/[,*]+$/, "");
      if (!w) continue;
      if (isRussianWord(w)) { grammarEnd = i; break; }
      // Слово должно быть чеченским (не пустым, не содержать точки — иначе это не grammar)
      if (/\./.test(w)) { grammarEnd = 0; break; }
      grammarEnd = i + 1;
      hasGrammarWords = true;
    }
    // Только если нашли 2+ форм перед русским словом — считаем это grammar
    if (hasGrammarWords && grammarEnd >= 2) {
      const grammarBlock = words.slice(0, grammarEnd).join(" ").replace(/[,\s]+$/, "");
      const afterGrammar = words.slice(grammarEnd).join(" ").trim();
      if (afterGrammar) {
        remaining = afterGrammar;
        const parsed = parseGrammarBlock(grammarBlock);
        grammar = parsed.grammar;
        nounClass = parsed.nounClass;
      }
    }
  } else if (remaining.startsWith("[")) {
    // "[форма1, форма2, форма3 перевод" — открывающая "[" есть, закрывающей "]" нет.
    // Находим границу: grammar = слова до первого явно русского слова
    const inner = remaining.slice(1); // убираем "["
    const words = inner.split(/\s+/);
    let grammarEnd = 0;
    for (let i = 0; i < words.length; i++) {
      const w = words[i].replace(/[,*]+$/, "");
      if (!w) continue;
      // Первое явно русское слово — конец grammar блока
      if (isRussianWord(w)) { grammarEnd = i; break; }
      grammarEnd = i + 1;
    }
    if (grammarEnd > 0) {
      const grammarBlock = words.slice(0, grammarEnd).join(" ").replace(/[,\s]+$/, "");
      const afterGrammar = words.slice(grammarEnd).join(" ").trim();
      if (afterGrammar) {
        remaining = afterGrammar;
        const parsed = parseGrammarBlock(grammarBlock);
        grammar = parsed.grammar;
        nounClass = parsed.nounClass;
      }
    }
  }

  // 2. Извлекаем часть речи (но не деривационные пометы вроде "прич. от", "масд. от")
  //    Паттерн "<i>прил. к </i><b>слово</b>" — это POS "прил." + деривационная ссылка,
  //    поэтому сохраняем "к " в remaining, чтобы parseMeanings обработал как ссылку.
  const posDerivMatch = remaining.match(
    /^<i>((?:прил|прич|сущ|нареч)\.\s+к)\s*<\/i>/,
  );
  let partOfSpeech: string | undefined;
  let posNote: string | undefined; // расширенное описание POS: "межд., выражающее досаду"
  if (posDerivMatch) {
    // POS + деривация: "прил. к" → POS = "прил.", оставляем <i>прил. к </i> для parseMeanings
    partOfSpeech = normalizePos(posDerivMatch[1].replace(/\s+к$/, ""));
  } else {
    partOfSpeech = extractPartOfSpeech(remaining);
    if (partOfSpeech) {
      // Извлекаем расширенное описание из POS тега: "<i>межд., выражающее ...;</i>" → "межд., выражающее ..."
      const posTagMatch = remaining.match(/<i>([^<]+)<\/i>/);
      if (posTagMatch) {
        const fullPosText = posTagMatch[1].replace(/[;.\s]+$/, "").trim();
        // Если текст длиннее чем просто POS-аббревиатура — сохраняем как note
        if (fullPosText.length > partOfSpeech.length + 2) {
          posNote = fullPosText;
        }
      }
      // Убираем POS тег из remaining
      remaining = remaining.replace(/<i>[^<]*<\/i>\s*/, "").trim();
    }
  }

  // 2.5. Извлекаем доменную помету (<i>грам.</i>, <i>миф.</i> и т.п.)
  const { domain, remaining: afterDomain } = extractDomain(remaining);
  remaining = afterDomain;

  // 2.7. Фиксируем и убираем маркер "*" — он означает что текст до ";" является основным переводом
  const hasStar = /^\*\s*/.test(remaining);
  if (hasStar) remaining = remaining.replace(/^\*\s*/, "");

  // 3. Разделяем основной текст и фразеологизмы (◊)
  let mainText = remaining;
  let phraseText = "";
  const phraseIdx = remaining.indexOf("◊");
  if (phraseIdx !== -1) {
    mainText = remaining.substring(0, phraseIdx).trim();
    phraseText = remaining.substring(phraseIdx + 1).trim();
  }

  // 4. Парсим значения
  const meanings = parseMeanings(mainText, posNote, hasStar);

  // 4.5. Если partOfSpeech не задан — определяем его по доступным данным
  let resolvedPos = normalizePos(partOfSpeech);
  if (!resolvedPos) {
    // a) Из деривационной пометы в note: "прич. от X", "масд. от X", "прил. к X" и т.п.
    if (meanings.length > 0 && meanings[0].note) {
      const posFromNote = meanings[0].note.match(/^(прич|масд|прил|нареч|сущ|гл|числ|дееприч)\./);
      if (posFromNote) resolvedPos = normalizePos(posFromNote[0]);
    }
    // b) По грамматике: verb forms → гл., nounClass/падежи → сущ.
    if (!resolvedPos && grammar) {
      if (grammar.verbPresent || grammar.verbPast || grammar.verbParticiple) {
        resolvedPos = "гл.";
      } else if (nounClass || grammar.genitive || grammar.plural) {
        resolvedPos = "сущ.";
      }
    }
    // c) По суффиксу второй формы слова (word1): -ниг/-иниг → прил., -нарг/-ларг/-арг/-ург/-рг → прич.
    if (!resolvedPos) {
      const word2 = word.includes(",") ? word.split(",")[1]?.trim() : undefined;
      if (word2) {
        const w2 = stripStressMarks(word2).toLowerCase();
        if (/(?:иниг|ниг)$/.test(w2)) {
          resolvedPos = "прил.";
        } else if (/(?:нарг|ларг|варг|йарг|арг|ург|ийрг)$/.test(w2)) {
          resolvedPos = "прич.";
        }
      }
    }
    // d) По суффиксу основного слова: единственное слово на -ар/-яр (без дефиса) → масд.
    //    только если translation не начинается с глагольного инфинитива
    if (!resolvedPos && meanings.length > 0) {
      const mainTrans = meanings[0].translation.trim();
      const w0 = stripStressMarks(word.split(",")[0]).toLowerCase().trim();
      // Исключаем составные слова с дефисом (аьчк-пхьар, мангал-комар)
      if (/(?:яр|ар)$/.test(w0) && !word.includes(",") && !w0.includes("-") && mainTrans && !/(?:ть|чь|сти|сть)(ся)?$/.test(mainTrans.split(/\s+/)[0])) {
        resolvedPos = "масд.";
      }
    }
    // e) По переводу: начинается с русского инфинитива → гл.
    if (!resolvedPos && meanings.length > 0) {
      const firstWord = meanings[0].translation.trim().split(/\s+/)[0];
      if (firstWord && /(?:ть|чь|сти|сть)(ся)?$/.test(firstWord.toLowerCase())) {
        resolvedPos = "гл.";
      }
    }
    // f) По переводу: начинается с русского прилагательного → прил.
    if (!resolvedPos && meanings.length > 0) {
      const firstWord = meanings[0].translation.trim().split(/\s+/)[0];
      if (firstWord && /(?:ный|ная|ное|ные|ной|ской|ская|ское|ские|вый|вая|тый|тая|нный|нная|щий|щая|шая|ший)$/.test(firstWord.toLowerCase()) && firstWord.length > 4) {
        resolvedPos = "прил.";
      }
    }
  }

  // 5. Парсим фразеологизмы
  const phraseology = phraseText ? extractExamples(phraseText) : undefined;

  // Разбиваем "абазойн, абазойниг" → word="абазойн", variants=["абазойниг"]
  const wordParts = stripStressMarks(stripHtml(word))
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const baseWord = wordParts[0];
  const variants = wordParts.length > 1 ? wordParts.slice(1) : undefined;

  return {
    word: baseWord,
    wordAccented:
      word !== wordAccented ? tildeToAcute(stripHtml(wordAccented)) : undefined,
    homonymIndex,
    partOfSpeech: resolvedPos,
    partOfSpeechNah: posToNah(resolvedPos),
    nounClass,
    domain: domain || undefined,
    grammar: grammar && Object.keys(grammar).length > 0 ? grammar : undefined,
    meanings,
    phraseology: phraseology?.length ? phraseology : undefined,
    variants,
  };
}

/** Очищает word, сохраняя цифру-омоним. Возвращает [word, homonymIndex | undefined] */
function cleanWordWithIndex(word: string): [string, number | undefined] {
  let cleaned = cleanText(word)
    .replace(/l/g, "Ӏ") // латинская l → чеченская палочка Ӏ
    .replace(/¬\s*/g, "") // мягкий перенос (¬) — артефакт вёрстки
    .replace(/–/g, "-") // en-dash → обычный дефис
    .replace(/,(?=\S)/g, ", ") // пробел после запятой
    .trim();

  // Убираем trailing пунктуацию (артефакты OCR): "акхаралла зверство," → "акхаралла зверство"
  cleaned = cleaned.replace(/[,;:!?*]+$/, "").trim();

  // Извлекаем цифру-омоним из конца первого слова: "вон2, вониг" → index=2, word="вон, вониг"
  const indexMatch = cleaned.match(/^([^,]+?)(\d+)(,.*)?$/);
  let homonymIndex: number | undefined;
  if (indexMatch) {
    homonymIndex = parseInt(indexMatch[2], 10);
    cleaned = indexMatch[1] + (indexMatch[3] ?? "");
  }

  return [cleaned.trim(), homonymIndex];
}

/**
 * Парсит грамматический блок из [...].
 *
 * Существительные (4-6 форм + класс):
 *   С HTML:  а̃ганан, а̃ганна, а̃гано̃, а̃гане̃, <i>д; мн.</i> а̃ганаш, <i>д</i>
 *   Без HTML: дешан, дашна, дашо, даше, д; мн. дешнаш, д
 *
 * Глаголы (3 формы, без класса):
 *   о̃гу, э̃гира, аьгна
 */
function parseGrammarBlock(block: string): {
  grammar: GrammarInfo;
  nounClass?: string;
} {
  const grammar: GrammarInfo = {};
  let nounClass: string | undefined;

  const hasHtml = /<i>/.test(block);

  // Извлекаем класс: "<i>д; мн.</i>" или просто ", д; мн." / ", д" в конце
  if (hasHtml) {
    const classMatches = block.match(/<i>([бвдй])(?:[;,]|\s|<)/g);
    if (classMatches && classMatches.length > 0) {
      const firstClass = classMatches[0].match(/<i>([бвдй])/);
      if (firstClass) {
        nounClass = expandClass(firstClass[1]);
      }
    }

    // Извлекаем множественное число: мн.</i> XXXX
    const pluralMatch = block.match(/мн\.<\/i>\s*([^,<]+)/);
    if (pluralMatch) {
      grammar.plural = cleanText(tildeToAcute(pluralMatch[1]));
    }

    // Класс мн. числа — последний <i>CLASS</i>
    if (classMatches && classMatches.length > 1) {
      const lastClass =
        classMatches[classMatches.length - 1].match(/<i>([бвдй])/);
      if (lastClass) {
        grammar.pluralClass = expandClass(lastClass[1]);
      }
    }
  } else {
    // Без HTML тегов: "дешан, дашна, дашо, даше, д; мн. дешнаш, д"
    //                  "абзацан, абзацана, абзацо, абзаце, й; мн. абзацаш, й"
    //                  "авсалан, авсална, авсало, авсале, д; мн. авсалш, д"
    // Класс — одиночная буква [бвдй] после запятой (перед ; или в конце)
    const classMatch = block.match(/,\s*([бвдй])\s*(?:;|,|$)/);
    if (classMatch) {
      nounClass = expandClass(classMatch[1]);
    }

    // Множественное число: "мн. XXXX" (до запятой или конца)
    const pluralMatch = block.match(/мн\.\s*([^,;]+)/);
    if (pluralMatch) {
      grammar.plural = cleanText(tildeToAcute(pluralMatch[1].trim()));
    }

    // Класс мн. числа — одиночная буква [бвдй] после мн. формы, в самом конце
    const pluralClassMatch = block.match(/мн\.\s*[^,;]+,\s*([бвдй])\s*$/);
    if (pluralClassMatch) {
      grammar.pluralClass = expandClass(pluralClassMatch[1]);
    }
  }

  // Чистим блок от HTML тегов для извлечения форм
  const plain = stripHtml(block)
    .replace(/[бвдй](?:;|\s|$)/g, "") // убираем одиночные буквы классов
    .replace(/мн\.\s*/g, "")
    .trim();

  const forms = plain
    .split(/[,;]/)
    .map((f) =>
      f
        .trim()
        .replace(/^\*\s*/, "") // убираем маркер "*" (непереходность)
        .replace(/\s+[бвдй]у$/, "") // убираем классные показатели ду/бу/ву/йу
        .trim(),
    )
    .filter((f) => f.length > 0);

  if (nounClass || grammar.plural) {
    // Существительное: genitive, dative, ergative, instrumental
    if (forms.length >= 1) grammar.genitive = tildeToAcute(forms[0]);
    if (forms.length >= 2) grammar.dative = tildeToAcute(forms[1]);
    if (forms.length >= 3) grammar.ergative = tildeToAcute(forms[2]);
    if (forms.length >= 4) grammar.instrumental = tildeToAcute(forms[3]);
  } else if (forms.length >= 2) {
    // Глагол: словарная запись даёт 3 формы: настоящее, очевидно-прошедшее,
    // прошедшее совершенное (+ иногда причастие будущего)
    // Отделяем грамм. пометы ("наст. вр. нет") от реальных форм
    const hasNoPresentNote = forms.some((f) => /наст/.test(f));
    const verbForms = forms.filter((f) => !/\./.test(f));

    if (hasNoPresentNote) {
      // Настоящего времени нет — формы начинаются с прошедшего
      if (verbForms.length >= 1) grammar.verbPast = tildeToAcute(verbForms[0]);
      if (verbForms.length >= 2)
        grammar.verbParticiple = tildeToAcute(verbForms[1]);
    } else {
      if (verbForms.length >= 1)
        grammar.verbPresent = tildeToAcute(verbForms[0]);
      if (verbForms.length >= 2) grammar.verbPast = tildeToAcute(verbForms[1]);
      if (verbForms.length >= 3)
        grammar.verbParticiple = tildeToAcute(verbForms[2]);
      if (verbForms.length >= 4)
        grammar.verbFutureParticiple = tildeToAcute(verbForms[3]);
    }
  }

  return { grammar, nounClass };
}

function parseMeanings(text: string, posNote?: string, hasStar?: boolean): Meaning[] {
  const stripped = cleanText(text);

  // Деривационные/ссылочные пометы (<i>масд. от </i>, <i>прил. к </i>, <i>см.</i> и т.п.)
  // обрабатываем до splitMeanings, чтобы нумерованные подзначения не разбились
  const derivMatch = stripped.match(
    /^<i>([^<]*(?:\s+от|\s+к|см\.))\s*<\/i>\s*/,
  );
  if (derivMatch) {
    const derivNote = derivMatch[1].trim();
    const afterNote = stripped.substring(derivMatch[0].length);
    const { note, remaining } = extractSourceWord(derivNote, afterNote);

    if (remaining) {
      const meanings = parseNormalMeanings(remaining, hasStar);
      for (const m of meanings) m.note = note;
      return meanings;
    }
    return [{ translation: "", note }];
  }

  const meanings = parseNormalMeanings(stripped, hasStar);
  if (posNote) {
    for (const m of meanings) m.note = m.note || posNote;
  }
  return meanings;
}

/**
 * Извлекает слово-источник из <b>слово</b> после деривационной пометы.
 * Возвращает note (помета + слово) и оставшийся текст (перевод).
 */
function extractSourceWord(
  derivNote: string,
  text: string,
): { note: string; remaining: string } {
  // Склеиваем <b>X</b>-<b>Y</b> → <b>X-Y</b> (слова через дефис)
  text = text.replace(/<\/b>-<b>/g, "-");
  const sourceMatch = text.match(/^<b>([^<]+)<\/b>\s*/);
  if (!sourceMatch) return { note: derivNote, remaining: text };

  const sourceWord = cleanText(tildeToAcute(sourceMatch[1]))
    .replace(/[\s.,;]+$/, "")
    .replace(/\d+$/, "")
    .replace(/[\s.,;]+$/, "")
    .trim();
  let remaining = text.substring(sourceMatch[0].length).trim();

  // Убираем остаточные "2.", "1,2." — номера омонимов после </b>
  remaining = remaining.replace(/^[\d,.\s]+/, "").trim();

  const note = sourceWord ? `${derivNote} ${sourceWord}` : derivNote;
  return { note, remaining };
}

/**
 * Извлекает пословицы/поговорки — блоки вида:
 *   <b>нах1 </b>– <b>нах2 </b><i>погов.</i> русский перевод;
 *   <b>нах1 </b>текст <b>нах2 </b><i>посл.</i> русский перевод;
 * Возвращает найденные примеры и текст без пословиц.
 */
function extractProverbs(text: string): {
  examples: { nah: string; ru: string }[];
  cleaned: string;
} {
  const examples: { nah: string; ru: string }[] = [];

  // Чеченские блоки (bold + возможный текст между ними) + <i>погов./посл.</i> + русский текст
  // Русский текст может содержать <i>...</i> теги (напр. <i>замуж</i>, <i>букв.</i>)
  const cleaned = text.replace(
    /((?:<b>[^<]+<\/b>[^<;]*)+)<i>\s*(?:погов|посл)\.\s*<\/i>\s*((?:[^<;]|<i>[^<]*<\/i>)*)/g,
    (_match, boldBlock: string, ruRaw: string) => {
      const nah = cleanText(tildeToAcute(stripHtml(boldBlock)))
        .replace(/[\s.,]+$/, "")
        .trim();

      const ru = stripStressMarks(
        stripHtml(ruRaw)
          .replace(/[.,;]+$/, "")
          .trim(),
      );

      if (nah && ru) {
        examples.push({ nah, ru });
      }

      return ""; // Убираем блок пословицы из текста
    },
  );

  return { examples, cleaned };
}

/** Парсит обычные (не-деривационные) значения */
function parseNormalMeanings(stripped: string, hasStar?: boolean): Meaning[] {
  const meaningTexts = splitMeanings(stripped);

  return meaningTexts.map((mt) => {
    // Склеиваем <b>X</b>-<b>Y</b> → <b>X-Y</b> (слова через дефис, напр. байтамал-яӀ)
    let text = mt.replace(/<\/b>-<b>/g, "-");

    // POS на уровне значения (напр. "1. <i>прил.</i> дикий 2. <i>нареч.</i> дико")
    const meaningPos = extractPartOfSpeech(text);
    if (meaningPos) {
      text = text.replace(/<i>[^<]*<\/i>\s*/, "").trim();
    }

    // Доменная помета внутри значения (<i>рел.</i>, <i>перен.</i> и т.п.)
    const { domain: meaningDomain, remaining: afterMeaningDomain } =
      extractDomain(text);
    if (meaningDomain) text = afterMeaningDomain;

    // Деривационная помета внутри нумерованного значения (напр. "1) <i>потенц. от </i>...")
    const innerDerivMatch = text.match(
      /^<i>([^<]*(?:\s+от|\s+к|см\.))\s*<\/i>\s*/,
    );
    if (innerDerivMatch) {
      const derivNote = innerDerivMatch[1].trim();
      const afterNote = text.substring(innerDerivMatch[0].length);
      const { note, remaining } = extractSourceWord(derivNote, afterNote);

      if (remaining) {
        const translation = stripStressMarks(
          stripHtml(remaining)
            .replace(/[;.]+$/, "")
            .trim(),
        );
        return {
          translation,
          note,
          partOfSpeech: meaningPos || undefined,
          partOfSpeechNah: posToNah(meaningPos) || undefined,
        };
      }
      return {
        translation: "",
        note,
        partOfSpeech: meaningPos || undefined,
        partOfSpeechNah: posToNah(meaningPos) || undefined,
      };
    }

    // Извлекаем пословицы (погов.) до обычных примеров
    const { examples: proverbExamples, cleaned: withoutProverbs } =
      extractProverbs(text);

    const boldExamples = extractExamples(withoutProverbs);
    let allExamples = [...boldExamples, ...proverbExamples];

    // Перевод — текст без примеров (<b>...</b>...) и пословиц
    let translation: string;
    if (boldExamples.length > 0 || /<b>/.test(withoutProverbs)) {
      // Есть <b> разметка — стандартный путь
      translation = withoutProverbs
        .replace(
          /<b>[^<]*<\/b>(?:[^<;◊]|<i>[^<]*<\/i>|;\s*(?=[а-е]\)))*/g,
          "",
        )
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .replace(/(?:\s*;\s*){2,}/g, "; ")
        .replace(/[;.\s]+$/, "")
        .trim();
    } else {
      // Нет <b> разметки — извлекаем примеры из plain-text по ";"
      const { translation: plainTranslation, examples: plainExamples } =
        extractPlainExamples(stripHtml(withoutProverbs), hasStar);
      translation = plainTranslation;
      allExamples = [...plainExamples, ...proverbExamples];
    }
    translation = stripStressMarks(translation);

    // Убираем остаточную пунктуацию/артефакты: ",", ".", "]"
    translation = translation
      .replace(/^[\[\]]+/, "")
      .replace(/^[,.\s]+/, "")
      .trim();

    return {
      translation:
        translation ||
        (allExamples.length > 0 ? "" : stripHtml(stripStressMarks(text))),
      partOfSpeech: meaningPos || undefined,
      partOfSpeechNah: posToNah(meaningPos) || undefined,
      examples: allExamples.length > 0 ? allExamples : undefined,
    };
  });
}

function normalizePos(pos: string | undefined): string | undefined {
  if (!pos) return undefined;
  const base = pos
    .replace(/\s+\./g, ".") // "нареч ." → "нареч."
    .replace(/\s+к$/, "")
    .replace(/\s+от$/, "")
    .replace(/\s+см\..*$/, "")
    .trim();

  const map: Record<string, string> = {
    "прил.": "прил.",
    "прич.": "прич.",
    "гл.": "гл.",
    "сущ.": "сущ.",
    "нареч.": "нареч.",
    "числ.": "числ.",
    "мест.": "мест.",
    союз: "союз",
    предлог: "предлог",
    послелог: "послелог",
    "межд.": "межд.",
    частица: "частица",
    "дееприч.": "дееприч.",
    "собир.": "собир.",
    "звукоподр.": "звукоподр.",
  };

  for (const [key, val] of Object.entries(map)) {
    if (base.startsWith(key)) return val;
  }

  // Если POS не в маппинге и слишком длинный — это не POS, а определение
  if (base.length > 15) return undefined;

  return pos.trim();
}

// -----------------------------------------------------------------------
// Plain-text examples (записи без <b> разметки)
// -----------------------------------------------------------------------

/** Чеченское слово: содержит палочку Ӏ, диграфы аь/оь/уь/юь/еь, хь, къ, кх */
function isChechenWord(word: string): boolean {
  const w = word.toLowerCase().replace(/[.,!?();:]+/g, "");
  if (!w) return false;
  if (/^[а-е]\)$/.test(word.trim())) return false; // а), б) — подзначения
  if (/ӏ/i.test(word)) return true;
  if (/[аоуюе]ь/.test(w)) return true;
  if (/къ|кх|хь/.test(w)) return true;
  return false;
}

const RU_SMALL = new Set([
  "в",
  "на",
  "из",
  "за",
  "по",
  "у",
  "с",
  "к",
  "от",
  "до",
  "не",
  "ни",
  "и",
  "а",
  "но",
  "об",
  "при",
  "без",
  "под",
  "над",
  "для",
  "про",
  "что",
  "как",
  "его",
  "еѐ",
  "их",
  "это",
  "все",
  "о",
]);

/** Русское слово: предлоги, инфинитивы (-ть), прилагательные, ь в не-чеченской позиции */
function isRussianWord(word: string): boolean {
  // Убираем ударение (\u0301) перед проверкой — оно мешает regex-матчингу
  const w = word
    .toLowerCase()
    .replace(/[.,!?();:]+/g, "")
    .replace(/\u0301/g, "");
  if (!w || w.length < 2) return false;
  if (/^[а-е]\)$/.test(word.trim())) return true;
  if (RU_SMALL.has(w)) return true;
  // Инфинитивы: -ть, -ться, -чь, -чься, -сти, -сть
  if (/(?:ть|чь)(ся)?$/.test(w)) return true;
  if (/(?:сти|сть)$/.test(w) && w.length > 4) return true;
  // Прилагательные/причастия (включая -ский, -щий, -ый, -ий, -ой, -ое)
  if (
    /(?:ный|ная|ное|ные|ной|ном|ский|ская|ское|ские|ском|ским|вый|вая|вое|вые|тый|тая|тое|тые|нный|нная|нное|нные|ший|шая|шее|шие|щий|щая|щее|щие|еский|ый|ий|ой|ое|ую|ей)$/.test(
      w,
    ) &&
    w.length > 4
  )
    return true;
  // Прошедшее время (длинные слова)
  if (/[аоиыу]л(?:ся|ась|ось|ись)?$/.test(w) && w.length > 5) return true;
  // Абстрактные существительные
  if (/(?:ство|ствие|ение|ание|ние|ция|ник)$/.test(w) && w.length > 4)
    return true;
  // ь в не-чеченской позиции (чеченский: только аь/оь/уь/юь/еь)
  if (/[^аоуюе]ь/.test(w) && w.length > 2) return true;
  // -ия, -ие (русские абстрактные)
  if (/(?:ия|ие)$/.test(w) && w.length > 4) return true;
  // -ец (деятель)
  if (/ец$/.test(w) && w.length > 3) return true;
  // 3-е лицо глаголов: -ет, -ёт, -ит, -ут, -ют, -ат, -ят, -ются, -ется, -ятся
  if (/(?:ет|ёт|ит|ут|ют|ат|ят)(?:ся)?$/.test(w) && w.length > 4)
    return true;
  // Множественное число: -ова, -ева, -ы (после характерных суффиксов)
  if (/(?:слов[аоуе]|книг[аоуе])/.test(w)) return true;
  // перен., букв., уст., погов., прил., нареч. и т.п. — словарные пометы и части речи
  if (
    /^(?:перен|букв|уст|разг|прост|книжн|обл|устар|собир|вводн|погов|посл|прил|нареч|гл|сущ|прич|числ|мест|межд|союз|дееприч|звукоподр)\.?$/.test(
      w,
    )
  )
    return true;
  return false;
}

/**
 * Разбивает одну «;»-отделённую часть на чеченский пример + русский перевод.
 * Возвращает null, если не удаётся определить границу.
 */
function splitNahRu(
  segment: string,
): { nah: string; ru: string } | null {
  const words = segment.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (isChechenWord(words[i])) continue;
    if (isRussianWord(words[i])) {
      if (i === 0) return null; // сегмент начинается с русского — не пример
      // Убираем подзначения (а), б)) из конца nah-части
      let nahEnd = i;
      while (nahEnd > 0 && /^[а-е]\)$/.test(words[nahEnd - 1])) nahEnd--;
      if (nahEnd === 0) return null;

      const nahWords = words.slice(0, nahEnd);
      // Если первое слово nah-части является русским — весь сегмент является переводом
      if (isRussianWord(nahWords[0])) return null;
      // Если ни одно слово nah-части не имеет явных чеченских маркеров
      // (Ӏ, аь/оь/уь/юь/еь, кх/хь/къ) — скорее всего весь сегмент русский текст
      if (!nahWords.some((w) => isChechenWord(w))) return null;

      const nah = nahWords
        .join(" ")
        .replace(/[.,;]+$/, "")
        .trim();
      // Подзначения + русский текст → объединяем в ru, убираем ведущее "а)"
      const ru = words
        .slice(nahEnd)
        .join(" ")
        .replace(/^[а-е]\)\s*/, "")
        .replace(/[.,;]+$/, "")
        .trim();
      if (nah) return { nah, ru };
      return null;
    }
  }
  return null;
}

/**
 * Извлекает примеры из plain-text (без <b> тегов), разделённого «;».
 * Первый сегмент — основной перевод, остальные — потенциальные примеры.
 */
function extractPlainExamples(
  text: string,
  hasStar?: boolean,
): {
  translation: string;
  examples: { nah: string; ru: string }[];
} {
  // Если запись помечена "*" — текст до первого ";" является основным переводом
  let starTranslation: string | undefined;
  let processText = text;
  if (hasStar) {
    const firstSemi = processText.indexOf(";");
    if (firstSemi !== -1) {
      starTranslation = processText.substring(0, firstSemi).trim();
      processText = processText.substring(firstSemi + 1).trim();
    } else {
      return {
        translation: processText.replace(/[;.\s]+$/, "").trim(),
        examples: [],
      };
    }
  }

  const parts = processText.split(";").map((s) => s.trim()).filter(Boolean);
  if (starTranslation === undefined && parts.length < 2) {
    return { translation: text.replace(/[;.\s]+$/, "").trim(), examples: [] };
  }

  const examples: { nah: string; ru: string }[] = [];
  const translationParts: string[] =
    starTranslation !== undefined ? [starTranslation] : [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    // Подзначения (б), в) — это продолжение предыдущего примера
    if (i > 0 && /^[бвгде]\)\s/.test(part)) {
      // Attach to previous example's ru or as separate example
      const subMatch = part.match(/^[бвгде]\)\s*(.*)/);
      if (subMatch && examples.length > 0) {
        const prevEx = examples[examples.length - 1];
        prevEx.ru += "; " + subMatch[1].replace(/[.,;]+$/, "").trim();
      }
      continue;
    }

    const split = splitNahRu(part);
    if (split) {
      examples.push(split);
    } else {
      translationParts.push(part);
    }
  }

  const translation = translationParts
    .join("; ")
    .replace(/[;.\s]+$/, "")
    .trim();

  return { translation, examples };
}

/** Batch: дедуплицирует и парсит все записи maciev */
export function parseMacievEntries(raws: RawDictEntry[]): ParsedEntry[] {
  const unique = dedup(raws);
  const result: ParsedEntry[] = [];
  for (const raw of unique) {
    const parsed = parseMacievEntry(raw);
    if (parsed) result.push(parsed);
  }
  return fixHomonymIndices(result);
}

/**
 * Постобработка: назначает homonymIndex записям у которых нет индекса,
 * но есть другие записи с тем же словом (часть из них уже имеют индексы).
 *
 * Два сценария:
 * A) [1, 2, 3, null] → null получает следующий индекс (4)
 * B) [null, null, ...] → все получают индексы 1, 2, 3, ...
 *    но только если записи реально различаются (разные meanings/grammar)
 */
function fixHomonymIndices(entries: ParsedEntry[]): ParsedEntry[] {
  // Группируем по слову
  const byWord = new Map<string, ParsedEntry[]>();
  for (const e of entries) {
    const group = byWord.get(e.word) ?? [];
    group.push(e);
    byWord.set(e.word, group);
  }

  for (const group of byWord.values()) {
    if (group.length < 2) continue;

    const nullEntries = group.filter((e) => e.homonymIndex == null);
    if (nullEntries.length === 0) continue;

    const maxExisting = group.reduce(
      (max, e) => Math.max(max, e.homonymIndex ?? 0),
      0,
    );

    if (maxExisting > 0) {
      // Сценарий A: уже есть индексированные — добавляем null-записи с продолжением
      let next = maxExisting + 1;
      for (const e of nullEntries) {
        e.homonymIndex = next++;
      }
    } else {
      // Сценарий B: ни у кого нет индекса — проверяем что записи реально различаются
      // (одинаковые meanings могут быть дублями dedup-а, не трогаем)
      const uniqueMeanings = new Set(
        group.map((e) => e.meanings.map((m) => m.translation).join("|")),
      );
      if (uniqueMeanings.size > 1) {
        let idx = 1;
        for (const e of group) {
          e.homonymIndex = idx++;
        }
      }
    }
  }

  return entries;
}
