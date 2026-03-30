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
