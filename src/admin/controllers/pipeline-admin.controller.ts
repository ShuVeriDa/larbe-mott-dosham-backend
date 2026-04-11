import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "../admin.service";
import { ImproveEntriesDto } from "../dto/improve-entries.dto";

@ApiTags("admin/pipeline")
@Controller("admin/pipeline")
@AdminPermission(PermissionCode.CAN_RUN_PIPELINE)
@ApiBearerAuth()
export class PipelineAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post("parse/:slug")
  @ApiOperation({ summary: "Run parse for a dictionary" })
  parse(@Param("slug") slug: string) {
    return this.adminService.runParse(slug);
  }

  @Post("unify-step/:slug")
  @ApiOperation({ summary: "Run unify-step for a dictionary" })
  unifyStep(@Param("slug") slug: string) {
    return this.adminService.runUnifyStep(slug);
  }

  @Post("load")
  @ApiOperation({ summary: "Load unified.json into database" })
  load(@Req() req: any) {
    return this.adminService.runLoad(req.user?.id as string | undefined);
  }

  @Post("improve")
  @ApiOperation({ summary: "Run improve on unified.json" })
  improve(@Req() req: any) {
    return this.adminService.runImprove(req.user?.id as string | undefined);
  }

  @Post("improve-entries")
  @ApiOperation({ summary: "Run improve on specific DB entries by IDs (max 500)" })
  improveEntries(@Body() body: ImproveEntriesDto, @Req() req: any) {
    return this.adminService.runImproveEntries(body.ids, req.user?.id as string | undefined);
  }

  @Post("rollback/:step")
  @ApiOperation({ summary: "Rollback to a specific step" })
  rollback(@Param("step", ParseIntPipe) step: number, @Req() req: any) {
    return this.adminService.runRollback(step, req.user?.id as string | undefined);
  }

  @Post("reset")
  @ApiOperation({ summary: "Reset all merge steps" })
  reset() {
    return this.adminService.runReset();
  }

  @Get("status")
  @ApiOperation({ summary: "Pipeline status: isRunning, currentOperation, lastRun, parsed files, unified file, DB count" })
  status() {
    return this.adminService.getPipelineStatus();
  }

  @Get("unified-log")
  @ApiOperation({ summary: "Merge log: completed steps, remaining slugs, nextRecommended" })
  unifiedLog() {
    return this.adminService.getUnifiedLog();
  }

  @Get("parsed-files")
  @ApiOperation({ summary: "List parsed JSON files with size and modification date" })
  parsedFiles() {
    return this.adminService.getParsedFiles();
  }

  @Get("log")
  @ApiOperation({ summary: "In-memory pipeline operation log (last 100 entries)" })
  pipelineLog() {
    return this.adminService.getPipelineLog();
  }

  @Delete("log")
  @ApiOperation({ summary: "Clear in-memory pipeline operation log" })
  clearLog() {
    return this.adminService.clearPipelineLog();
  }

  @Get("load-history")
  @ApiOperation({ summary: "Load runs history from DB (last N entries, default 20)" })
  loadHistory(@Query("limit") limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? "20", 10) || 20, 1), 100);
    return this.adminService.getLoadHistory(n);
  }

  @Get("improve-history")
  @ApiOperation({ summary: "Improve runs history from DB (last N entries, default 20)" })
  improveHistory(@Query("limit") limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? "20", 10) || 20, 1), 100);
    return this.adminService.getImproveHistory(n);
  }
}
