#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${PID_FILE:-$ROOT_DIR/.pmtiles-server.pid}"
LOG_FILE="${LOG_FILE:-$ROOT_DIR/logs/pmtiles-server.log}"

PORT="${PORT:-8080}"
HOST="${HOST:-0.0.0.0}"
PMTILES_PATH="${PMTILES_PATH:-$ROOT_DIR/data/map.pmtiles}"
WORKERS="${WORKERS:-0}"
NODE_ENV="${NODE_ENV:-production}"
CORS_ORIGIN="${CORS_ORIGIN:-*}"
CACHE_CONTROL="${CACHE_CONTROL:-public, max-age=86400, stale-while-revalidate=3600}"
STAT_REFRESH_MS="${STAT_REFRESH_MS:-10000}"

case "$PMTILES_PATH" in
  /*) ;;
  *) PMTILES_PATH="$ROOT_DIR/$PMTILES_PATH" ;;
esac

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<USAGE
PMTiles Server helper

Usage:
  ./pmtiles-server.sh <command>

Commands:
  check       Verify local files, runtime tools, and map data
  validate-pmtiles
              Verify PMTILES_PATH has a real PMTiles v3 archive header
  install     Install dependencies with npm ci
  build       Compile TypeScript into dist/
  start       Start compiled server in the background
  stop        Stop the helper-managed server process
  kill-port   Kill any process listening on PORT
  restart     Stop then start
  status      Show PID and port status
  verify      Call /healthz, /readyz, and range-test /tiles/map.pmtiles
  logs        Tail the helper log file

Useful env:
  PORT=8080
  HOST=0.0.0.0
  PMTILES_PATH=$ROOT_DIR/data/map.pmtiles
  WORKERS=0
  CORS_ORIGIN=https://your-frontend-domain.com

Examples:
  PORT=9090 ./pmtiles-server.sh start
  PMTILES_PATH=/srv/localtiles/data/map.pmtiles ./pmtiles-server.sh check
  BASE_URL=https://api.example.com ./pmtiles-server.sh verify
USAGE
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but was not found"
}

require_file() {
  local file="$1"
  local label="${2:-$1}"

  if [[ ! -s "$file" ]]; then
    fail "Missing or empty $label: $file"
  fi

  log "OK $label"
}

human_size() {
  if command -v du >/dev/null 2>&1; then
    du -h "$1" | awk '{print $1}'
  else
    wc -c < "$1"
  fi
}

check_node() {
  require_command node

  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"
  if (( major < 20 )); then
    fail "Node.js 20+ is required; found $(node -v)"
  fi

  log "OK Node.js $(node -v)"
}

validate_pmtiles_archive() {
  require_file "$PMTILES_PATH" "PMTiles file"

  case "$PMTILES_PATH" in
    *.pmtiles|*.pmtile)
      log "OK PMTiles filename extension"
      ;;
    *)
      log "WARN PMTiles file extension is not .pmtiles or .pmtile: $PMTILES_PATH"
      ;;
  esac

  node - "$PMTILES_PATH" <<'NODE'
const fs = require("fs");

const HEADER_SIZE_BYTES = 127;
const filePath = process.argv[2];

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function readUint64(header, offset, label) {
  const value = header.readBigUInt64LE(offset);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(`${label} is too large to validate safely: ${value.toString()}`);
  }
  return Number(value);
}

function checkRange(name, offset, length, fileSize) {
  if (length === 0) {
    if (name === "root directory") {
      fail("root directory length is zero");
    }
    return;
  }
  if (offset < HEADER_SIZE_BYTES) {
    fail(`${name} offset ${offset} points inside the PMTiles header`);
  }
  if (offset + length > fileSize) {
    fail(`${name} range ${offset}+${length} exceeds file size ${fileSize}`);
  }
}

async function runPmtilesLibraryCheck(filePath) {
  let pmtiles;
  try {
    pmtiles = require("pmtiles");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      console.log("WARN pmtiles npm package is not installed; skipped parser compatibility check");
      return;
    }
    throw error;
  }

  class LocalFileSource {
    constructor(path) {
      this.path = path;
    }

    getKey() {
      return this.path;
    }

    async getBytes(offset, length) {
      const handle = await fs.promises.open(this.path, "r");
      try {
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        const bytes = Uint8Array.from(buffer.subarray(0, bytesRead));
        return { data: bytes.buffer };
      } finally {
        await handle.close();
      }
    }
  }

  const archive = new pmtiles.PMTiles(new LocalFileSource(filePath));
  const parsedHeader = await archive.getHeader();
  if (parsedHeader.specVersion !== 3) {
    fail(`pmtiles parser returned unsupported spec version ${parsedHeader.specVersion}`);
  }

  console.log(
    `OK pmtiles parser read archive root directory (z${parsedHeader.minZoom}-${parsedHeader.maxZoom}, tileType ${parsedHeader.tileType})`
  );
}

const stat = fs.statSync(filePath);
if (!stat.isFile()) {
  fail(`PMTILES_PATH is not a regular file: ${filePath}`);
}
if (stat.size < HEADER_SIZE_BYTES) {
  fail(`file is too small to be a PMTiles archive: ${stat.size} bytes`);
}

const fd = fs.openSync(filePath, "r");
const header = Buffer.alloc(HEADER_SIZE_BYTES);
try {
  const bytesRead = fs.readSync(fd, header, 0, HEADER_SIZE_BYTES, 0);
  if (bytesRead !== HEADER_SIZE_BYTES) {
    fail(`could not read full PMTiles header: ${bytesRead}/${HEADER_SIZE_BYTES} bytes`);
  }
} finally {
  fs.closeSync(fd);
}

const magic = header.subarray(0, 7).toString("ascii");
if (magic !== "PMTiles") {
  const textPrefix = header.toString("utf8");
  if (textPrefix.startsWith("version https://git-lfs.github.com/spec/v1")) {
    fail(
      `PMTILES_PATH is a Git LFS pointer, not the map archive: ${filePath} (${stat.size} bytes). ` +
      "Run git lfs pull on the VM or deploy the real .pmtiles binary."
    );
  }

  const firstBytes = header.subarray(0, 8).toString("hex");
  fail(`wrong magic bytes. Expected "PMTiles"; first 8 bytes are 0x${firstBytes}`);
}

const specVersion = header.readUInt8(7);
if (specVersion !== 3) {
  fail(`unsupported PMTiles spec version ${specVersion}. PMTiles_Server expects spec v3`);
}

const ranges = [
  ["root directory", readUint64(header, 8, "root directory offset"), readUint64(header, 16, "root directory length")],
  ["JSON metadata", readUint64(header, 24, "JSON metadata offset"), readUint64(header, 32, "JSON metadata length")],
  ["leaf directory", readUint64(header, 40, "leaf directory offset"), readUint64(header, 48, "leaf directory length")],
  ["tile data", readUint64(header, 56, "tile data offset"), readUint64(header, 64, "tile data length")],
];

for (const [name, offset, length] of ranges) {
  checkRange(name, offset, length, stat.size);
}

const minZoom = header.readUInt8(100);
const maxZoom = header.readUInt8(101);
if (minZoom > maxZoom) {
  fail(`invalid zoom range: minZoom ${minZoom} is greater than maxZoom ${maxZoom}`);
}

const minLon = header.readInt32LE(102) / 10_000_000;
const minLat = header.readInt32LE(106) / 10_000_000;
const maxLon = header.readInt32LE(110) / 10_000_000;
const maxLat = header.readInt32LE(114) / 10_000_000;
if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
  fail(`invalid bounds: [${minLon}, ${minLat}, ${maxLon}, ${maxLat}]`);
}

console.log(`OK PMTiles magic header`);
console.log(`OK PMTiles spec version ${specVersion}`);
console.log(`OK PMTiles header ranges are inside file (${stat.size} bytes)`);

runPmtilesLibraryCheck(filePath).catch((error) => {
  fail(`pmtiles parser could not read archive: ${error && error.message ? error.message : String(error)}`);
});
NODE
}

check_files() {
  check_node
  require_command npm
  log "OK npm $(npm -v)"

  require_file "$ROOT_DIR/package.json" "package.json"
  require_file "$ROOT_DIR/package-lock.json" "package-lock.json"
  require_file "$ROOT_DIR/tsconfig.json" "tsconfig.json"
  require_file "$ROOT_DIR/src/index.ts" "src/index.ts"
  require_file "$ROOT_DIR/src/server.ts" "src/server.ts"
  require_file "$ROOT_DIR/src/config/env.ts" "src/config/env.ts"
  validate_pmtiles_archive

  log "PMTiles path: $PMTILES_PATH"
  log "PMTiles size: $(human_size "$PMTILES_PATH")"

  if [[ -s "$ROOT_DIR/dist/index.js" ]]; then
    log "OK dist/index.js"
  else
    log "WARN dist/index.js is missing. Run ./pmtiles-server.sh build before start."
  fi
}

pid_from_file() {
  if [[ -f "$PID_FILE" ]]; then
    tr -d '[:space:]' < "$PID_FILE"
  fi
}

is_pid_running() {
  local pid
  pid="$(pid_from_file)"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
  fi
}

child_pids() {
  local pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -P "$pid" 2>/dev/null || true
  fi
}

any_pid_running() {
  local pid
  for pid in $1; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

install_deps() {
  cd "$ROOT_DIR"
  npm ci
}

build_app() {
  cd "$ROOT_DIR"
  npm run build
}

start_server() {
  check_files
  require_file "$ROOT_DIR/dist/index.js" "dist/index.js"

  if is_pid_running; then
    log "Server already running with PID $(pid_from_file)"
    exit 0
  fi

  local pids
  pids="$(port_pids)"
  if [[ -n "$pids" ]]; then
    fail "PORT=$PORT is already in use by PID(s): $pids"
  fi

  mkdir -p "$(dirname "$LOG_FILE")"

  cd "$ROOT_DIR"
  nohup env \
    NODE_ENV="$NODE_ENV" \
    PORT="$PORT" \
    HOST="$HOST" \
    PMTILES_PATH="$PMTILES_PATH" \
    WORKERS="$WORKERS" \
    CORS_ORIGIN="$CORS_ORIGIN" \
    CACHE_CONTROL="$CACHE_CONTROL" \
    STAT_REFRESH_MS="$STAT_REFRESH_MS" \
    node dist/index.js >> "$LOG_FILE" 2>&1 &

  printf '%s\n' "$!" > "$PID_FILE"
  sleep 1

  if is_pid_running; then
    log "Started PMTiles server"
    log "PID: $(pid_from_file)"
    log "URL: http://127.0.0.1:$PORT"
    log "Log: $LOG_FILE"
  else
    log "Server did not stay running. Last log lines:"
    tail -n 40 "$LOG_FILE" 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi
}

stop_server() {
  if ! is_pid_running; then
    log "No helper-managed server is running."
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid="$(pid_from_file)"
  local pids_to_stop
  pids_to_stop="$(printf '%s\n%s\n' "$pid" "$(child_pids "$pid")" | awk 'NF')"

  log "Stopping PID(s): $pids_to_stop"
  kill $pids_to_stop >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! any_pid_running "$pids_to_stop"; then
      rm -f "$PID_FILE"
      log "Stopped."
      return 0
    fi
    sleep 0.25
  done

  log "PID(s) did not stop after SIGTERM; sending SIGKILL."
  kill -9 $pids_to_stop >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  log "Killed."
}

kill_port() {
  require_command lsof

  local pids
  pids="$(port_pids)"
  if [[ -z "$pids" ]]; then
    log "No process is listening on PORT=$PORT."
    return 0
  fi

  log "Sending SIGTERM to PID(s) on PORT=$PORT: $pids"
  kill $pids >/dev/null 2>&1 || true
  sleep 1

  local remaining
  remaining="$(port_pids)"
  if [[ -n "$remaining" ]]; then
    log "Still listening; sending SIGKILL to PID(s): $remaining"
    kill -9 $remaining >/dev/null 2>&1 || true
  fi

  rm -f "$PID_FILE"
  log "Port $PORT is clear."
}

status_server() {
  if is_pid_running; then
    log "Helper PID: $(pid_from_file) is running"
    local children
    children="$(child_pids "$(pid_from_file)")"
    if [[ -n "$children" ]]; then
      log "Worker child PID(s): $children"
    fi
  else
    log "Helper PID: not running"
  fi

  local pids
  pids="$(port_pids)"
  if [[ -n "$pids" ]]; then
    log "PORT=$PORT listener PID(s): $pids"
  else
    log "PORT=$PORT has no listener"
  fi
}

verify_server() {
  require_command curl

  local base_url="${BASE_URL:-http://127.0.0.1:$PORT}"
  log "Verifying $base_url"

  log ""
  log "GET /healthz"
  curl -fsS "$base_url/healthz"
  log ""

  log ""
  log "GET /readyz"
  curl -fsS "$base_url/readyz"
  log ""

  log ""
  log "Range request /tiles/map.pmtiles"
  local headers
  headers="$(curl -fsS -D - -o /dev/null -H "Range: bytes=0-1023" "$base_url/tiles/map.pmtiles")"
  printf '%s\n' "$headers" | grep -Ei '^(HTTP/|content-range:|accept-ranges:|content-length:)' || true

  if printf '%s\n' "$headers" | head -n 1 | grep -q "206"; then
    log "OK range request returned 206 Partial Content"
  else
    fail "Range request did not return 206 Partial Content"
  fi
}

tail_logs() {
  mkdir -p "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE"
  tail -f "$LOG_FILE"
}

command_name="${1:-}"

case "$command_name" in
  check) check_files ;;
  validate-pmtiles) validate_pmtiles_archive ;;
  install) install_deps ;;
  build) build_app ;;
  start) start_server ;;
  stop) stop_server ;;
  kill-port) kill_port ;;
  restart)
    stop_server
    start_server
    ;;
  status) status_server ;;
  verify) verify_server ;;
  logs) tail_logs ;;
  ""|help|-h|--help) usage ;;
  *) usage; fail "Unknown command: $command_name" ;;
esac
