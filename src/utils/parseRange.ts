import type { ParsedRange } from "../types/range";

export function parseByteRange(rangeHeader: string | undefined, fileSize: number): ParsedRange {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return { kind: "none" };
  }

  const raw = rangeHeader.slice(6).split(",")[0]?.trim();
  if (!raw) return { kind: "invalid" };

  const [startRaw, endRaw] = raw.split("-");

  let start: number;
  let end: number;

  if (startRaw === "" && endRaw) {
    const suffixLen = Number(endRaw);
    if (!Number.isInteger(suffixLen) || suffixLen <= 0) return { kind: "invalid" };
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Number(endRaw) : fileSize - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end)) return { kind: "invalid" };
  if (start < 0 || end < start || start >= fileSize || end >= fileSize) {
    return { kind: "unsatisfiable" };
  }

  return { kind: "bytes", start, end };
}
