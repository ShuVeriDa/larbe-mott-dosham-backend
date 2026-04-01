import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiKeyGuard } from "src/common/guards/api-key.guard";
import { MergeService } from "./merge.service";

@Controller("merge")
export class MergeController {
  constructor(private readonly mergeService: MergeService) {}

  // -------------------------------------------------------
  // Этап 1: Парсинг исходных JSON → распарсенные JSON
  // -------------------------------------------------------

  // POST /api/merge/parse/:slug — парсит один словарь
  @UseGuards(ApiKeyGuard)
  @Post("parse/:slug")
  parseOne(@Param("slug") slug: string) {
    return this.mergeService.parseOne(slug);
  }

  // POST /api/merge/parse-all — парсит все словари
  @UseGuards(ApiKeyGuard)
  @Post("parse-all")
  parseAll() {
    return this.mergeService.parseAll();
  }

  // GET /api/merge/preview/:slug?limit=5 — превью распарсенного файла
  @Get("preview/:slug")
  preview(@Param("slug") slug: string, @Query("limit") limit?: string) {
    return this.mergeService.preview(slug, limit ? parseInt(limit, 10) : 5);
  }

  // -------------------------------------------------------
  // Очистка оригинальных словарей (дедупликация + сортировка)
  // -------------------------------------------------------

  // POST /api/merge/clean/:slug — очистить один оригинальный словарь
  @UseGuards(ApiKeyGuard)
  @Post("clean/:slug")
  cleanOriginal(@Param("slug") slug: string) {
    return this.mergeService.cleanOriginal(slug);
  }

  // POST /api/merge/clean-all — очистить все оригинальные словари
  @UseGuards(ApiKeyGuard)
  @Post("clean-all")
  cleanAllOriginals() {
    return this.mergeService.cleanAllOriginals();
  }

  // -------------------------------------------------------
  // Этап 2: Объединение распарсенных JSON → unified.json
  // -------------------------------------------------------

  // POST /api/merge/unify/:slug — добавить один словарь в unified.json
  @UseGuards(ApiKeyGuard)
  @Post("unify/:slug")
  unifyOne(@Param("slug") slug: string) {
    return this.mergeService.unifyOne(slug);
  }

  // POST /api/merge/unify-all — собрать все parsed JSON в unified.json
  @UseGuards(ApiKeyGuard)
  @Post("unify-all")
  unifyAll() {
    return this.mergeService.unifyAll();
  }

  // DELETE /api/merge/reset — очистить unified.json (начать заново)
  @UseGuards(ApiKeyGuard)
  @Delete("reset")
  reset() {
    return this.mergeService.reset();
  }

  // -------------------------------------------------------
  // Этап 2 (пошаговый): Слияние с версионированием
  // -------------------------------------------------------

  // POST /api/merge/unify-step/:slug — добавить словарь + снэпшот + лог
  @UseGuards(ApiKeyGuard)
  @Post("unify-step/:slug")
  unifyStep(@Param("slug") slug: string) {
    return this.mergeService.unifyStep(slug);
  }

  // GET /api/merge/unified-log — история слияния + что осталось
  @Get("unified-log")
  getUnifiedLog() {
    return this.mergeService.getUnifiedLog();
  }

  // POST /api/merge/rollback/:step — откатиться к шагу (0 = пустой)
  @UseGuards(ApiKeyGuard)
  @Post("rollback/:step")
  rollback(@Param("step") step: string) {
    return this.mergeService.rollback(parseInt(step, 10));
  }

  // DELETE /api/merge/reset-steps — полный сброс (unified + снэпшоты + лог)
  @UseGuards(ApiKeyGuard)
  @Delete("reset-steps")
  resetSteps() {
    return this.mergeService.resetSteps();
  }

  // -------------------------------------------------------
  // Этап 3: Загрузка unified.json → БД
  // -------------------------------------------------------

  // POST /api/merge/load — загружает unified.json в UnifiedEntry
  @UseGuards(ApiKeyGuard)
  @Post("load")
  load() {
    return this.mergeService.load();
  }

  // -------------------------------------------------------
  // Статус
  // -------------------------------------------------------

  // GET /api/merge/status — что есть на каждом этапе
  @Get("status")
  status() {
    return this.mergeService.status();
  }
}
