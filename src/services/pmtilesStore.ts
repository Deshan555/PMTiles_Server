import fs from "node:fs";

const PMTILES_HEADER_SIZE = 127;
const PMTILES_MAGIC = "PMTiles";
const SUPPORTED_SPEC_VERSION = 3;
const GIT_LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";

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
    const etag = `"${stat.size}-${Number(stat.mtimeMs)}"`;

    if (force || !this.info || this.info.etag !== etag) {
      await this.validateArchive(stat);
    }

    this.info = {
      fileSize: stat.size,
      etag,
      mtimeMs: stat.mtimeMs,
      mtimeUtc: stat.mtime.toUTCString()
    };
    this.lastChecked = now;

    if (this.fd === null) {
      this.fd = fs.openSync(this.filePath, "r");
    }

    return this.info;
  }

  private async validateArchive(stat: fs.Stats): Promise<void> {
    if (!stat.isFile()) {
      throw new Error(`PMTILES_PATH is not a regular file: ${this.filePath}`);
    }

    if (stat.size < PMTILES_HEADER_SIZE) {
      throw new Error(`PMTILES_PATH is too small to be a PMTiles archive: ${this.filePath} (${stat.size} bytes)`);
    }

    const handle = await fs.promises.open(this.filePath, "r");
    const probe = Buffer.alloc(Math.max(PMTILES_HEADER_SIZE, GIT_LFS_POINTER_PREFIX.length));

    try {
      const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
      const textPrefix = probe.subarray(0, bytesRead).toString("utf8");

      if (textPrefix.startsWith(GIT_LFS_POINTER_PREFIX)) {
        throw new Error(
          `PMTILES_PATH points to a Git LFS pointer, not the map archive: ${this.filePath} (${stat.size} bytes). ` +
            "Run git lfs pull on the VM or deploy the real .pmtiles binary."
        );
      }

      if (bytesRead < 8 || probe.subarray(0, 7).toString("ascii") !== PMTILES_MAGIC) {
        throw new Error(`PMTILES_PATH does not have a valid PMTiles header: ${this.filePath} (${stat.size} bytes)`);
      }

      const specVersion = probe.readUInt8(7);
      if (specVersion !== SUPPORTED_SPEC_VERSION) {
        throw new Error(
          `PMTILES_PATH uses unsupported PMTiles spec version ${specVersion}: ${this.filePath}. ` +
            `Expected version ${SUPPORTED_SPEC_VERSION}.`
        );
      }
    } finally {
      await handle.close();
    }
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
