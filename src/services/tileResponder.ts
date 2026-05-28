import fs from "node:fs";
import type { Request, Response } from "express";
import mime from "mime-types";
import { parseByteRange } from "../utils/parseRange";
import { metrics } from "./metrics";
import type { PmtilesStore } from "./pmtilesStore";

function setCommonHeaders(res: Response, filePath: string, etag: string, mtimeUtc: string, cacheControl: string): void {
  res.setHeader("Content-Type", mime.lookup(filePath) || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("ETag", etag);
  res.setHeader("Last-Modified", mtimeUtc);
}

function isNotModified(req: Request, etag: string, mtimeMs: number): boolean {
  const inm = req.headers["if-none-match"];
  if (typeof inm === "string" && inm === etag) return true;

  const ims = req.headers["if-modified-since"];
  if (typeof ims === "string") {
    const since = new Date(ims).getTime();
    if (!Number.isNaN(since) && mtimeMs <= since) return true;
  }

  return false;
}

export async function respondTileHead(req: Request, res: Response, store: PmtilesStore, cacheControl: string): Promise<void> {
  const info = await store.refresh();
  setCommonHeaders(res, store.getFilePath(), info.etag, info.mtimeUtc, cacheControl);

  if (isNotModified(req, info.etag, info.mtimeMs)) {
    res.status(304).end();
    return;
  }

  res.setHeader("Content-Length", info.fileSize);
  res.status(200).end();
}

export async function respondTileGet(req: Request, res: Response, store: PmtilesStore, cacheControl: string): Promise<void> {
  const info = await store.refresh();
  setCommonHeaders(res, store.getFilePath(), info.etag, info.mtimeUtc, cacheControl);

  if (isNotModified(req, info.etag, info.mtimeMs)) {
    res.status(304).end();
    return;
  }

  const parsed = parseByteRange(req.headers.range, info.fileSize);

  if (parsed.kind === "invalid") {
    res.status(400).json({ error: "Invalid Range header" });
    return;
  }

  if (parsed.kind === "unsatisfiable") {
    res.status(416).setHeader("Content-Range", `bytes */${info.fileSize}`).end();
    return;
  }

  if (parsed.kind === "none") {
    metrics.fullRequests += 1;
    res.setHeader("Content-Length", info.fileSize);
    const stream = fs.createReadStream(store.getFilePath(), { fd: store.getFd(), autoClose: false });
    stream.on("data", (chunk) => {
      metrics.bytesSentTotal += chunk.length;
    });
    stream.on("error", () => res.destroy());
    stream.pipe(res);
    return;
  }

  metrics.rangeRequests += 1;
  const chunkSize = parsed.end - parsed.start + 1;
  res.status(206);
  res.setHeader("Content-Range", `bytes ${parsed.start}-${parsed.end}/${info.fileSize}`);
  res.setHeader("Content-Length", chunkSize);

  const stream = fs.createReadStream(store.getFilePath(), {
    start: parsed.start,
    end: parsed.end,
    fd: store.getFd(),
    autoClose: false
  });
  stream.on("data", (chunk) => {
    metrics.bytesSentTotal += chunk.length;
  });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}
