declare module "pbf" {
  export default class Pbf {
    constructor(buffer?: Uint8Array);
  }
}

declare module "@mapbox/vector-tile" {
  export class VectorTile {
    constructor(pbf: unknown);
    layers: Record<string, {
      length: number;
      extent: number;
      feature(index: number): {
        properties: Record<string, unknown>;
        loadGeometry(): Array<Array<{ x: number; y: number }>>;
      };
    }>;
  }
}

declare module "pmtiles" {
  export class PMTiles {
    constructor(source: unknown);
    getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBufferLike } | undefined>;
  }
}
