import {
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
import type { Response } from "express";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "../admin.service";

@ApiTags("admin/audit")
@Controller("admin/audit")
@AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
@ApiBearerAuth()
export class AuditAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("entries/:entryId")
  @ApiOperation({ summary: "Get edit history for an entry" })
  entryHistory(@Param("entryId", ParseIntPipe) entryId: number) {
    return this.adminService.getEntryEditHistory(entryId);
  }

  @Post("entries/:entryId/revert/:logId")
  @HttpCode(200)
  @ApiOperation({ summary: "Revert an entry to the state before a specific log entry" })
  revertEntry(
    @Param("entryId", ParseIntPipe) entryId: number,
    @Param("logId", ParseUUIDPipe) logId: string,
    @Req() req: any,
  ) {
    return this.adminService.revertEntryLog(entryId, logId, req.user?.id as string | undefined);
  }

  @Get("stats")
  @ApiOperation({ summary: "Audit log stats: 4 summary cards + byAction counts" })
  stats() {
    return this.adminService.getAuditStats();
  }

  @Get("export")
  @ApiOperation({ summary: "Export audit log as CSV with current filters" })
  async export(
    @Query("q") q: string | undefined,
    @Query("action") action: string | undefined,
    @Query("actorType") actorType: string | undefined,
    @Query("period") period: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.adminService.exportAuditLog({ q, action, actorType, period });

    const date = new Date().toISOString().slice(0, 10);
    const header = "id,date,time,action,actorType,entryId,word,author,changes\n";

    const csvRows = rows.map((row) => {
      const d = new Date(row.createdAt);
      const dateStr = d.toISOString().slice(0, 10);
      const timeStr = d.toISOString().slice(11, 16);
      const word = (row.entry as { word?: string } | null)?.word ?? "";
      const author =
        (row.user as { name?: string } | null)?.name ??
        (row.actorType === "pipeline" ? "Pipeline" : "API");
      const changesStr = JSON.stringify(row.changes ?? {}).replace(/"/g, '""');

      return [
        row.id,
        dateStr,
        timeStr,
        row.action,
        row.actorType ?? "",
        row.entryId ?? "",
        `"${word.replace(/"/g, '""')}"`,
        `"${author.replace(/"/g, '""')}"`,
        `"${changesStr}"`,
      ].join(",");
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="audit-log-${date}.csv"`);
    res.send(header + csvRows.join("\n"));
  }

  @Get("recent")
  @ApiOperation({ summary: "Get recent edits with filters and pagination" })
  recentEdits(
    @Query("q") q?: string,
    @Query("action") action?: string,
    @Query("actorType") actorType?: string,
    @Query("period") period?: string,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.adminService.getRecentEdits({ q, action, actorType, period, page, limit });
  }
}
