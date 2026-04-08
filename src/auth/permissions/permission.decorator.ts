import { SetMetadata } from "@nestjs/common";
import { PermissionCode } from "@prisma/client";

export const PERMISSION_KEY = "permission";

export const RequirePermission = (permission: PermissionCode) =>
  SetMetadata(PERMISSION_KEY, permission);
