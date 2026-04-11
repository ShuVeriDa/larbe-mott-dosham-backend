import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import type { LoggerService } from "@nestjs/common";
import type { Response } from "express";
import { WINSTON_MODULE_NEST_PROVIDER } from "nest-winston";
import type { CorrelationRequest } from "../middleware/correlation-id.middleware";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<CorrelationRequest>();
    const res = ctx.getResponse<Response>();
    const correlationId = req.correlationId ?? "unknown";
    const start = req.requestStartMs ?? Date.now();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : "Internal server error";

    if (status >= 500) {
      this.logger.error(
        `[${correlationId}] ${req.method} ${req.url} ${status} — ${message}`,
        exception instanceof Error ? exception.stack : undefined,
        "HTTP",
      );
    } else {
      this.logger.warn(
        `[${correlationId}] ${req.method} ${req.url} ${status} — ${message}`,
        "HTTP",
      );
    }

    const ms = Date.now() - start;
    void ms; // доступно если понадобится метрика

    res.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
      path: req.url,
      correlationId,
    });
  }
}
