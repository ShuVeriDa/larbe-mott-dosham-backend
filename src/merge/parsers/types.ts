export interface ParsedEntry {
  word: string;
  wordAccented?: string;
  partOfSpeech?: string;
  partOfSpeechNah?: string; // чеченское название: ц1ердош, хандош, ...
  nounClass?: string; // "ву", "йу", "ду", "бу"
  nounClassPlural?: string; // класс мн. числа если отличается
  grammar?: GrammarInfo;
  meanings: Meaning[];
  phraseology?: Phrase[];
  citations?: Citation[]; // литературные цитаты (baisultanov и т.п.)
  latinName?: string; // латинское название (анатомия)
  styleLabel?: string; // Прост., Устар., Старин., Разг. и т.п.
  domain?: string;
}

export interface GrammarInfo {
  genitive?: string;
  dative?: string;
  ergative?: string;
  instrumental?: string;
  substantive?: string; // вещественный (хоттаг1уьрг) -х
  locative?: string; // местный (меттиг1ниг) -е, -га
  comparative?: string; // сравнительный (дустаруьрг) -ал, -лла
  plural?: string;
  pluralClass?: string;
  // Падежи мн. числа (если отличаются от автогенерации)
  pluralGenitive?: string;
  pluralDative?: string;
  pluralErgative?: string;
  pluralInstrumental?: string;
  pluralSubstantive?: string;
  pluralLocative?: string;
  pluralComparative?: string;
  // Тип склонения (I-IV), определяется по творительному падежу
  declensionType?: 1 | 2 | 3 | 4;
  // Косвенная основа (для слов с чередованием: бол → белх-)
  obliqueStem?: string;
  // Для глаголов
  verbPresent?: string;
  verbPast?: string;
  verbParticiple?: string;
}

/** Полная парадигма склонения — результат DeclensionService */
export interface DeclensionParadigm {
  word: string;
  declensionType: 1 | 2 | 3 | 4 | null;
  singular: CaseSet;
  plural: CaseSet | null;
}

export interface CaseSet {
  nominative: string; // цІерниг
  genitive: string; // доланиг
  dative: string; // лург
  ergative: string; // дийриг
  instrumental: string; // коьчалниг
  substantive: string; // хотталург
  locative: string; // меттигниг
  comparative: string; // дустург
}

export interface Meaning {
  translation: string;
  note?: string; // деривационные/ссылочные пометы: "масд. от дала", "см. слово"
  examples?: Phrase[];
}

export interface Phrase {
  nah: string;
  ru: string;
}

export interface Citation {
  text: string; // текст цитаты на нохчийн
  source?: string; // "А.Сулейманов. Топонимия Чечни"
}

export interface RawDictEntry {
  id?: string;
  word: string;
  word1?: string;
  translate: string;
}
