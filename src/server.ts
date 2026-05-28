import { createApp } from "./app";
import { env } from "./config/env";
import { PmtilesStore } from "./services/pmtilesStore";
import { logger } from "./utils/logger";

export async function startWorker(): Promise<void> {
  const store = new PmtilesStore(env.pmtilesPath, env.statRefreshMs);
  await store.refresh(true);

  const app = createApp(store);
  const server = app.listen(env.port, env.host, () => {
    logger.info("worker_started", {
      workerPid: process.pid,
      url: `http://${env.host}:${env.port}/tiles/map.pmtiles`
    });
  });

  server.keepAliveTimeout = 75_000;
  server.headersTimeout = 80_000;
  server.requestTimeout = 30_000;

  const shutdown = () => {
    logger.info("worker_shutdown_signal", { workerPid: process.pid });
    server.close(() => {
      store.close();
      logger.info("worker_stopped", { workerPid: process.pid });
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
