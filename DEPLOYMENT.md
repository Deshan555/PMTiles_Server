Optimized tool selectionI’m pulling the existing server README into a clean, copy-ready version tailored to your backend deployment flow.

Read [](file:///Users/user/Documents/Developments/LocalTiles/PMTiles_Server/README.md#1-1), lines 1 to 220

Read [](file:///Users/user/Documents/Developments/LocalTiles/PMTiles_Server/README.md#220-220), lines 220 to 389

Here is a clean copy-paste README for the backend service in README.md:

```md
# PMTiles Server

High-performance PMTiles backend built with Express + TypeScript for serving map data over HTTP.

## Features
- Byte-range streaming for `.pmtiles` files (`206 Partial Content`)
- HTTP cache validation (`ETag`, `Last-Modified`, `304 Not Modified`)
- Multi-worker cluster mode
- Structured JSON logging
- Health/readiness endpoints
- Prometheus-style metrics
- TypeScript-based modular architecture

## Requirements
- Node.js 20+
- npm
- A PMTiles file at `data/map.pmtiles`

## Install
```bash
cd /path/to/LocalTiles/PMTiles_Server
npm install
```

## Build
```bash
npm run build
```

## Run (production)
```bash
PORT=8080 \
HOST=0.0.0.0 \
PMTILES_PATH=/path/to/LocalTiles/PMTiles_Server/data/map.pmtiles \
npm start
```

## Verify
```bash
curl http://127.0.0.1:8080/readyz
```

Expected response:
```json
{"ready":true,"file":".../data/map.pmtiles","size":...}
```

## Development
```bash
npm run dev
```

Alternative watcher:
```bash
npm run dev:tsx
```

## Cluster mode
```bash
npm run build
npm run start:cluster
```

## Endpoints
- `GET /tiles/map.pmtiles` — stream PMTiles bytes or byte ranges
- `HEAD /tiles/map.pmtiles` — metadata only
- `GET /healthz` — liveness check
- `GET /readyz` — readiness check
- `GET /metrics` — Prometheus-style metrics
- `POST /routing/solve` — routing solve endpoint

## Environment Variables
| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind host |
| `PMTILES_PATH` | `./data/map.pmtiles` | PMTiles file path |
| `WORKERS` | `1` | Worker count (`0` = auto CPU count) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `CACHE_CONTROL` | `public, max-age=3600, stale-while-revalidate=60` | Cache header |
| `STAT_REFRESH_MS` | `10000` | Metadata refresh interval |
| `LOG_LEVEL` | `info` | Log level |

## Monitoring
Start the monitoring stack:
```bash
npm run monitor:up
```

Access:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000
  - Username: `admin`
  - Password: `admin`

Stop it:
```bash
npm run monitor:down
```

## Performance tests
```bash
npm run perf:quick
npm run perf:load
npm run perf:all
```

## Troubleshooting
- If `/readyz` fails, confirm `data/map.pmtiles` exists and `PMTILES_PATH` is correct.
- If range requests fail, confirm the client supports PMTiles byte-range reads.
- For browser CORS issues, set `CORS_ORIGIN` to your frontend domain.
```

If you want, I can also turn this into a shorter “deployment-only” README for your production server.If you want, I can also turn this into a shorter “deployment-only” README for your production server.