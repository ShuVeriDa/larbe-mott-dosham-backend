import { applyDecorators, UseGuards } from "@nestjs/common";
import { PermissionCode } from "@prisma/client";
import { JwtAuthGuard } from "../guards/jwt-auth.guard";
import { RequirePermission } from "../permissions/permission.decorator";
import { PermissionGuard } from "../permissions/permission.guard";

export const AdminPermission = (permission: PermissionCode) =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PermissionGuard),
    RequirePermission(permission),
  );
