import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RoleName } from "@prisma/client";
import { PrismaService } from "src/prisma.service";

export const API_KEY_ROLES_KEY = "apiKeyRoles";

/**
 * Guard для межсервисного доступа через API-ключи.
 *
 * Проверяет X-API-Key в заголовке, ищет ключ в БД,
 * проверяет что роль ключа входит в список допустимых.
 *
 * Использование:
 *   @UseGuards(ApiKeyGuard)
 *   @SetMetadata('apiKeyRoles', [RoleName.EDITOR, RoleName.ADMIN])
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = req.headers["x-api-key"] as string | undefined;

    if (!key) throw new UnauthorizedException("API key required");

    const apiKey = await this.prisma.apiKey.findUnique({ where: { key } });

    if (!apiKey || !apiKey.isActive) {
      throw new UnauthorizedException("Invalid or inactive API key");
    }

    // Проверяем допустимые роли (если заданы через @SetMetadata)
    const allowedRoles = this.reflector.get<RoleName[] | undefined>(
      API_KEY_ROLES_KEY,
      ctx.getHandler(),
    );

    if (allowedRoles && !allowedRoles.includes(apiKey.role)) {
      throw new UnauthorizedException("Insufficient API key permissions");
    }

    // Обновляем lastUsedAt (fire-and-forget)
    this.prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});

    // Прикрепляем информацию о ключе к запросу
    (req as any).apiKey = apiKey;

    return true;
  }
}
