// Используем Map вместо объекта — Prettier не трогает содержимое Map
// и Unicode ключи остаются в строках без проблем
const CHECHEN_DIACRITICS = new Map<string, string>([
  ["\u0430\u0303", "\u0430"], // а̃ → а
  ["\u0410\u0303", "\u0430"], // А̃ → а
  ["\u0435\u0303", "\u0435"], // е̃ → е
  ["\u0415\u0303", "\u0435"], // Е̃ → е
  ["\u0438\u0303", "\u0438"], // и̃ → и
  ["\u0418\u0303", "\u0438"], // И̃ → и
  ["\u043e\u0303", "\u043e"], // о̃ → о
  ["\u041e\u0303", "\u043e"], // О̃ → о
  ["\u0443\u0303", "\u0443"], // у̃ → у
  ["\u0423\u0303", "\u0443"], // У̃ → у
  ["\u044d\u0303", "\u044d"], // э̃ → э
  ["\u042d\u0303", "\u044d"], // Э̃ → э
  ["\u044e\u0303", "\u044e"], // ю̃ → ю
  ["\u042e\u0303", "\u044e"], // Ю̃ → ю
  ["\u044f\u0303", "\u044f"], // я̃ → я
  ["\u042f\u0303", "\u044f"], // Я̃ → я
  ["\u04c1", "\u0438"], // Ӏ (заглавная) → и
  ["\u04cf", "\u0438"], // ӏ (строчная)  → и
  ["\u044a", ""], // ъ → ''
]);

export function normalizeWord(word: string): string {
  // Сначала NFD — разбиваем составные символы на базовый + диакритик
  let result = word.toLowerCase().normalize("NFD");

  // Заменяем известные чеченские диакритики через Map
  for (const [from, to] of CHECHEN_DIACRITICS) {
    result = result.replaceAll(from, to);
  }

  // Убираем оставшиеся combining diacritical marks (U+0300–U+036F)
  result = result.replace(/[\u0300-\u036f]/g, "").normalize("NFC");

  return result.trim();
}

export function normalizeTranslate(translate: string): string {
  return translate
    .replace(/<[^>]*>/g, " ") // убираем HTML теги
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function detectLanguage(query: string): "ru" | "nah" | "unknown" {
  // Ӏ (U+04C1) и ӏ (U+04CF) — специфичные нохчийн буквы
  // а̃ и другие буквы с тильдой (combining tilde U+0303)
  const chechenSpecific = /[\u04c1\u04cf]|[а-яё]\u0303/u;
  if (chechenSpecific.test(query)) return "nah";

  const cyrillic = /[а-яёА-ЯЁ]/;
  if (cyrillic.test(query)) return "ru";

  return "unknown";
}
