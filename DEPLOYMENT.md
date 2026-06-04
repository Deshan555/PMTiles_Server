# PMTiles Server Production Field Guide

This guide is for deploying `PMTiles_Server` as a production backend that serves
`/tiles/map.pmtiles` with byte-range support, cache headers, health checks, and
readiness checks.

Use this when you want a repeatable VPS or bare-metal deployment, not just a
local development run.

## Production Shape

Recommended layout on a server:

```text
/srv/localtiles/
  PMTiles_Server/
    package.json
    package-lock.json
    src/
    dist/
    pmtiles-server.sh
  data/
    map.pmtiles
```

The app itself can also use the repo-local default:

```text
PMTiles_Server/data/map.pmtiles
```

For production, an absolute `PMTILES_PATH` is safer because the service can be
started from systemd, cron, SSH, or another working directory.

## Requirements

- Node.js 20+
- npm
- `curl` for verification commands
- `lsof` for the helper script's `kill-port` command
- A valid `.pmtiles` file

## Helper Script

This repo includes a deployment helper:

```bash
./pmtiles-server.sh
```

Available commands:

```bash
./pmtiles-server.sh check
./pmtiles-server.sh install
./pmtiles-server.sh build
./pmtiles-server.sh start
./pmtiles-server.sh stop
./pmtiles-server.sh kill-port
./pmtiles-server.sh restart
./pmtiles-server.sh status
./pmtiles-server.sh verify
./pmtiles-server.sh logs
```

The script starts the compiled server in the background, writes logs to
`logs/pmtiles-server.log`, and stores the parent process id in
`.pmtiles-server.pid`.

## Verify All Files Are Available

Before running the backend, check that required files and runtime tools exist:

```bash
cd /srv/localtiles/PMTiles_Server
./pmtiles-server.sh check
```

The check validates:

- Node.js major version
- npm availability
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `src/index.ts`
- `src/server.ts`
- `src/config/env.ts`
- the configured `PMTILES_PATH`
- `dist/index.js`, if already built

Manual file checks:

```bash
test -s package.json
test -s package-lock.json
test -d src
test -s data/map.pmtiles
ls -lh data/map.pmtiles
```

After build:

```bash
test -s dist/index.js
ls -lh dist/index.js
```

## First Install

From the backend directory:

```bash
cd /srv/localtiles/PMTiles_Server
npm ci
npm run build
```

Or use the helper:

```bash
./pmtiles-server.sh install
./pmtiles-server.sh build
```

## Change Port Before Run

Default port is `8080`.

Run on another port for one command:

```bash
PORT=9090 ./pmtiles-server.sh start
```

Verify that same port:

```bash
PORT=9090 ./pmtiles-server.sh verify
```

Run with a custom map path and frontend domain:

```bash
PORT=9090 \
HOST=0.0.0.0 \
PMTILES_PATH=/srv/localtiles/data/map.pmtiles \
CORS_ORIGIN=https://your-frontend-domain.com \
WORKERS=0 \
./pmtiles-server.sh start
```

Direct Node run without the helper:

```bash
PORT=9090 \
HOST=0.0.0.0 \
PMTILES_PATH=/srv/localtiles/data/map.pmtiles \
CORS_ORIGIN=https://your-frontend-domain.com \
WORKERS=0 \
NODE_ENV=production \
node dist/index.js
```

## Start Server

Production background start:

```bash
NODE_ENV=production \
PMTILES_PATH=/srv/localtiles/data/map.pmtiles \
CORS_ORIGIN=https://your-frontend-domain.com \
WORKERS=0 \
./pmtiles-server.sh start
```

Check status:

```bash
./pmtiles-server.sh status
```

Watch logs:

```bash
./pmtiles-server.sh logs
```

## Kill Server

Graceful stop using the helper-managed PID:

```bash
./pmtiles-server.sh stop
```

If you changed the port:

```bash
PORT=9090 ./pmtiles-server.sh stop
```

If the PID file is missing or another process is holding the port:

```bash
PORT=8080 ./pmtiles-server.sh kill-port
```

Manual Linux/macOS port lookup:

```bash
lsof -iTCP:8080 -sTCP:LISTEN
```

Manual graceful kill:

```bash
kill <PID>
```

Last resort only:

```bash
kill -9 <PID>
```

## Verify Server Health

Helper verification:

```bash
./pmtiles-server.sh verify
```

Manual checks:

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/readyz
curl -I http://127.0.0.1:8080/tiles/map.pmtiles
curl -v -H "Range: bytes=0-1023" http://127.0.0.1:8080/tiles/map.pmtiles -o /dev/null
```

Expected signals:

- `/healthz` returns `200`
- `/readyz` returns `200` and `ready: true`
- `/tiles/map.pmtiles` returns `Accept-Ranges: bytes`
- range request returns `206 Partial Content`
- response includes `Content-Range`

## systemd Service

Create:

```bash
sudo nano /etc/systemd/system/localtiles-pmtiles.service
```

Example:

```ini
[Unit]
Description=LocalTiles PMTiles Backend
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/localtiles/PMTiles_Server
Environment=NODE_ENV=production
Environment=PORT=8080
Environment=HOST=127.0.0.1
Environment=PMTILES_PATH=/srv/localtiles/data/map.pmtiles
Environment=WORKERS=0
Environment=CORS_ORIGIN=https://your-frontend-domain.com
Environment=CACHE_CONTROL=public, max-age=86400, stale-while-revalidate=3600
ExecStart=/usr/bin/node /srv/localtiles/PMTiles_Server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable localtiles-pmtiles
sudo systemctl start localtiles-pmtiles
sudo systemctl status localtiles-pmtiles
```

Stop or restart:

```bash
sudo systemctl stop localtiles-pmtiles
sudo systemctl restart localtiles-pmtiles
```

Logs:

```bash
journalctl -u localtiles-pmtiles -f
```

## Nginx Reverse Proxy

Run Node on `127.0.0.1:8080`, then expose it through Nginx:

```nginx
server {
    server_name api.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;

        proxy_read_timeout 90s;
        gzip off;
    }
}
```

After Nginx is configured, verify through the public domain:

```bash
curl https://api.your-domain.com/readyz
curl -v -H "Range: bytes=0-1023" https://api.your-domain.com/tiles/map.pmtiles -o /dev/null
```

## CDN Notes

For real traffic, place Cloudflare, Fastly, or CloudFront in front of
`/tiles/map.pmtiles`.

The CDN must preserve:

- `Range`
- `Content-Range`
- `Accept-Ranges`
- `ETag`
- `Last-Modified`

Test byte-range behavior after enabling the CDN. A CDN that converts every
request into a full-file download will make PMTiles slow and expensive.

## Frontend URL

The frontend must point to your deployed backend:

```text
https://api.your-domain.com/tiles/map.pmtiles
```

If the frontend is still using `http://localhost:8080`, update it before
production build or make the backend base URL configurable through a Vite env
variable.

## Production Checklist

- `./pmtiles-server.sh check` passes
- `npm run build` passes
- `PMTILES_PATH` is absolute
- `CORS_ORIGIN` is set to the frontend domain
- server runs behind systemd or another process manager
- Nginx or load balancer forwards range headers
- `/healthz` returns `200`
- `/readyz` returns `200`
- range request returns `206 Partial Content`
- CDN range behavior is tested
- logs are being collected

## Troubleshooting

### Port Already In Use

```bash
lsof -iTCP:8080 -sTCP:LISTEN
PORT=8080 ./pmtiles-server.sh kill-port
```

Or choose another port:

```bash
PORT=9090 ./pmtiles-server.sh start
```

### Ready Check Fails

Check the map file:

```bash
ls -lh /srv/localtiles/data/map.pmtiles
PMTILES_PATH=/srv/localtiles/data/map.pmtiles ./pmtiles-server.sh check
```

### Browser CORS Error

Set:

```bash
CORS_ORIGIN=https://your-frontend-domain.com
```

Then restart the server.

### Range Request Does Not Return 206

Check the backend directly first:

```bash
curl -v -H "Range: bytes=0-1023" http://127.0.0.1:8080/tiles/map.pmtiles -o /dev/null
```

If direct backend works but public domain fails, inspect Nginx, load balancer,
or CDN header behavior.
