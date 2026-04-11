import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode, RoleName } from "@prisma/client";
import type { Response } from "express";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "../admin.service";
import { AssignRoleDto } from "../dto/assign-role.dto";
import { BlockUserDto } from "../dto/block-user.dto";
import { ListUsersDto } from "../dto/list-users.dto";
import { UpdateUserDto } from "../dto/update-user.dto";

@ApiTags("admin/users")
@Controller("admin/users")
@AdminPermission(PermissionCode.CAN_MANAGE_USERS)
@ApiBearerAuth()
export class UsersAdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("stats")
  @ApiOperation({ summary: "User stats: total, active, inactive, blocked, newThisMonth, byRole" })
  getUserStats() {
    return this.adminService.getUserStats();
  }

  @Get("export")
  @ApiOperation({ summary: "Export users as CSV with current filters" })
  async exportUsers(
    @Query("q") q: string | undefined,
    @Query("role") role: string | undefined,
    @Query("status") status: string | undefined,
    @Res() res: Response,
  ) {
    const validRole = Object.values(RoleName).includes(role as RoleName) ? (role as RoleName) : undefined;
    const rows = await this.adminService.exportUsers({ q, role: validRole, status });

    const date = new Date().toISOString().slice(0, 10);
    const header = "id,name,email,username,status,roles,createdAt,lastLoggedIn\n";
    const csvRows = rows.map((u) =>
      [
        u.id,
        `"${u.name.replace(/"/g, '""')}"`,
        `"${u.email.replace(/"/g, '""')}"`,
        u.username,
        u.status,
        `"${u.roles.map((r) => r.role.name).join("|")}"`,
        new Date(u.createdAt).toISOString(),
        u.lastLoggedIn ? new Date(u.lastLoggedIn).toISOString() : "",
      ].join(","),
    );

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="users-export-${date}.csv"`);
    res.send(header + csvRows.join("\n"));
  }

  @Get()
  @ApiOperation({ summary: "List users with pagination, search, filters, sorting" })
  listUsers(@Query() dto: ListUsersDto) {
    return this.adminService.listUsers({
      q: dto.q,
      role: dto.role,
      status: dto.status,
      page: dto.page,
      limit: dto.limit,
      sortBy: dto.sortBy,
      sortDir: dto.sortDir,
    });
  }

  @Get(":id")
  @ApiOperation({ summary: "Get user profile with last session IP/UA" })
  getUser(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.getUser(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update user profile (name, username, email, role, status)" })
  updateUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete user account (cascades all related data)" })
  deleteUser(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.deleteUser(id);
  }

  @Patch(":id/role")
  @ApiOperation({ summary: "Assign role to user" })
  assignRole(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.adminService.assignRole(id, dto.role);
  }

  @Delete(":id/role")
  @ApiOperation({ summary: "Remove role from user" })
  removeRole(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.adminService.removeRole(id, dto.role);
  }

  @Patch(":id/block")
  @ApiOperation({ summary: "Block a user (optionally with reason)" })
  blockUser(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: BlockUserDto,
  ) {
    return this.adminService.setUserStatus(id, "blocked", dto.banReason);
  }

  @Patch(":id/unblock")
  @ApiOperation({ summary: "Unblock a user" })
  unblockUser(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.setUserStatus(id, "active");
  }

  @Post(":id/reset-password")
  @HttpCode(200)
  @ApiOperation({ summary: "Trigger password reset for user (creates reset token)" })
  resetPassword(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.resetPasswordByAdmin(id);
  }

  @Get(":id/sessions")
  @ApiOperation({ summary: "List active sessions for a user" })
  getSessions(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.getAdminUserSessions(id);
  }

  @Delete(":id/sessions")
  @ApiOperation({ summary: "Revoke all sessions for a user" })
  revokeAllSessions(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.revokeAllAdminUserSessions(id);
  }

  @Delete(":id/sessions/:sessionId")
  @ApiOperation({ summary: "Revoke a specific session for a user" })
  revokeSession(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
  ) {
    return this.adminService.revokeAdminUserSession(id, sessionId);
  }

  @Get(":id/stats")
  @ApiOperation({ summary: "Get aggregated activity stats for a user" })
  getUserActivityStats(@Param("id", ParseUUIDPipe) id: string) {
    return this.adminService.getUserActivityStats(id);
  }

  @Get(":id/activity")
  @ApiOperation({ summary: "Get chronological activity feed for a user" })
  getUserActivity(
    @Param("id", ParseUUIDPipe) id: string,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number,
    @Query("offset", new ParseIntPipe({ optional: true })) offset?: number,
  ) {
    return this.adminService.getUserActivity(id, limit ?? 20, offset ?? 0);
  }
}
