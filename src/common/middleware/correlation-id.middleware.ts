import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";

export interface CorrelationRequest extends Request {
  correlationId?: string;
  requestStartMs?: number;
}

const HEADER = "x-correlation-id";

export function correlationIdMiddleware(
  req: CorrelationRequest,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.get(HEADER) ?? req.get("x-request-id");
  const correlationId = incoming && incoming.trim() ? incoming : randomUUID();

  req.correlationId = correlationId;
  req.requestStartMs = Date.now();

  res.setHeader(HEADER, correlationId);
  next();
}
