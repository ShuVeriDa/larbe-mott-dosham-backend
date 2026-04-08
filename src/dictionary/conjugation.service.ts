import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma.service";
import { ConjugationParadigm, GrammarInfo } from "src/merge/parsers/types";

/**
 * Спряжение чеченских глаголов.
 *
 * Источники правил:
 * - Алироев И. Ю. «Самоучитель чеченского языка» (2003)
 * - Модель «двух спряжений» с 3 базовыми формами
 *
 * Два спряжения:
 *   I  — окончание -а → -у, корневая гласная меняется (а→о, э→оь, и→уь, о→у, у→у)
 *   II — окончание -а остаётся -а, корневая гласная может не меняться
 *
 * 3 базовые формы (из них строятся все 9 времён):
 *   1. Настоящее (verbPresent): лоху / хеза
 *   2. Недавнопрошедшее: лехи / хези
 *   3. Прош. совершенное (verbPast): лехна / хезна
 *
 * Производные:
 *   - Прош. несовершенное   = форма 1 + -ра     (лохура / хезара)
 *   - Очевидно-прошедшее    = форма 2 + -ра     (лехира / хезира)
 *   - Давнопрошедшее        = форма 3, -а → -ера (лехнера / хезнера)
 *   - Будущее возможное      = форма 1 + -р      (лохур / хезар)
 *   - Будущее фактическое    = буд. возм. + связка (лохур ду / хезар ду)
 *   - Сложное настоящее      = форма 1 + -ш + связка (лохуш ву)
 */
@Injectable()
export class ConjugationService {
  constructor(private prisma: PrismaService) {}

  async getParadigm(word: string): Promise<ConjugationParadigm | null> {
    // Ищем слово в БД
    const entry = await this.prisma.unifiedEntry.findFirst({
      where: {
        OR: [
          { word },
          { wordNormalized: word.toLowerCase() },
          { variants: { has: word.toLowerCase() } },
        ],
      },
    });

    if (!entry) return null;

    // Проверяем что это глагол
    const pos = entry.partOfSpeech?.toLowerCase() ?? "";
    const isVerb =
      pos.includes("гл.") ||
      pos.includes("глаг") ||
      pos === "масд." ||
      pos.includes("хандош");
    if (!isVerb && !this.hasVerbForms(entry.grammar)) return null;

    const grammar = (entry.grammar as GrammarInfo) ?? {};
    const infinitive = entry.word;

    // Извлекаем 3 базовые формы
    const present = grammar.verbPresent ?? null;
    const recentPast = this.extractRecentPast(grammar, infinitive);
    const perfect = grammar.verbPast ?? null;

    // Определяем тип спряжения
    const conjugationType = this.detectConjugationType(infinitive, present);

    // Генерируем все формы
    return this.buildParadigm(
      infinitive,
      present,
      recentPast,
      perfect,
      conjugationType,
      grammar,
    );
  }

  // ─── Определение типа спряжения ──────────────────────────────

  /**
   * I спряжение: окончание -а → -у (лаха→лоху, тоха→туху)
   * II спряжение: окончание -а → -а (хаза→хеза, лела→лела)
   */
  private detectConjugationType(
    infinitive: string,
    present: string | null,
  ): 1 | 2 | null {
    if (!present) return null;
    if (present.endsWith("у") || present.endsWith("уь")) return 1;
    if (present.endsWith("а") || present.endsWith("о")) return 2;
    return null;
  }

  // ─── Построение парадигмы ────────────────────────────────────

  private buildParadigm(
    infinitive: string,
    present: string | null,
    recentPast: string | null,
    perfect: string | null,
    conjugationType: 1 | 2 | null,
    grammar: GrammarInfo,
  ): ConjugationParadigm {
    // Производные от формы 1 (настоящее)
    const pastImperfective = present ? present + "ра" : null;
    const futurePossible = present ? present + "р" : null;
    const gerundPresent = present ? present + "ш" : null;
    const presentCompound = gerundPresent ? gerundPresent + " ву" : null;
    const futureFactual = futurePossible ? futurePossible + " ду" : null;

    // Производные от формы 2 (недавнопрошедшее)
    const evidentialPast = recentPast ? recentPast + "ра" : null;

    // Производные от формы 3 (прош. совершенное)
    const remotePast = this.buildRemotePast(perfect);

    // Причастия
    const participlePresent = present
      ? present + (present.endsWith("у") ? "рг" : "рг")
      : null;
    const participlePast =
      grammar.verbParticiple ?? (perfect ? perfect + "рг" : null);

    // Масдар: инфинитив + -р
    const masdar = infinitive ? infinitive + "р" : null;

    // Повелительное наклонение
    const imperativeBasic = infinitive ? infinitive + "л" : null;
    const imperativePolite = infinitive ? infinitive + "хьа" : null;
    const imperativePolitePlural = infinitive
      ? this.buildPolitePlural(infinitive)
      : null;

    return {
      word: infinitive,
      conjugationType,
      baseForms: {
        present,
        recentPast,
        perfect,
      },
      tenses: {
        presentSimple: present,
        presentCompound,
        recentPast,
        evidentialPast,
        perfect,
        remotePast,
        pastImperfective,
        futurePossible,
        futureFactual,
      },
      participles: {
        present: participlePresent,
        past: participlePast,
        gerundPresent,
        gerundPast: perfect,
        masdar,
      },
      imperative: {
        basic: imperativeBasic,
        polite: imperativePolite,
        politePlural: imperativePolitePlural,
      },
      negation: {
        present: present ? "ца " + present : null,
        imperative: infinitive ? "ма " + infinitive : null,
      },
    };
  }

  // ─── Вспомогательные методы ──────────────────────────────────

  /**
   * Давнопрошедшее: прош. совершенное, замена финального -а → -ера
   * лехна → лехнера, хезна → хезнера, аьлла → аьллера
   */
  private buildRemotePast(perfect: string | null): string | null {
    if (!perfect) return null;
    if (perfect.endsWith("а")) {
      return perfect.slice(0, -1) + "ера";
    }
    // Для форм типа аьлла → аьллера
    return perfect + "ера";
  }

  /**
   * Повелительное мн.ч.: заменяем финальную -а на -ийша
   * деша → дешийша, аха → ахийша
   */
  private buildPolitePlural(infinitive: string): string {
    if (infinitive.endsWith("а")) {
      return infinitive.slice(0, -1) + "ийша";
    }
    return infinitive + "ийша";
  }

  /**
   * Извлечь недавнопрошедшее из grammar или попытаться определить.
   * У Мациева это может быть сохранено в одной из форм.
   * Если нет — возвращаем null (форма не генерируется автоматически,
   * т.к. перегласовка нерегулярна).
   */
  private extractRecentPast(
    grammar: GrammarInfo,
    _infinitive: string,
  ): string | null {
    // В данных Мациева недавнопрошедшее может быть в verbParticiple
    // или в другом поле. Если нет — возвращаем null.
    // TODO: добавить поле recentPast в GrammarInfo при парсинге
    return null;
  }

  /** Проверяет наличие глагольных форм в grammar JSON */
  private hasVerbForms(grammar: unknown): boolean {
    if (!grammar || typeof grammar !== "object") return false;
    const g = grammar as Record<string, unknown>;
    return !!(g.verbPresent || g.verbPast || g.verbParticiple);
  }
}
