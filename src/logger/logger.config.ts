import * as fs from "fs";
import * as winston from "winston";

// Цвета уровней — точно как в NestJS ConsoleLogger
const LEVEL_COLOR: Record<string, string> = {
  info:    "\x1b[32m", // green  → LOG
  error:   "\x1b[31m", // red    → ERROR
  warn:    "\x1b[33m", // yellow → WARN
  debug:   "\x1b[35m", // magenta → DEBUG
  verbose: "\x1b[36m", // cyan   → VERBOSE
};

const LEVEL_LABEL: Record<string, string> = {
  info:    "LOG",
  error:   "ERROR",
  warn:    "WARN",
  debug:   "DEBUG",
  verbose: "VERBOSE",
};

const YELLOW = "\x1b[33m";
const RESET  = "\x1b[0m";
const pid    = process.pid;

// ── Dev format — идентичен виду NestJS дефолтного логгера ────────────────────
//
//  [Nest] 12345  - 23/03/2025, 10:30:01     LOG [Bootstrap] Application is running...
//  [Nest] 12345  - 23/03/2025, 10:30:02     LOG [HTTP] GET /api/dictionary/search 200 +23ms
//  [Nest] 12345  - 23/03/2025, 10:30:03    WARN [HTTP] POST /api/auth/login 401 — Invalid password
//  [Nest] 12345  - 23/03/2025, 10:30:04   ERROR [HTTP] GET /api/dictionary/xyz 500 — Internal server error
//
const devFormat = winston.format.combine(
  winston.format.timestamp({
    format: () =>
      new Date().toLocaleString("ru-RU", {
        day:    "2-digit",
        month:  "2-digit",
        year:   "numeric",
        hour:   "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, context, stack }) => {
    const color = LEVEL_COLOR[level] ?? "\x1b[32m";
    const label = (LEVEL_LABEL[level] ?? level.toUpperCase()).padStart(7);

    const prefix  = `${color}[Nest] ${pid}${RESET}  - ${String(timestamp)}`;
    const lvl     = `${color}${label}${RESET}`;
    const ctx     = context ? ` ${YELLOW}[${String(context)}]${RESET}` : "";
    const trace   = stack
      ? `\n${RESET}${String(stack)}`
      : "";

    return `${prefix}   ${lvl}${ctx} ${String(message)}${trace}`;
  }),
);

// ── Prod format (JSON) ────────────────────────────────────────────────────────
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

// ── Export ────────────────────────────────────────────────────────────────────
export function createWinstonOptions(nodeEnv?: string): winston.LoggerOptions {
  const isDev = nodeEnv !== "production";

  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: isDev ? devFormat : prodFormat,
    }),
  ];

  if (!isDev) {
    fs.mkdirSync("logs", { recursive: true });
    transports.push(
      new winston.transports.File({
        filename: "logs/error.log",
        level:    "error",
        format:   prodFormat,
      }),
      new winston.transports.File({
        filename: "logs/combined.log",
        format:   prodFormat,
      }),
    );
  }

  return {
    level:      isDev ? "debug" : "info",
    transports,
  };
}
