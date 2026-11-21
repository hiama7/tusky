import { pino } from "pino";
import { env } from "./env.ts";

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } },
});

export function childLogger(name: string) {
  return logger.child({ svc: name });
}
