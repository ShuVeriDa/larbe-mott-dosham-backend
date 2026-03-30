import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const key = req.headers["x-api-key"] as string | undefined;
    const expected = this.config.get<string>("IMPORT_API_KEY");

    if (!expected || key !== expected) {
      throw new UnauthorizedException("Invalid API key");
    }
    return true;
  }
}
