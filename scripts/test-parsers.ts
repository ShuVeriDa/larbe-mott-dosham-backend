/**
 * Тестовый скрипт для проверки всех парсеров.
 * Запуск: npx ts-node scripts/test-parsers.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { DICTIONARIES } from "../src/import/dictionaries";
import { getParser } from "../src/merge/parsers/index";

const DICT_DIR = path.resolve(__dirname, "../dictionaries");

interface TestResult {
  slug: string;
  title: string;
  rawCount: number;
  parsedCount: number;
  lossPercent: string;
  withMeanings: number;
  withGrammar: number;
  withClass: number;
  withExamples: number;
  withCitations: number;
  withLatinName: number;
  withStyleLabel: number;
  withPhrase: number;
  sample: any;
  errors: string[];
}

function main() {
  console.log("=".repeat(80));
  console.log("ТЕСТИРОВАНИЕ ПАРСЕРОВ СЛОВАРЕЙ");
  console.log("=".repeat(80));
  console.log();

  const results: TestResult[] = [];

  for (const meta of DICTIONARIES) {
    console.log(`\n--- ${meta.slug} ---`);
    const errors: string[] = [];

    // 1. Читаем JSON
    const filePath = path.resolve(DICT_DIR, path.basename(meta.file));
    let rawEntries: any[];
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      rawEntries = JSON.parse(raw);
    } catch (e: any) {
      console.log(`  ОШИБКА чтения: ${e.message}`);
      errors.push(`Не удалось прочитать файл: ${e.message}`);
      results.push({
        slug: meta.slug,
        title: meta.title,
        rawCount: 0,
        parsedCount: 0,
        lossPercent: "100%",
        withMeanings: 0,
        withGrammar: 0,
        withClass: 0,
        withExamples: 0,
        withCitations: 0,
        withLatinName: 0,
        withStyleLabel: 0,
        withPhrase: 0,
        sample: null,
        errors,
      });
      continue;
    }

    // 2. Парсим
    let parsed: any[];
    try {
      const parser = getParser(meta.slug);
      parsed = parser(rawEntries);
    } catch (e: any) {
      console.log(`  ОШИБКА парсинга: ${e.message}`);
      errors.push(`Парсер упал: ${e.message}`);
      results.push({
        slug: meta.slug,
        title: meta.title,
        rawCount: rawEntries.length,
        parsedCount: 0,
        lossPercent: "100%",
        withMeanings: 0,
        withGrammar: 0,
        withClass: 0,
        withExamples: 0,
        withCitations: 0,
        withLatinName: 0,
        withStyleLabel: 0,
        withPhrase: 0,
        sample: null,
        errors,
      });
      continue;
    }

    // 3. Считаем статистику
    const withMeanings = parsed.filter(
      (e) => e.meanings?.length > 0 && e.meanings.some((m: any) => m.translation),
    ).length;
    const withGrammar = parsed.filter((e) => e.grammar && Object.keys(e.grammar).length > 0).length;
    const withClass = parsed.filter((e) => e.nounClass).length;
    const withExamples = parsed.filter(
      (e) => e.meanings?.some((m: any) => m.examples?.length > 0),
    ).length;
    const withCitations = parsed.filter((e) => e.citations?.length > 0).length;
    const withLatinName = parsed.filter((e) => e.latinName).length;
    const withStyleLabel = parsed.filter((e) => e.styleLabel).length;
    const withPhrase = parsed.filter((e) => e.phraseology?.length > 0).length;

    const lossPercent = rawEntries.length > 0
      ? ((1 - parsed.length / rawEntries.length) * 100).toFixed(1) + "%"
      : "N/A";

    // 4. Находим самый богатый пример
    const richest = parsed
      .filter((e) => e.meanings?.length > 0)
      .sort((a, b) => {
        const scoreA =
          (a.meanings?.length || 0) * 2 +
          (a.grammar ? 3 : 0) +
          (a.nounClass ? 1 : 0) +
          (a.phraseology?.length || 0) +
          (a.citations?.length || 0) +
          (a.latinName ? 1 : 0);
        const scoreB =
          (b.meanings?.length || 0) * 2 +
          (b.grammar ? 3 : 0) +
          (b.nounClass ? 1 : 0) +
          (b.phraseology?.length || 0) +
          (b.citations?.length || 0) +
          (b.latinName ? 1 : 0);
        return scoreB - scoreA;
      })[0];

    // 5. Проверки качества
    if (parsed.length === 0) {
      errors.push("Парсер вернул 0 записей!");
    }
    if (withMeanings < parsed.length * 0.5 && parsed.length > 10) {
      errors.push(`Только ${withMeanings}/${parsed.length} записей с переводами`);
    }

    // Проверяем что word не содержит HTML
    const htmlInWord = parsed.filter((e) => /<[^>]+>/.test(e.word));
    if (htmlInWord.length > 0) {
      errors.push(`${htmlInWord.length} записей с HTML в word: "${htmlInWord[0].word}"`);
    }

    // Проверяем что word не пустой
    const emptyWord = parsed.filter((e) => !e.word || e.word.trim().length === 0);
    if (emptyWord.length > 0) {
      errors.push(`${emptyWord.length} записей с пустым word`);
    }

    // Проверяем классы — должны быть полные формы (ву/йу/ду/бу)
    const badClass = parsed.filter(
      (e) => e.nounClass && !["ву", "йу", "ду", "бу"].some((c) => e.nounClass.includes(c)),
    );
    if (badClass.length > 0) {
      errors.push(
        `${badClass.length} записей с неполным классом: "${badClass[0].nounClass}"`,
      );
    }

    console.log(`  Исходных: ${rawEntries.length} → Распарсено: ${parsed.length} (потери: ${lossPercent})`);
    console.log(`  С переводами: ${withMeanings} | С грамматикой: ${withGrammar} | С классом: ${withClass}`);
    console.log(`  С примерами: ${withExamples} | С цитатами: ${withCitations} | С лат.именем: ${withLatinName}`);
    console.log(`  Со стилем: ${withStyleLabel} | С фразеологией: ${withPhrase}`);
    if (errors.length > 0) {
      console.log(`  ⚠ ПРОБЛЕМЫ:`);
      errors.forEach((e) => console.log(`    - ${e}`));
    }

    results.push({
      slug: meta.slug,
      title: meta.title,
      rawCount: rawEntries.length,
      parsedCount: parsed.length,
      lossPercent,
      withMeanings,
      withGrammar,
      withClass,
      withExamples,
      withCitations,
      withLatinName,
      withStyleLabel,
      withPhrase,
      sample: richest
        ? {
            word: richest.word,
            wordAccented: richest.wordAccented,
            partOfSpeech: richest.partOfSpeech,
            nounClass: richest.nounClass,
            grammar: richest.grammar,
            meanings: richest.meanings?.slice(0, 2),
            phraseology: richest.phraseology?.slice(0, 1),
            citations: richest.citations?.slice(0, 1),
            latinName: richest.latinName,
            styleLabel: richest.styleLabel,
            domain: richest.domain,
          }
        : null,
      errors,
    });
  }

  // Итоговая таблица
  console.log("\n" + "=".repeat(80));
  console.log("ИТОГОВАЯ ТАБЛИЦА");
  console.log("=".repeat(80));
  console.log(
    "Словарь".padEnd(30) +
      "Исх".padStart(7) +
      "Парс".padStart(7) +
      "Потери".padStart(8) +
      "Перев".padStart(7) +
      "Грам".padStart(6) +
      "Класс".padStart(7) +
      "Прим".padStart(6) +
      "Цит".padStart(5) +
      "Ошиб".padStart(5),
  );
  console.log("-".repeat(88));
  let totalRaw = 0;
  let totalParsed = 0;
  let totalErrors = 0;
  for (const r of results) {
    totalRaw += r.rawCount;
    totalParsed += r.parsedCount;
    totalErrors += r.errors.length;
    console.log(
      r.slug.padEnd(30) +
        String(r.rawCount).padStart(7) +
        String(r.parsedCount).padStart(7) +
        r.lossPercent.padStart(8) +
        String(r.withMeanings).padStart(7) +
        String(r.withGrammar).padStart(6) +
        String(r.withClass).padStart(7) +
        String(r.withExamples).padStart(6) +
        String(r.withCitations).padStart(5) +
        String(r.errors.length).padStart(5),
    );
  }
  console.log("-".repeat(88));
  console.log(
    "ИТОГО".padEnd(30) +
      String(totalRaw).padStart(7) +
      String(totalParsed).padStart(7) +
      ((1 - totalParsed / totalRaw) * 100).toFixed(1).padStart(7) +
      "%" +
      "".padStart(25) +
      String(totalErrors).padStart(5),
  );

  // Выводим лучшие примеры
  console.log("\n" + "=".repeat(80));
  console.log("ЛУЧШИЕ ПРИМЕРЫ (по 1 из каждого словаря)");
  console.log("=".repeat(80));
  for (const r of results) {
    if (r.sample) {
      console.log(`\n[${r.slug}]`);
      console.log(JSON.stringify(r.sample, null, 2));
    }
  }

  // Сохраняем результат
  const outPath = path.resolve(__dirname, "../dictionaries/test-results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`\nРезультаты сохранены в: dictionaries/test-results.json`);

  // Exit code
  if (totalErrors > 0) {
    console.log(`\n⚠ Найдено ${totalErrors} проблем. Смотри детали выше.`);
  } else {
    console.log(`\n✓ Все парсеры работают без ошибок.`);
  }
}

main();
