import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
import { Response } from "express";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "../admin.service";

@ApiTags("admin/quality")
@Controller("admin/quality")
@AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
@ApiBearerAuth()
export class QualityAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("stats")
  @ApiOperation({ summary: "Data quality statistics" })
  qualityStats() {
    return this.adminService.qualityStats();
  }

  @Get("stats-by-source")
  @ApiOperation({ summary: "Data quality breakdown by source" })
  qualityStatsBySource() {
    return this.adminService.qualityStatsBySource();
  }

  @Get("problems/export")
  @ApiOperation({ summary: "Export problematic entries as CSV" })
  async exportProblems(
    @Query("type") type: string | undefined,
    @Query("q") q: string | undefined,
    @Query("source") source: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.adminService.findProblemsForExport(type, q, source);

    const header = "id,word,partOfSpeech,nounClass,entryType,sources,updatedAt,problems\n";
    const csvRows = rows.map((row) =>
      [
        row.id,
        `"${row.word.replace(/"/g, '""')}"`,
        row.partOfSpeech ?? "",
        row.nounClass ?? "",
        row.entryType,
        `"${row.sources.join("|")}"`,
        row.updatedAt.toISOString(),
        `"${row.problems.join("|")}"`,
      ].join(","),
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="quality-problems.csv"');
    res.send(header + csvRows.join("\n"));
  }

  @Get("problems")
  @ApiOperation({
    summary: "Find problematic entries (empty meanings, missing class, etc.)",
  })
  problems(
    @Query("type") type?: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit?: number,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query("q") q?: string,
    @Query("source") source?: string,
  ) {
    return this.adminService.findProblems(type, limit, page, q, source);
  }
}
