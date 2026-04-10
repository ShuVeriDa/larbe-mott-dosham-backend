import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
import type { Response } from "express";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "../admin.service";
import { BatchFetchEntriesDto } from "../dto/batch-fetch-entries.dto";
import { BulkDeleteEntriesDto } from "../dto/bulk-delete-entries.dto";

@ApiTags("admin/entries")
@Controller("admin/entries")
@ApiBearerAuth()
export class EntriesAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiOperation({ summary: "List entries with filters (pos, nounClass, source, cefr, limit≤100)" })
  listEntries(
    @Query("pos") pos?: string,
    @Query("nounClass") nounClass?: string,
    @Query("source") source?: string,
    @Query("cefr") cefr?: string,
    @Query("limit") limit?: string,
  ) {
    return this.adminService.listEntries({
      pos,
      nounClass,
      source,
      cefr,
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
    });
  }

  @Post("batch-fetch")
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiOperation({ summary: "Batch-fetch current field values for up to 100 entry IDs (for bulk-update preview)" })
  batchFetch(@Body() dto: BatchFetchEntriesDto) {
    return this.adminService.batchFetchEntries(dto.ids);
  }

  @Get("stats")
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiOperation({ summary: "Entries stats: total, byPos (noun/verb/adj/adv/other), sourcesCount, updatedToday" })
  stats() {
    return this.adminService.entriesStats();
  }

  @Get(":id/adjacent")
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiOperation({ summary: "Get prev/next entry IDs relative to given ID (for navigation)" })
  adjacent(@Param("id", ParseIntPipe) id: number) {
    return this.adminService.getAdjacentEntries(id);
  }

  @Delete("bulk")
  @AdminPermission(PermissionCode.CAN_DELETE_ENTRIES)
  @ApiOperation({ summary: "Bulk delete entries by IDs (max 100)" })
  bulkDelete(@Body() dto: BulkDeleteEntriesDto) {
    return this.adminService.bulkDeleteEntries(dto.ids);
  }

  @Get("export")
  @AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
  @ApiOperation({ summary: "Export entries as JSON or CSV (format=json|csv)" })
  async export(
    @Query("format") format: string | undefined,
    @Query("q") q: string | undefined,
    @Query("pos") pos: string | undefined,
    @Query("source") source: string | undefined,
    @Query("cefr") cefr: string | string[] | undefined,
    @Query("nounClass") nounClass: string | undefined,
    @Res() res: Response,
  ) {
    const cefrArr = cefr
      ? Array.isArray(cefr)
        ? cefr
        : typeof cefr === "string" && cefr.includes(",")
          ? cefr.split(",").map((v) => v.trim())
          : [cefr]
      : undefined;

    const rows = await this.adminService.exportEntries({ q, pos, source, cefr: cefrArr, nounClass });

    const fmt = format === "csv" ? "csv" : "json";

    if (fmt === "csv") {
      const header = "id,word,partOfSpeech,nounClass,cefrLevel,entryType,sources,domain,updatedAt\n";
      const csvRows = (rows as Record<string, unknown>[]).map((row) =>
        [
          row["id"],
          `"${String(row["word"]).replace(/"/g, '""')}"`,
          row["partOfSpeech"] ?? "",
          row["nounClass"] ?? "",
          row["cefrLevel"] ?? "",
          row["entryType"] ?? "",
          `"${(row["sources"] as string[]).join("|")}"`,
          row["domain"] ?? "",
          new Date(row["updatedAt"] as string).toISOString(),
        ].join(","),
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="entries.csv"');
      res.send(header + csvRows.join("\n"));
    } else {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="entries.json"');
      res.send(JSON.stringify(rows, null, 2));
    }
  }
}
