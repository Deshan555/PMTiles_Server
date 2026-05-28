import { Router } from "express";
import { env } from "../config/env";
import { respondTileGet, respondTileHead } from "../services/tileResponder";
import type { PmtilesStore } from "../services/pmtilesStore";

export function createTileRoutes(store: PmtilesStore) {
  const router = Router();

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

  return router;
}
