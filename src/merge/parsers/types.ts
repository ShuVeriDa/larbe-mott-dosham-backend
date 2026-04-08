export interface ParsedEntry {
  word: string;
  wordAccented?: string;
  homonymIndex?: number; // индекс омонима (вон1, вон2 → 1, 2)
  variants?: string[]; // вариантные формы: "ошхьада", "аввабин-ламаз" и т.п.
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
  entryType?: "standard" | "neologism";
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
  verbFutureParticiple?: string; // причастие будущего времени (4-я форма у Мациева)
}

/** Полная парадигма спряжения глагола — результат ConjugationService */
export interface ConjugationParadigm {
  word: string;
  conjugationType: 1 | 2 | null; // I — окончание -у, II — окончание -а

  /** 3 базовые формы (если известны) */
  baseForms: {
    present: string | null; // настоящее (форма 1): лоху, хеза
    recentPast: string | null; // недавнопрошедшее (форма 2): лехи, хези
    perfect: string | null; // прош. совершенное (форма 3): лехна, хезна
  };

  /** 9 временных форм */
  tenses: {
    /** 1. Простое настоящее: лоху */
    presentSimple: string | null;
    /** 2. Сложное настоящее: лохуш ву/ю/ду/бу */
    presentCompound: string | null;
    /** 3. Недавнопрошедшее: лехи */
    recentPast: string | null;
    /** 4. Очевидно-прошедшее: лехира */
    evidentialPast: string | null;
    /** 5. Прошедшее совершенное: лехна */
    perfect: string | null;
    /** 6. Давнопрошедшее: лехнера */
    remotePast: string | null;
    /** 7. Прошедшее несовершенное: лохура */
    pastImperfective: string | null;
    /** 8. Будущее возможное: лохур */
    futurePossible: string | null;
    /** 9. Будущее фактическое: лохур ду */
    futureFactual: string | null;
  };

  /** Отглагольные формы */
  participles: {
    /** Причастие настоящего: доьшург */
    present: string | null;
    /** Причастие прошедшего: дешнарг */
    past: string | null;
    /** Деепричастие настоящего: доьшуш */
    gerundPresent: string | null;
    /** Деепричастие прошедшего: = прош. совершенное */
    gerundPast: string | null;
    /** Масдар (отглагольное сущ.): дешар */
    masdar: string | null;
  };

  /** Повелительное наклонение */
  imperative: {
    /** инфинитив + -л: дешал */
    basic: string | null;
    /** просьба ед.ч.: дешахьа */
    polite: string | null;
    /** просьба мн.ч.: дешийша */
    politePlural: string | null;
  };

  /** Отрицательные формы (ключевые) */
  negation: {
    /** ца + настоящее: ца лоху */
    present: string | null;
    /** ма + инфинитив: ма лаха */
    imperative: string | null;
  };
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
  label?: string; // структурированные маркеры-пометы: "м-л", "л.м.", "п.к."
  partOfSpeech?: string; // POS на уровне значения (когда слово многокатегориальное: 1. прил. 2. нареч.)
  partOfSpeechNah?: string;
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
