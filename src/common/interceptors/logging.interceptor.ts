import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { Request } from "express";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const userAgent = req.get("user-agent") ?? "-";
    const ip = req.ip ?? req.socket.remoteAddress;
    const now = Date.now();

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        const statusCode: number = res.statusCode;
        const ms = Date.now() - now;

        this.logger.log(
          `${method} ${url} ${statusCode} ${ms}ms — ${ip} "${userAgent}"`,
        );
      }),
    );
  }
}
