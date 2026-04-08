import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtAuthGuard } from "src/auth/guards/jwt-auth.guard";
import { ApiKeyGuard } from "./api-key.guard";

/**
 * Комбинированный guard: пропускает если есть валидный JWT ИЛИ API-ключ.
 * Полезно для эндпоинтов, которые используются и из браузера (JWT),
 * и из других сервисов (API-ключ).
 */
@Injectable()
export class JwtOrApiKeyGuard implements CanActivate {
  constructor(
    private readonly jwtGuard: JwtAuthGuard,
    private readonly apiKeyGuard: ApiKeyGuard,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();

    // Если есть X-API-Key — пробуем API-ключ
    if (req.headers["x-api-key"]) {
      return this.apiKeyGuard.canActivate(ctx);
    }

    // Иначе — пробуем JWT
    try {
      const result = this.jwtGuard.canActivate(ctx);
      if (result instanceof Promise) return await result;
      return result as boolean;
    } catch {
      throw new UnauthorizedException(
        "Provide a valid JWT token or X-API-Key header",
      );
    }
  }
}
