/**
 * CLI-раннер для пайплайн-операций MergeService.
 *
 * Использование:  npx ts-node -r tsconfig-paths/register src/cli.ts <command> [args]
 * Или через npm:  npm run pipeline -- <command> [args]
 *
 * Команды:
 *   parse <slug|all>        — парсинг одного или всех словарей
 *   clean <slug|all>        — дедупликация оригинальных словарей
 *   unify-step <slug>       — пошаговое слияние с версионированием
 *   rollback <step>         — откат к указанному шагу (0 = пустой)
 *   reset                   — полный сброс (unified + снэпшоты + лог)
 *   load                    — загрузка unified.json в БД
 *   improve                 — очистка и нормализация unified.json
 */

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { MergeService } from "./merge/merge.service";

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    printHelp();
    process.exit(1);
  }

  // Создаём NestJS-контекст без HTTP-сервера
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["log", "error", "warn"],
  });

  const mergeService = app.get(MergeService);

  try {
    const result = await runCommand(mergeService, command, args);
    console.log("\n--- Результат ---");
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error("\n--- Ошибка ---");
    console.error(err.message ?? err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

async function runCommand(svc: MergeService, command: string, args: string[]) {
  switch (command) {
    // --- Парсинг ---
    case "parse": {
      const slug = args[0];
      if (!slug) throw new Error("Укажите slug словаря или 'all'");
      return slug === "all" ? svc.parseAll() : svc.parseOne(slug);
    }

    // --- Очистка оригиналов ---
    case "clean": {
      const slug = args[0];
      if (!slug) throw new Error("Укажите slug словаря или 'all'");
      return slug === "all" ? svc.cleanAllOriginals() : svc.cleanOriginal(slug);
    }

    // --- Пошаговое слияние ---
    case "unify-step": {
      const slug = args[0];
      if (!slug) throw new Error("Укажите slug словаря");
      return svc.unifyStep(slug);
    }

    // --- Откат ---
    case "rollback": {
      const step = args[0];
      if (step === undefined)
        throw new Error("Укажите номер шага (0 = пустой)");
      return svc.rollback(parseInt(step, 10));
    }

    // --- Полный сброс ---
    case "reset":
      return svc.resetSteps();

    // --- Загрузка в БД ---
    case "load":
      return svc.load();

    // --- Улучшение данных ---
    case "improve":
      return svc.improve();

    default:
      throw new Error(`Неизвестная команда: "${command}"`);
  }
}

function printHelp() {
  console.log(
    `
Пайплайн-команды для MottLarbe:

  npm run pipeline -- parse <slug|all>     Парсинг словаря (или всех)
  npm run pipeline -- clean <slug|all>     Дедупликация оригинала (или всех)
  npm run pipeline -- unify-step <slug>    Пошаговое слияние с версионированием
  npm run pipeline -- rollback <step>      Откат к шагу (0 = пустой)
  npm run pipeline -- reset                Полный сброс (unified + снэпшоты + лог)
  npm run pipeline -- load                 Загрузка unified.json в БД
  npm run pipeline -- improve              Очистка и нормализация unified.json
  `.trim(),
  );
}

void main();
