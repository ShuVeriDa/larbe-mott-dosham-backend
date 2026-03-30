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
  plural?: string;
  pluralClass?: string;
  // Для глаголов
  verbPresent?: string;
  verbPast?: string;
  verbParticiple?: string;
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
