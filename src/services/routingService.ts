import fs from "node:fs";
import { PMTiles } from "pmtiles";

type LngLat = [number, number];
type LatLngObject = { lat: number; lng: number };

export type RoutingInputRoute = {
  id: string;
  stops: Array<LngLat | LatLngObject>;
};

export type RoutingSolveRequest = {
  routes: RoutingInputRoute[];
  options?: {
    zoom?: number;
    roadsLayerName?: string;
    tilePadding?: number;
    fallbackToStraightLine?: boolean;
  };
};

export type RoutingSolvedRoute = {
  id: string;
  path: LngLat[] | null;
  distanceKm: number;
  mode: "snapped" | "fallback";
};

export type RoutingSolveResponse = {
  routes: RoutingSolvedRoute[];
  cacheHit: boolean;
};

type RoadFeature = {
  properties?: Record<string, unknown>;
  geometry?: {
    type: "LineString" | "MultiLineString";
    coordinates: LngLat[] | LngLat[][];
  };
};

type Graph = {
  coords: LngLat[];
  edges: Array<Array<{ to: number; w: number }>>;
};

const responseCache = new Map<string, RoutingSolvedRoute[]>();
let vectorTileDepsPromise: Promise<{
  VectorTileCtor: new (pbf: unknown) => { layers: Record<string, unknown> };
  PbfCtor: new (buffer: Uint8Array) => unknown;
}> | null = null;

async function getVectorTileDeps(): Promise<{
  VectorTileCtor: new (pbf: unknown) => { layers: Record<string, unknown> };
  PbfCtor: new (buffer: Uint8Array) => unknown;
}> {
  if (!vectorTileDepsPromise) {
    vectorTileDepsPromise = (async () => {
      const vectorTileMod = await import("@mapbox/vector-tile");
      const pbfMod = await import("pbf");
      const VectorTileCtor = (vectorTileMod as { VectorTile?: unknown }).VectorTile as
        | (new (pbf: unknown) => { layers: Record<string, unknown> })
        | undefined;
      const maybePbf = pbfMod as { default?: unknown; PbfReader?: unknown };
      const PbfCtor = (maybePbf.default ?? maybePbf.PbfReader) as
        | (new (buffer: Uint8Array) => unknown)
        | undefined;
      if (!VectorTileCtor) {
        throw new Error("Unable to resolve @mapbox/vector-tile constructor");
      }
      if (!PbfCtor) {
        throw new Error("Unable to resolve pbf constructor");
      }
      return { VectorTileCtor, PbfCtor };
    })();
  }
  return vectorTileDepsPromise;
}

class FileSource {
  constructor(private readonly filePath: string) {}
  getKey(): string { return this.filePath; }
  async getBytes(
    offset: number,
    length: number,
    _signal?: AbortSignal,
    _etag?: string
  ): Promise<{ data: ArrayBuffer }> {
    const handle = await fs.promises.open(this.filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const exact = Uint8Array.from(buffer.subarray(0, bytesRead));
      return { data: exact.buffer };
    } finally {
      await handle.close();
    }
  }
}

function keyOf([lng, lat]: LngLat): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)}`;
}

function toLngLat(stop: LngLat | LatLngObject): LngLat {
  if (Array.isArray(stop)) {
    const lng = Number(stop[0]);
    const lat = Number(stop[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new Error(`Invalid tuple stop coordinates: [${String(stop[0])}, ${String(stop[1])}]`);
    }
    return [lng, lat];
  }
  const lng = Number(stop.lng);
  const lat = Number(stop.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new Error(`Invalid object stop coordinates: { lng: ${String(stop.lng)}, lat: ${String(stop.lat)} }`);
  }
  return [lng, lat];
}

function haversineMeters([lng1, lat1]: LngLat, [lng2, lat2]: LngLat): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function lonToTileX(lng: number, z: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

function tileToLngLat(x: number, y: number, z: number, extent: number, px: number, py: number): LngLat {
  const world = extent * 2 ** z;
  const nx = (x * extent + px) / world;
  const ny = (y * extent + py) / world;
  const lng = nx * 360 - 180;
  const my = Math.PI * (1 - 2 * ny);
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(my));
  return [lng, lat];
}

function isRoutable(feature: RoadFeature): boolean {
  const kind = String(feature.properties?.kind ?? "");
  return !["rail", "ferry"].includes(kind);
}

function asLines(geometry: RoadFeature["geometry"]): LngLat[][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates as LngLat[]];
  return geometry.coordinates as LngLat[][];
}

async function fetchRoadFeatures(
  pmtilesPath: string,
  bounds: [[number, number], [number, number]],
  zoom: number,
  roadsLayerName: string,
  tilePadding: number
): Promise<RoadFeature[]> {
  const archive = new PMTiles(new FileSource(pmtilesPath) as never);
  const [minLng, minLat] = bounds[0];
  const [maxLng, maxLat] = bounds[1];
  const minX = Math.max(0, lonToTileX(minLng, zoom) - tilePadding);
  const maxX = lonToTileX(maxLng, zoom) + tilePadding;
  const minY = Math.max(0, latToTileY(maxLat, zoom) - tilePadding);
  const maxY = latToTileY(minLat, zoom) + tilePadding;
  const features: RoadFeature[] = [];

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const tileResult = await archive.getZxy(zoom, x, y);
      if (!tileResult) continue;
      const { VectorTileCtor, PbfCtor } = await getVectorTileDeps();
      const tile = new VectorTileCtor(new PbfCtor(new Uint8Array(tileResult.data))) as {
        layers: Record<string, unknown>;
      };
      const roadsLayer = (tile.layers[roadsLayerName]
        ?? tile.layers.roads
        ?? tile.layers.transportation
        ?? tile.layers.road
        ?? tile.layers.transport) as {
        length: number;
        extent: number;
        feature: (i: number) => {
          properties: Record<string, unknown>;
          loadGeometry: () => Array<Array<{ x: number; y: number }>>;
        };
      } | undefined;
      if (!roadsLayer) continue;

      for (let i = 0; i < roadsLayer.length; i += 1) {
        const feature = roadsLayer.feature(i);
        const geometry = feature.loadGeometry();
        const lineStrings = geometry.map((line: Array<{ x: number; y: number }>) =>
          line.map((point: { x: number; y: number }) => tileToLngLat(x, y, zoom, roadsLayer.extent, point.x, point.y))
        );
        features.push({
          properties: feature.properties,
          geometry: {
            type: lineStrings.length === 1 ? "LineString" : "MultiLineString",
            coordinates: lineStrings.length === 1 ? lineStrings[0] : lineStrings
          }
        });
      }
    }
  }
  return features;
}

function buildGraph(features: RoadFeature[]): Graph {
  const coords: LngLat[] = [];
  const edges: Array<Array<{ to: number; w: number }>> = [];
  const idx = new Map<string, number>();

  const getIndex = (coord: LngLat): number => {
    const k = keyOf(coord);
    const found = idx.get(k);
    if (found !== undefined) return found;
    const next = coords.length;
    coords.push(coord);
    edges.push([]);
    idx.set(k, next);
    return next;
  };

  for (const feature of features) {
    if (!feature.geometry || !isRoutable(feature)) continue;
    for (const line of asLines(feature.geometry)) {
      for (let i = 0; i < line.length - 1; i += 1) {
        const a = getIndex(line[i]);
        const b = getIndex(line[i + 1]);
        const w = haversineMeters(line[i], line[i + 1]);
        edges[a].push({ to: b, w });
        edges[b].push({ to: a, w });
      }
    }
  }
  return { coords, edges };
}

function nearestNode(graph: Graph, target: LngLat): number {
  let nearest = -1;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < graph.coords.length; i += 1) {
    const d = haversineMeters(target, graph.coords[i]);
    if (d < best) { best = d; nearest = i; }
  }
  return nearest;
}

function shortestPath(graph: Graph, start: number, end: number): number[] | null {
  const n = graph.coords.length;
  if (start < 0 || end < 0 || n === 0) return null;
  const dist = new Float64Array(n);
  const prev = new Int32Array(n);
  const visited = new Uint8Array(n);
  dist.fill(Number.POSITIVE_INFINITY);
  prev.fill(-1);
  dist[start] = 0;

  // matrix-like indexed priority queue (binary heap over node indexes)
  const heap: Array<{ node: number; score: number }> = [{ node: start, score: 0 }];
  const pop = (): { node: number; score: number } | undefined => {
    if (heap.length === 0) return undefined;
    const root = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const l = i * 2 + 1;
        const r = i * 2 + 2;
        let s = i;
        if (l < heap.length && heap[l].score < heap[s].score) s = l;
        if (r < heap.length && heap[r].score < heap[s].score) s = r;
        if (s === i) break;
        [heap[i], heap[s]] = [heap[s], heap[i]];
        i = s;
      }
    }
    return root;
  };
  const push = (item: { node: number; score: number }) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (heap[p].score <= heap[i].score) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };

  while (heap.length > 0) {
    const current = pop()!;
    if (visited[current.node]) continue;
    visited[current.node] = 1;
    if (current.node === end) break;
    for (const edge of graph.edges[current.node]) {
      if (visited[edge.to]) continue;
      const next = dist[current.node] + edge.w;
      if (next < dist[edge.to]) {
        dist[edge.to] = next;
        prev[edge.to] = current.node;
        push({ node: edge.to, score: next });
      }
    }
  }

  if (!Number.isFinite(dist[end])) return null;
  const path: number[] = [end];
  let cursor = end;
  while (prev[cursor] !== -1) {
    cursor = prev[cursor];
    path.unshift(cursor);
  }
  return path;
}

function routeDistanceKm(path: LngLat[] | null): number {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) total += haversineMeters(path[i], path[i + 1]);
  return total / 1000;
}

function routeBounds(routes: RoutingInputRoute[]): [[number, number], [number, number]] | null {
  const stops = routes.flatMap((route) => route.stops.map(toLngLat));
  if (stops.length === 0) return null;
  let minLng = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lng, lat] of stops) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}

function directPath(stops: LngLat[]): LngLat[] {
  return [...stops];
}

export async function solveRoutesFromPmtilesFile(
  pmtilesPath: string,
  request: RoutingSolveRequest
): Promise<RoutingSolveResponse> {
  const zoom = request.options?.zoom ?? 14;
  const roadsLayerName = request.options?.roadsLayerName ?? "roads";
  const tilePadding = Math.max(1, request.options?.tilePadding ?? 2);
  const fallbackToStraightLine = request.options?.fallbackToStraightLine ?? true;

  const cacheKey = JSON.stringify({
    pmtilesPath,
    zoom,
    roadsLayerName,
    tilePadding,
    routes: request.routes.map((route) => ({ id: route.id, stops: route.stops }))
  });
  const cached = responseCache.get(cacheKey);
  if (cached) return { routes: cached, cacheHit: true };

  const bounds = routeBounds(request.routes);
  if (!bounds) return { routes: [], cacheHit: true };

  const roads = await fetchRoadFeatures(pmtilesPath, bounds, zoom, roadsLayerName, tilePadding);
  const graph = buildGraph(roads);

  const solved: RoutingSolvedRoute[] = request.routes.map((route) => {
    const normalizedStops = route.stops.map(toLngLat);
    if (normalizedStops.length < 2) {
      return { id: route.id, path: normalizedStops, distanceKm: routeDistanceKm(normalizedStops), mode: "fallback" };
    }
    const segments: LngLat[][] = [];
    for (let i = 0; i < normalizedStops.length - 1; i += 1) {
      const a = nearestNode(graph, normalizedStops[i]);
      const b = nearestNode(graph, normalizedStops[i + 1]);
      const path = shortestPath(graph, a, b);
      if (!path || path.length < 2) {
        if (fallbackToStraightLine) {
          const fallback = directPath(normalizedStops);
          return { id: route.id, path: fallback, distanceKm: routeDistanceKm(fallback), mode: "fallback" as const };
        }
        return { id: route.id, path: null, distanceKm: 0, mode: "fallback" as const };
      }
      segments.push(path.map((index) => graph.coords[index]));
    }

    const merged: LngLat[] = [];
    for (const segment of segments) {
      if (merged.length === 0) merged.push(...segment);
      else merged.push(...segment.slice(1));
    }
    return { id: route.id, path: merged, distanceKm: routeDistanceKm(merged), mode: "snapped" as const };
  });

  const successful = solved.filter((route) => route.path && route.path.length >= 2 && route.mode === "snapped").length;
  if (successful > 0) responseCache.set(cacheKey, solved);
  return { routes: solved, cacheHit: false };
}
