import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode, RoleName } from "@prisma/client";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "./admin.service";

// -----------------------------------------------------------------------
// API Keys
// -----------------------------------------------------------------------

@ApiTags("admin/api-keys")
@Controller("admin/api-keys")
@AdminPermission(PermissionCode.CAN_MANAGE_API_KEYS)
@ApiBearerAuth()
export class ApiKeysController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: "List all API keys" })
  listKeys() {
    return this.adminService.listApiKeys();
  }

  @Post()
  @ApiOperation({ summary: "Create a new API key" })
  createKey(@Body() body: { name: string; role?: RoleName }) {
    return this.adminService.createApiKey(body.name, body.role);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update API key (activate/deactivate, rename)" })
  updateKey(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { name?: string; isActive?: boolean; role?: RoleName },
  ) {
    return this.adminService.updateApiKey(id, body);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete an API key" })
  deleteKey(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.deleteApiKey(id);
  }
}

// -----------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------

@ApiTags("admin/users")
@Controller("admin/users")
@AdminPermission(PermissionCode.CAN_MANAGE_USERS)
@ApiBearerAuth()
export class UsersAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: "List all users" })
  listUsers() {
    return this.adminService.listUsers();
  }

  @Patch(":id/role")
  @ApiOperation({ summary: "Assign role to user" })
  assignRole(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { role: RoleName },
  ) {
    return this.adminService.assignRole(id, body.role);
  }

  @Delete(":id/role")
  @ApiOperation({ summary: "Remove role from user" })
  removeRole(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { role: RoleName },
  ) {
    return this.adminService.removeRole(id, body.role);
  }

  @Patch(":id/block")
  @ApiOperation({ summary: "Block a user" })
  blockUser(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.setUserStatus(id, "blocked");
  }

  @Patch(":id/unblock")
  @ApiOperation({ summary: "Unblock a user" })
  unblockUser(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.setUserStatus(id, "active");
  }
}

// -----------------------------------------------------------------------
// Pipeline
// -----------------------------------------------------------------------

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
  load() {
    return this.adminService.runLoad();
  }

  @Post("improve")
  @ApiOperation({ summary: "Run improve on unified.json" })
  improve() {
    return this.adminService.runImprove();
  }

  @Post("rollback/:step")
  @ApiOperation({ summary: "Rollback to a specific step" })
  rollback(@Param("step") step: string) {
    return this.adminService.runRollback(Number(step));
  }

  @Post("reset")
  @ApiOperation({ summary: "Reset all merge steps" })
  reset() {
    return this.adminService.runReset();
  }
}

// -----------------------------------------------------------------------
// Data Quality & Audit
// -----------------------------------------------------------------------

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
  problems(@Query("type") type?: string, @Query("limit") limit?: number) {
    return this.adminService.findProblems(type, limit ? Number(limit) : 50);
  }
}

@ApiTags("admin/audit")
@Controller("admin/audit")
@AdminPermission(PermissionCode.CAN_EDIT_ENTRIES)
@ApiBearerAuth()
export class AuditAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("entries/:entryId")
  @ApiOperation({ summary: "Get edit history for an entry" })
  entryHistory(@Param("entryId") entryId: string) {
    return this.adminService.getEntryEditHistory(Number(entryId));
  }

  @Get("recent")
  @ApiOperation({ summary: "Get recent edits across all entries" })
  recentEdits(@Query("limit") limit?: number) {
    return this.adminService.getRecentEdits(limit ? Number(limit) : 50);
  }
}
