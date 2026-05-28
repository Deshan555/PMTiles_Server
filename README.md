# PMTiles Server (Express + TypeScript)

High-performance PMTiles backend built with Express and TypeScript, designed for large-scale map traffic.

## Features

- Byte-range streaming for `.pmtiles` files (`206 Partial Content` support)
- HTTP cache validation (`ETag`, `Last-Modified`, `304 Not Modified`)
- Multi-worker cluster mode for better CPU usage
- Structured JSON logging
- Request logging middleware with latency metrics
- Health and readiness endpoints for orchestration
- Prometheus-style metrics endpoint
- TypeScript modular architecture for maintainability

## Project Structure

```text
src/
  app.ts                      # Express app wiring
  index.ts                    # Entry point
  cluster.ts                  # Primary/worker process orchestration
  server.ts                   # HTTP server lifecycle + graceful shutdown
  config/
    env.ts                    # Environment config
  middleware/
    requestLogger.ts          # Access log middleware
    requestMetrics.ts         # In-memory counters
  routes/
    systemRoutes.ts           # /healthz, /metrics
    tileRoutes.ts             # /readyz, /tiles/map.pmtiles
  services/
    pmtilesStore.ts           # PMTiles fd/stat/etag handling
    tileResponder.ts          # HEAD/GET + range + cache response logic
    metrics.ts                # Prometheus text rendering
  utils/
    logger.ts                 # Structured logger
  types/
    range.ts                  # Range parsing types
```

## Requirements

- Node.js 20+
- npm
- A PMTiles file located at `data/map.pmtiles`

## Setup

```bash
npm install
```

## Run

### Development (auto-restart with nodemon)

```bash
npm run dev
```

### Alternative development mode (tsx watcher)

```bash
npm run dev:tsx
```

### Build + Run production

```bash
npm run build
npm start
```

### Cluster mode (auto worker count)

```bash
npm run build
npm run start:cluster
```

## Endpoints

- `GET /tiles/map.pmtiles` - Streams full file or byte ranges
- `HEAD /tiles/map.pmtiles` - Metadata headers only
- `GET /healthz` - Liveness check
- `GET /readyz` - Readiness check (ensures PMTiles file is readable)
- `GET /metrics` - Prometheus-style counters

## API Request/Response Types

### `GET /tiles/map.pmtiles`

- Request type:
  - Method: `GET`
  - Body: none
  - Headers:
    - Optional `Range: bytes=<start>-<end>`
    - Optional cache validators: `If-None-Match`, `If-Modified-Since`
- Response type:
  - `200 OK` (full file) or `206 Partial Content` (range response)
  - Content-Type: `application/octet-stream`
  - Binary body: PMTiles bytes
  - Key headers: `Content-Length`, `Content-Range` (for 206), `Accept-Ranges`, `ETag`, `Last-Modified`, `Cache-Control`
  - `304 Not Modified` when validators match
  - `400 Bad Request` for invalid range header:

```json
{"error":"Invalid Range header"}
```

  - `416 Range Not Satisfiable` with header `Content-Range: bytes */<fileSize>`
  - `500 Internal Server Error` when file cannot be read:

```json
{"error":"Cannot read PMTiles file: <message>"}
```

### `HEAD /tiles/map.pmtiles`

- Request type:
  - Method: `HEAD`
  - Body: none
  - Optional cache validator headers: `If-None-Match`, `If-Modified-Since`
- Response type:
  - `200 OK` with headers only (no body)
  - `304 Not Modified` with headers only
  - Headers: `Content-Length`, `Accept-Ranges`, `ETag`, `Last-Modified`, `Cache-Control`, `Content-Type`
  - `500 Internal Server Error` JSON on failure:

```json
{"error":"Cannot read PMTiles file: <message>"}
```

### `GET /healthz`

- Request type:
  - Method: `GET`
  - Body: none
- Response type:
  - `200 OK` JSON:

```json
{"status":"ok","worker":12345}
```

### `GET /readyz`

- Request type:
  - Method: `GET`
  - Body: none
- Response type:
  - `200 OK` JSON:

```json
{"ready":true,"file":"/abs/path/to/data/map.pmtiles","size":123456789}
```

  - `503 Service Unavailable` JSON:

```json
{"ready":false,"error":"<message>"}
```

### `GET /metrics`

- Request type:
  - Method: `GET`
  - Body: none
- Response type:
  - `200 OK`
  - Content-Type: `text/plain`
  - Body format: Prometheus exposition text, for example:

```text
pmtiles_requests_total 12
pmtiles_requests_active 1
pmtiles_bytes_sent_total 1048576
pmtiles_range_requests_total 10
pmtiles_full_requests_total 2
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP server port |
| `HOST` | `0.0.0.0` | Bind host |
| `PMTILES_PATH` | `./data/map.pmtiles` | Absolute/relative path to PMTiles file |
| `WORKERS` | `1` | Number of worker processes (`0` = auto CPU count) |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |
| `CACHE_CONTROL` | `public, max-age=3600, stale-while-revalidate=60` | Cache header for map responses |
| `STAT_REFRESH_MS` | `10000` | Metadata refresh interval |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

## Logging

Application and HTTP access logs are emitted as structured JSON (one line per event), which is ready for ingestion by log systems.

Example:

```json
{"timestamp":"2026-05-28T16:00:00.000Z","level":"info","pid":12345,"message":"http_request","meta":{"method":"GET","path":"/tiles/map.pmtiles","statusCode":206,"durationMs":4.12}}
```

## Map Data: How to Get `data/map.pmtiles`

You have multiple options.

### Option A: Use an existing PMTiles file (fastest)

1. Download a `.pmtiles` file from a trusted provider.
2. Save/rename it to:

```text
data/map.pmtiles
```

3. Start server:

```bash
npm run dev
```

### Option B: Convert OSM extract to PMTiles (custom region)

Typical flow:

1. Download region extract (`.osm.pbf`) from providers such as Geofabrik.
2. Convert to PMTiles using a tile generation tool (for example Planetiler or other PMTiles-capable pipeline).
3. Place resulting file at `data/map.pmtiles`.

Example (Planetiler-style workflow; tool must be installed separately):

```bash
# 1) Download OSM PBF (example)
curl -L -o data/region.osm.pbf "https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf"

# 2) Generate PMTiles (example command pattern; adjust for your tool/version)
planetiler --download=false --osm-path=data/region.osm.pbf --output=data/map.pmtiles
```

Note: generation commands vary by tool and version. Confirm with your chosen generator's docs.

## Performance Notes (100k+ concurrent users)

For real internet-scale traffic, app code is only one part. Use:

1. CDN in front of this server (Cloudflare/Fastly/CloudFront)
2. Load balancer + multiple instances
3. Autoscaling + multi-zone deployment
4. Monitoring/alerting using `/metrics`

## Developer Workflow

- Edit TS source in `src/`
- `npm run dev` for local iteration
- `npm run build` for type-safe compile output to `dist/`
- `npm start` to run compiled output

## Troubleshooting

### `readyz` returns not ready

- Ensure `data/map.pmtiles` exists and is readable
- Confirm `PMTILES_PATH` if using custom location

### Range errors (`416`)

- Client requested byte range outside file size
- Ensure the client supports PMTiles range reads correctly

### CORS issues in browser

- Set `CORS_ORIGIN` to your frontend origin (instead of `*`) for strict policies

## License

ISC (from `package.json`)
