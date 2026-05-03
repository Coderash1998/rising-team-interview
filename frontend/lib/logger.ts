/**
 * Thin console wrapper so call sites stay readable and so that we can swap
 * in a real logger (Sentry, Datadog) by editing one file. Test environments
 * generally silence `console.log`, so production-relevant signals use info+.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const SCOPE = "[frontend]";

function emit(level: LogLevel, message: string, data?: unknown): void {
  const stamp = new Date().toISOString();
  const prefix = `${SCOPE} ${stamp} ${level.toUpperCase()}`;
  if (data !== undefined) {
    console[level](prefix, message, data);
  } else {
    console[level](prefix, message);
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => emit("debug", msg, data),
  info: (msg: string, data?: unknown) => emit("info", msg, data),
  warn: (msg: string, data?: unknown) => emit("warn", msg, data),
  error: (msg: string, data?: unknown) => emit("error", msg, data),
};
