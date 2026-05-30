import cors from "cors";
import express from "express";
import statusMonitor from "express-status-monitor";
import { env } from "./config/env";
import { requestMetrics } from "./middleware/requestMetrics";
import { requestLogger } from "./middleware/requestLogger";
import { createSystemRoutes } from "./routes/systemRoutes";
import { createTileRoutes } from "./routes/tileRoutes";
import type { PmtilesStore } from "./services/pmtilesStore";

export function createApp(store: PmtilesStore) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(cors({
    origin: env.corsOrigin,
    exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"]
  }));
  app.use(statusMonitor());
  app.use(express.json({ limit: "1mb" }));

  app.use(requestLogger);
  app.use(requestMetrics);
  app.use(createSystemRoutes());
  app.use(createTileRoutes(store));

  return app;
}
