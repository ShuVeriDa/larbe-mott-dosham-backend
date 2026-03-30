export type DictionaryDirection = "nah-ru" | "ru-nah" | "both";

export type DictionaryMeta = {
  slug: string;
  title: string;
  direction: DictionaryDirection;
  // Путь к JSON-файлу относительно корня проекта.
  // JSON может быть массивом entries, либо объектом вида: { entries: [...] }.
  file: string;
};

export const DICTIONARIES: DictionaryMeta[] = [
  {
    slug: "maciev",
    title: "Мациев. Чеченско-русский словарь",
    direction: "nah-ru",
    file: "dictionaries/maciev.json",
  },
  {
    slug: "karasaev-maciev-ru-nah",
    title: "Карасаев-Мациев. Русско-чеченский словарь",
    direction: "ru-nah",
    file: "dictionaries/karasaev_maciev_ru_ce.json",
  },
  {
    slug: "baisultanov-nah-ru",
    title: "Байсултанов. Чеченско-русский словарь",
    direction: "nah-ru",
    file: "dictionaries/baisultanov_ce_ru.json",
  },
  {
    slug: "aslahanov-ru-nah",
    title: "Аслаханов. Русско-чеченский словарь",
    direction: "ru-nah",
    file: "dictionaries/aslahanov_ru_ce.json",
  },
  {
    slug: "daukaev-ru-nah",
    title: "Даукаев. Русско-чеченский геологический словарь",
    direction: "ru-nah",
    file: "dictionaries/daukaev_ru_ce.json",
  },
  {
    slug: "abdurashidov",
    title:
      "Абдурашидов. Чеченско-русский / русско-чеченский юридический словарь",
    direction: "both",
    file: "dictionaries/abdurashidov_ce_ru_ru_ce.json",
  },
  {
    slug: "umarhadjiev-ahmatukaev",
    title: "Умархаджиев-Ахматукаев. Математический словарь",
    direction: "both",
    file: "dictionaries/umarhadjiev_ahmatukaev_ce_ru_ru_ce.json",
  },
  {
    slug: "nah-ru-anatomy",
    title: "Чеченско-русский анатомический словарь",
    direction: "nah-ru",
    file: "dictionaries/ce_ru_anatomy.json",
  },
  {
    slug: "ru-nah-anatomy",
    title: "Русско-чеченский анатомический словарь",
    direction: "ru-nah",
    file: "dictionaries/ru_ce_anatomy.json",
  },
  {
    slug: "nah-ru-computer",
    title: "Чеченско-русский / русско-чеченский компьютерный словарь",
    direction: "both",
    file: "dictionaries/ru_ce_ce_ru_computer.json",
  },
  {
    slug: "ismailov-nah-ru",
    title: "Исмаилов. Чеченско-русский словарь",
    direction: "nah-ru",
    file: "dictionaries/ismailov_ce_ru.json",
  },
  {
    slug: "ismailov-ru-nah",
    title: "Исмаилов. Русско-чеченский словарь",
    direction: "ru-nah",
    file: "dictionaries/ismailov_ru_ce.json",
  },
];
