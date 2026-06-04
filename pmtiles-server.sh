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
  require_file "$PMTILES_PATH" "PMTiles file"

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
