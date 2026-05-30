import { Router } from "express";
import { env } from "../config/env";
import { metrics } from "../services/metrics";
import { respondTileGet, respondTileHead } from "../services/tileResponder";
import type { PmtilesStore } from "../services/pmtilesStore";
import { solveRoutesFromPmtilesFile, type RoutingSolveRequest } from "../services/routingService";

export function createTileRoutes(store: PmtilesStore) {
  const router = Router();

  const errorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      const core = error.message?.trim() || error.name || "Unknown Error";
      return `${core}${error.stack ? ` | ${error.stack.split("\n")[0]}` : ""}`;
    }
    return String(error);
  };

  router.get("/readyz", async (_req, res) => {
    try {
      const info = await store.refresh();
      res.status(200).json({
        ready: true,
        file: store.getFilePath(),
        size: info.fileSize
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(503).json({ ready: false, error: message });
    }
  });

  router
    .route("/tiles/map.pmtiles")
    .head(async (req, res) => {
      try {
        await respondTileHead(req, res, store, env.cacheControl);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        res.status(500).json({ error: `Cannot read PMTiles file: ${message}` });
      }
    })
    .get(async (req, res) => {
      try {
        await respondTileGet(req, res, store, env.cacheControl);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        res.status(500).json({ error: `Cannot read PMTiles file: ${message}` });
      }
    });

  router.post("/routing/solve", async (req, res) => {
    const started = Date.now();
    metrics.routingRequestsTotal += 1;
    try {
      const payload = req.body as RoutingSolveRequest | undefined;
      if (!payload || !Array.isArray(payload.routes)) {
        res.status(400).json({ error: "Invalid request body. Expected { routes: [...] }" });
        return;
      }
      if (payload.routes.some((route) => !route || typeof route.id !== "string" || !Array.isArray(route.stops))) {
        res.status(400).json({ error: "Invalid route entries. Each route must have string id and stops array." });
        return;
      }

      const response = await solveRoutesFromPmtilesFile(store.getFilePath(), payload);
      if (response.cacheHit) {
        metrics.routingCacheHitsTotal += 1;
      }
      metrics.routingDurationMsTotal += Date.now() - started;
      res.status(200).json(response);
    } catch (error) {
      metrics.routingErrorsTotal += 1;
      metrics.routingDurationMsTotal += Date.now() - started;
      const message = errorMessage(error);
      res.status(500).json({ error: `Routing solve failed: ${message}` });
    }
  });

  return router;
}
