import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import {
  CaseSet,
  DeclensionParadigm,
  GrammarInfo,
} from "src/merge/parsers/types";

/**
 * Склонение чеченских существительных.
 *
 * Источник правил: Алироев И. Ю. — Самоучитель чеченского языка (2003), главы 10–11
 *
 * Тип склонения определяется по окончанию творительного падежа ед. числа:
 *   I   — -ца / -аца
 *   II  — наращение -н или -р + -ца  (напр. горанца)
 *   III — -ица
 *   IV  — -чунца (наращение -чун + -ца)
 */
@Injectable()
export class DeclensionService {
  constructor(private prisma: PrismaService) {}

  // ─── Публичные методы ───────────────────────────────────────

  /**
   * Построить полную парадигму склонения слова.
   * Сначала ищем слово в БД и берём сохранённые формы, недостающие генерируем.
   */
  async getParadigm(word: string): Promise<DeclensionParadigm | null> {
    const entry = await this.prisma.unifiedEntry.findFirst({
      where: { word: { equals: word, mode: "insensitive" } },
    });

    if (!entry) return null;

    const grammar = (entry.grammar as GrammarInfo) ?? {};
    const stem = grammar.obliqueStem ?? this.guessObliqueStem(entry.word);
    const declType = grammar.declensionType ?? this.detectType(grammar);

    const singular = this.buildCaseSet(
      entry.word,
      stem,
      declType,
      "singular",
      grammar,
    );

    let plural: CaseSet | null = null;
    if (grammar.plural) {
      const pluralStem = this.guessObliqueStem(grammar.plural);
      plural = this.buildCaseSet(
        grammar.plural,
        pluralStem,
        declType,
        "plural",
        grammar,
      );
    }

    return {
      word: entry.word,
      declensionType: declType,
      singular,
      plural,
    };
  }

  /**
   * Лемматизация: по введённой словоформе пытаемся найти начальную форму.
   * Отсекаем известные падежные окончания и ищем результат в БД.
   */
  async lemmatize(form: string): Promise<string[]> {
    const lower = form.toLowerCase().trim();
    const candidates = this.stripEndings(lower);
    if (candidates.length === 0) return [];

    const results = await this.prisma.unifiedEntry.findMany({
      where: {
        wordNormalized: { in: candidates },
      },
      select: { word: true },
    });

    return [...new Set(results.map((r) => r.word))];
  }

  // ─── Определение типа склонения ─────────────────────────────

  /**
   * Определить тип склонения по имеющимся формам в grammar.
   * Если творительный не указан — пытаемся угадать по остальным формам.
   */
  detectType(grammar: GrammarInfo): 1 | 2 | 3 | 4 {
    const instr = grammar.instrumental;
    if (instr) {
      if (/чу[ьъ]?нца$/u.test(instr)) return 4;
      if (/ица$/u.test(instr)) return 3;
      // II тип: основа + н/р + ца  (горанца, тIагарца)
      if (/[нр]ца$/u.test(instr)) return 2;
      // I тип: -ца / -аца (базовый)
      return 1;
    }

    // Фолбэк: пробуем по родительному
    const gen = grammar.genitive;
    if (gen) {
      if (/чун$/u.test(gen)) return 4;
      if (/ин$/u.test(gen)) return 3;
      // II тип: наращенная основа + ан/ен
      // Сложно отличить от I без творительного, по умолчанию I
    }

    return 1;
  }

  // ─── Построение падежного набора ─────────────────────────────

  private buildCaseSet(
    nominative: string,
    stem: string,
    declType: 1 | 2 | 3 | 4,
    number: "singular" | "plural",
    grammar: GrammarInfo,
  ): CaseSet {
    if (number === "singular") {
      return {
        nominative,
        genitive:
          grammar.genitive ?? this.formCase(stem, declType, "genitive"),
        dative: grammar.dative ?? this.formCase(stem, declType, "dative"),
        ergative:
          grammar.ergative ?? this.formCase(stem, declType, "ergative"),
        instrumental:
          grammar.instrumental ??
          this.formCase(stem, declType, "instrumental"),
        substantive:
          grammar.substantive ??
          this.formCase(stem, declType, "substantive"),
        locative:
          grammar.locative ?? this.formCase(stem, declType, "locative"),
        comparative:
          grammar.comparative ??
          this.formCase(stem, declType, "comparative"),
      };
    }

    // Множественное число: используем сохранённые pluralX формы или генерируем
    return {
      nominative,
      genitive:
        grammar.pluralGenitive ??
        this.formPluralCase(stem, declType, "genitive"),
      dative:
        grammar.pluralDative ??
        this.formPluralCase(stem, declType, "dative"),
      ergative:
        grammar.pluralErgative ??
        this.formPluralCase(stem, declType, "ergative"),
      instrumental:
        grammar.pluralInstrumental ??
        this.formPluralCase(stem, declType, "instrumental"),
      substantive:
        grammar.pluralSubstantive ??
        this.formPluralCase(stem, declType, "substantive"),
      locative:
        grammar.pluralLocative ??
        this.formPluralCase(stem, declType, "locative"),
      comparative:
        grammar.pluralComparative ??
        this.formPluralCase(stem, declType, "comparative"),
    };
  }

  // ─── Генерация падежных форм ед. числа ──────────────────────

  /**
   * Правила по типам склонения (Алироев, гл. 10–11).
   *
   * Окончания ед. числа:
   *   Падеж          I       II (осн+н)   III      IV (осн+чун)
   *   Родительный     -ан     -нан        -ин      -чунан  (? -чун)
   *   Дательный       -на     -нна        -ина     -чунна
   *   Эргативный      -о      -но         -а       -чо
   *   Творительный    -ца     -нца        -ица     -чунца
   *   Вещественный    -х      -нах        -их      -чух
   *   Местный         -е      -не         -ига     -чунга  (? -е)
   *   Сравнительный   -ал     -нал        -ил      -чул
   */
  private formCase(
    stem: string,
    type: 1 | 2 | 3 | 4,
    caseName: keyof Omit<CaseSet, "nominative">,
  ): string {
    const suffixes: Record<
      1 | 2 | 3 | 4,
      Record<keyof Omit<CaseSet, "nominative">, string>
    > = {
      1: {
        genitive: "ан",
        dative: "на",
        ergative: "о",
        instrumental: "ца",
        substantive: "х",
        locative: "е",
        comparative: "ал",
      },
      2: {
        genitive: "нан",
        dative: "нна",
        ergative: "но",
        instrumental: "нца",
        substantive: "нах",
        locative: "не",
        comparative: "нал",
      },
      3: {
        genitive: "ин",
        dative: "ина",
        ergative: "а",
        instrumental: "ица",
        substantive: "их",
        locative: "ига",
        comparative: "ил",
      },
      4: {
        genitive: "чун",
        dative: "чунна",
        ergative: "чо",
        instrumental: "чуьнца",
        substantive: "чух",
        locative: "чуьнга",
        comparative: "чул",
      },
    };

    return stem + suffixes[type][caseName];
  }

  // ─── Генерация падежных форм мн. числа ──────────────────────

  /**
   * Мн. число: косвенные падежи от основы мн. числа.
   *
   * Источник: Алироев И.Ю. — примеры из всех 4 типов склонения.
   *
   * Окончания мн.ч. (москалш, готанаш, мачаш, белхалой):
   *   Родительный  → -ийн (москалийн) / -н (белхалойн)
   *   Дательный    → -на  (москалшна, готанашна)
   *   Эргативный   → -а   (москалша, готанаша)
   *   Творительный → -ца  (москалшца, готанашца)
   *   Вещественный → -ех  (москалех) / -х (белхалойх)
   *   Местный      → -ка  (москалшка, готанашка)
   *   Сравнительный → -ел (москалел) / -л (белхалойл)
   */
  private formPluralCase(
    pluralStem: string,
    _type: 1 | 2 | 3 | 4,
    caseName: keyof Omit<CaseSet, "nominative">,
  ): string {
    // IV тип: мн.ч. на -ой/-й имеет другие окончания (белхалойн, белхалойх, белхалойл)
    const endsWithOy =
      pluralStem.endsWith("ой") || pluralStem.endsWith("й");

    if (endsWithOy) {
      const suffixes: Record<keyof Omit<CaseSet, "nominative">, string> = {
        genitive: "н",
        dative: "шна",
        ergative: "ша",
        instrumental: "шца",
        substantive: "х",
        locative: "шка",
        comparative: "л",
      };
      return pluralStem + suffixes[caseName];
    }

    // I–III типы: мн.ч. на -ш/-аш
    const suffixes: Record<keyof Omit<CaseSet, "nominative">, string> = {
      genitive: "ийн",
      dative: "на",
      ergative: "а",
      instrumental: "ца",
      substantive: "ех",
      locative: "ка",
      comparative: "ел",
    };

    return pluralStem + suffixes[caseName];
  }

  // ─── Угадывание косвенной основы ────────────────────────────

  /**
   * Если косвенная основа не указана явно, берём именительный как основу.
   * Для слов на гласную — убираем конечную гласную (базовая эвристика).
   */
  private guessObliqueStem(word: string): string {
    // Слова на согласную — основа = слово (стаг → стаг-)
    // Слова на гласную — убираем конечную гласную (маса → мас-)
    // Но это грубая эвристика — нерегулярные слова должны хранить obliqueStem
    const vowels = "аеёиоуыэюяАЕЁИОУЫЭЮЯ";
    const last = word[word.length - 1];
    if (vowels.includes(last)) {
      return word.slice(0, -1);
    }
    return word;
  }

  // ─── Лемматизация (отсечение окончаний) ─────────────────────

  /**
   * Генерирует кандидаты начальной формы, отсекая известные падежные суффиксы.
   * Порядок: от длинных к коротким, чтобы не отсечь лишнее.
   */
  private stripEndings(form: string): string[] {
    // Суффиксы от длинных к коротким
    const endings = [
      // IV тип (с ь и без)
      "чуьнца",
      "чуьнга",
      "чунца",
      "чунна",
      "чунга",
      "чунан",
      "чун",
      "чух",
      "чул",
      "чо",
      // IV тип мн.ч.
      "ойшна",
      "ойша",
      "ойшца",
      "ойшка",
      "ойн",
      "ойх",
      "ойл",
      // Мн. число
      "ашна",
      "аша",
      "ашца",
      "ашка",
      "шна",
      "шца",
      "шка",
      "ша",
      "ийн",
      "ех",
      "ел",
      "ка",
      // III тип
      "ица",
      "ига",
      "ина",
      "ин",
      "их",
      "ил",
      // II тип
      "нца",
      "нна",
      "нан",
      "нах",
      "нал",
      "не",
      "но",
      // I тип + общие
      "ца",
      "на",
      "ан",
      "ал",
      "ах",
      // Короткие
      "о",
      "а",
      "е",
      "х",
    ];

    const candidates: string[] = [];

    for (const ending of endings) {
      if (form.endsWith(ending) && form.length > ending.length + 1) {
        const candidate = form.slice(0, -ending.length);
        candidates.push(candidate);
        // Для слов, где основа оканчивалась на гласную — пробуем добавить обратно
        const vowels = ["а", "е", "и", "о", "у"];
        for (const v of vowels) {
          candidates.push(candidate + v);
        }
      }
    }

    return [...new Set(candidates)];
  }
}
