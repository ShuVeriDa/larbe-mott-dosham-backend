import { Injectable } from "@nestjs/common";
import { PermissionCode } from "@prisma/client";
import { PrismaService } from "src/prisma.service";

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getUserPermissions(userId: string): Promise<Set<PermissionCode>> {
    const assignments = await this.prisma.userRoleAssignment.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            permissions: {
              select: {
                permission: { select: { code: true } },
              },
            },
          },
        },
      },
    });

    const permissions = new Set<PermissionCode>();
    for (const a of assignments) {
      for (const rp of a.role.permissions) {
        permissions.add(rp.permission.code);
      }
    }
    return permissions;
  }

  async hasPermission(
    userId: string,
    permission: PermissionCode,
  ): Promise<boolean> {
    const perms = await this.getUserPermissions(userId);
    return perms.has(permission);
  }
}
