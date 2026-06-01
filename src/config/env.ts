import os from "node:os";
import path from "node:path";

const workersFromEnv = Number(process.env.WORKERS || 1);
const autoWorkers = Math.max(1, os.availableParallelism?.() || os.cpus().length);

export const env = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || "0.0.0.0",
  pmtilesPath: process.env.PMTILES_PATH || path.join(process.cwd(), "data", "map.pmtiles"),
  workers: workersFromEnv === 0 ? autoWorkers : Math.max(1, workersFromEnv),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  cacheControl:
    process.env.CACHE_CONTROL ||
    (process.env.NODE_ENV === "production"
      ? "public, max-age=3600, stale-while-revalidate=60"
      : "no-store"),
  statRefreshMs: Math.max(1000, Number(process.env.STAT_REFRESH_MS || 10000))
};
