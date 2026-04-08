import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { MergeService } from "./merge.service";

@Controller("merge")
export class MergeController {
  constructor(private readonly mergeService: MergeService) {}

  // GET /api/merge/preview/:slug?limit=5 — превью распарсенного файла
  @Get("preview/:slug")
  preview(
    @Param("slug") slug: string,
    @Query("limit", new DefaultValuePipe(5), ParseIntPipe) limit?: number,
  ) {
    return this.mergeService.preview(slug, limit);
  }

  // GET /api/merge/unified-log — история слияния + что осталось
  @Get("unified-log")
  getUnifiedLog() {
    return this.mergeService.getUnifiedLog();
  }

  // GET /api/merge/status — что есть на каждом этапе
  @Get("status")
  status() {
    return this.mergeService.status();
  }
}
