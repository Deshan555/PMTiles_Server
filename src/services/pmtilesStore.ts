import fs from "node:fs";

export interface PmtilesInfo {
  fileSize: number;
  etag: string;
  mtimeMs: number;
  mtimeUtc: string;
}

export class PmtilesStore {
  private fd: number | null = null;
  private info: PmtilesInfo | null = null;
  private lastChecked = 0;

  constructor(
    private readonly filePath: string,
    private readonly statRefreshMs: number
  ) {}

  async refresh(force = false): Promise<PmtilesInfo> {
    const now = Date.now();
    if (!force && this.info && now - this.lastChecked < this.statRefreshMs) {
      return this.info;
    }

    const stat = await fs.promises.stat(this.filePath);
    this.info = {
      fileSize: stat.size,
      etag: `"${stat.size}-${Number(stat.mtimeMs)}"`,
      mtimeMs: stat.mtimeMs,
      mtimeUtc: stat.mtime.toUTCString()
    };
    this.lastChecked = now;

    if (this.fd === null) {
      this.fd = fs.openSync(this.filePath, "r");
    }

    return this.info;
  }

  getFilePath(): string {
    return this.filePath;
  }

  getFd(): number {
    if (this.fd === null) {
      throw new Error("PMTiles file descriptor is not open");
    }
    return this.fd;
  }

  close(): void {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}
