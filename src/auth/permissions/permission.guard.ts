import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PermissionCode, User as UserPrisma } from "@prisma/client";
import { PermissionsService } from "./permissions.service";
import { PERMISSION_KEY } from "./permission.decorator";

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<PermissionCode>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permission) return true;

    const request = context.switchToHttp().getRequest<{ user?: UserPrisma }>();
    const user = request.user;

    if (!user?.id) throw new ForbiddenException("Access denied");

    const has = await this.permissionsService.hasPermission(
      user.id,
      permission,
    );
    if (!has) throw new ForbiddenException("Access denied");

    return true;
  }
}
