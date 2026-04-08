import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import { Response } from "express";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest();

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : "Internal server error";

    const correlationId = req.headers?.["x-correlation-id"] as
      | string
      | undefined;

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} — ${status} [${correlationId ?? "-"}]`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    res.status(status).json(
      typeof message === "object"
        ? {
            ...message,
            timestamp: new Date().toISOString(),
            ...(correlationId ? { correlationId } : {}),
          }
        : {
            statusCode: status,
            message: status >= 500 ? "Internal server error" : message,
            timestamp: new Date().toISOString(),
            ...(correlationId ? { correlationId } : {}),
          },
    );
  }
}
