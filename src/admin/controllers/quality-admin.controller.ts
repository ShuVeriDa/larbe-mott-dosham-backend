import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
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

  @Get("problems")
  @ApiOperation({
    summary: "Find problematic entries (empty meanings, missing class, etc.)",
  })
  problems(
    @Query("type") type?: string,
    @Query("limit", new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.adminService.findProblems(type, limit);
  }
}
