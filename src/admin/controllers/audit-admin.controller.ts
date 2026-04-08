import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
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

  @Get("recent")
  @ApiOperation({ summary: "Get recent edits across all entries" })
  recentEdits(
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.adminService.getRecentEdits(limit);
  }
}
