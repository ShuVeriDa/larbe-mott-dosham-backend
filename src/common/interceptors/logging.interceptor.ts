import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { LoggerService } from "@nestjs/common";
import type { Response } from "express";
import { WINSTON_MODULE_NEST_PROVIDER } from "nest-winston";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import type { CorrelationRequest } from "../middleware/correlation-id.middleware";

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<CorrelationRequest>();
    const { method, url } = req;
    const start = req.requestStartMs ?? Date.now();
    const correlationId = req.correlationId ?? "unknown";

    return next.handle().pipe(
      tap({
        next: () => {
          const res = context.switchToHttp().getResponse<Response>();
          const ms = Date.now() - start;
          this.logger.log(
            `[${correlationId}] ${method} ${url} ${res.statusCode} +${ms}ms`,
            "HTTP",
          );
        },
        error: () => {
          // errors are logged in AllExceptionsFilter
        },
      }),
    );
  }
}
