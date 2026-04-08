import { Injectable } from "@nestjs/common";
import { PermissionCode } from "@prisma/client";
import { PrismaService } from "src/prisma.service";
import { RedisService } from "src/redis/redis.service";

const PERMS_CACHE_TTL = 60; // 1 минута
const PERMS_CACHE_PREFIX = "perms";

@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getUserPermissions(userId: string): Promise<Set<PermissionCode>> {
    // Проверяем кэш
    try {
      const cached = await this.redis.get(`${PERMS_CACHE_PREFIX}:${userId}`);
      if (cached) return new Set(JSON.parse(cached) as PermissionCode[]);
    } catch {
      // cache miss — продолжаем
    }

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

    // Сохраняем в кэш
    try {
      await this.redis.set(
        `${PERMS_CACHE_PREFIX}:${userId}`,
        JSON.stringify([...permissions]),
        "EX",
        PERMS_CACHE_TTL,
      );
    } catch {
      // cache write failure is not critical
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

  /** Сброс кэша при изменении ролей пользователя */
  async invalidateUserPermissions(userId: string): Promise<void> {
    try {
      await this.redis.del(`${PERMS_CACHE_PREFIX}:${userId}`);
    } catch {
      // non-critical
    }
  }
}
