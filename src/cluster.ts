import cluster from "node:cluster";
import { env } from "./config/env";
import { startWorker } from "./server";
import { logger } from "./utils/logger";

async function bootstrap() {
  if (cluster.isPrimary && env.workers > 1) {
    logger.info("cluster_start", { primaryPid: process.pid, workers: env.workers });
    for (let i = 0; i < env.workers; i += 1) {
      cluster.fork();
    }

    cluster.on("exit", (worker) => {
      logger.warn("worker_died_restart", {
        primaryPid: process.pid,
        workerPid: worker.process.pid
      });
      cluster.fork();
    });
  } else {
    await startWorker();
  }
}

bootstrap().catch((error) => {
  logger.error("fatal_startup_error", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
