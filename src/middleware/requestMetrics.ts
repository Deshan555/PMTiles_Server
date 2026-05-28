import type { Request, Response, NextFunction } from "express";
import { metrics } from "../services/metrics";

export function requestMetrics(req: Request, res: Response, next: NextFunction): void {
  metrics.requestsTotal += 1;
  metrics.requestsActive += 1;

  res.on("finish", () => {
    metrics.requestsActive -= 1;
  });

  next();
}
