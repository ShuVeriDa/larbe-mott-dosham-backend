import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PermissionCode } from "@prisma/client";
import { AdminPermission } from "src/auth/decorators/admin-permission.decorator";
import { AdminService } from "../admin.service";
import { AssignRoleDto } from "../dto/assign-role.dto";

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
