type LogLevel = "debug" | "info" | "warn" | "error";

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const currentLevel = ((process.env.LOG_LEVEL || "info").toLowerCase() as LogLevel);

function canLog(level: LogLevel): boolean {
  const configured = levelPriority[currentLevel] ?? levelPriority.info;
  return levelPriority[level] >= configured;
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (!canLog(level)) return;

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    pid: process.pid,
    message,
    ...(meta ? { meta } : {})
  };

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta)
};
