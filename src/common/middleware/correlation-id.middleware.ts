import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

const HEADER = "x-correlation-id";

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id = (req.get(HEADER) as string | undefined) ?? randomUUID();
    req.headers[HEADER] = id;
    res.setHeader(HEADER, id);
    next();
  }
}
