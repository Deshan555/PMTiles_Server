import { Router } from "express";
import { toPrometheusText } from "../services/metrics";

export function createSystemRoutes() {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.status(200).json({ status: "ok", worker: process.pid });
  });

  router.get("/metrics", (_req, res) => {
    res.type("text/plain").send(toPrometheusText());
  });

  return router;
}
