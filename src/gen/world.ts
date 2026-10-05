import { CHUNK_WIDTH, type Engine } from "./engine";
import { parseElement, type Drawable } from "./parse";

/** Width of one pre-rendered tile, in world units. */
export const TILE_WIDTH = 256;
/** Visible height of the world, in world units. */
export const VIEW_HEIGHT = 700;
/**
 * How far an element may extend beyond the chunk that planned it. The widest
 * are distant ranges (up to 1500 to the right) and flat hills.
 */
export const REACH = 3 * CHUNK_WIDTH;

/** A depth plane that scrolls at its own pace. */
export interface Layer {
  name: string;
  /** how far the layer moves for each unit the camera moves */
  parallax: number;
  /** vertical band the layer's elements stay inside, in world units */
  y0: number;
  y1: number;
}

/**
 * Back to front. Only the distant ranges get their own plane: they are
 * always behind everything else, so splitting them off cannot break the
 * painter's order among mountains, hills and boats.
 */
export const LAYERS: Layer[] = [
  { name: "far", parallax: 0.6, y0: 90, y1: 310 },
  { name: "main", parallax: 1, y0: 0, y1: VIEW_HEIGHT },
];
export const FAR = 0;
export const MAIN = 1;

export const layerOf = (tag: string) => (tag == "distmount" ? FAR : MAIN);

/** One number per (layer, tile index) pair. */
export const tileId = (layer: number, index: number) => index * LAYERS.length + layer;
export function tileOf(id: number): { layer: number; index: number } {
  const layer = ((id % LAYERS.length) + LAYERS.length) % LAYERS.length;
  return { layer, index: (id - layer) / LAYERS.length };
}

export interface Placed extends Drawable {
  layer: number;
  chunk: number;
  order: number;
}

/** Back to front; ties resolve the same way wherever generation started. */
export function paintOrder(a: Placed, b: Placed): number {
  return a.depth - b.depth || a.chunk - b.chunk || a.order - b.order;
}

/** Chunk indices whose elements can show up between x0 and x1. */
export function chunkSpan(x0: number, x1: number): [number, number] {
  return [Math.floor((x0 - REACH) / CHUNK_WIDTH), Math.floor((x1 + REACH - 1) / CHUNK_WIDTH)];
}

/**
 * Lazily generated, bounded cache of the world. Chunks that have not been
 * touched for a while are dropped; they regenerate identically on demand.
 */
export class World {
  private chunks = new Map<number, Placed[]>();

  constructor(
    readonly engine: Engine,
    private maxChunks = 48,
  ) {}

  get size(): number {
    return this.chunks.size;
  }

  has(index: number): boolean {
    return this.chunks.has(index);
  }

  chunk(index: number): Placed[] {
    let placed = this.chunks.get(index);
    if (placed) {
      // refresh its position in the eviction order
      this.chunks.delete(index);
    } else {
      placed = this.engine
        .generateChunk(index)
        .map((el, order) => ({ ...parseElement(el), layer: layerOf(el.tag), chunk: index, order }));
    }
    this.chunks.set(index, placed);
    return placed;
  }

  /** The first chunk still to be generated before [x0, x1) can be drawn. */
  missing(x0: number, x1: number): number | undefined {
    const [k0, k1] = chunkSpan(x0, x1);
    for (let k = k0; k <= k1; k++) {
      if (!this.chunks.has(k)) {
        return k;
      }
    }
    return undefined;
  }

  /** Everything of one layer overlapping [x0, x1), in painting order. */
  drawablesIn(x0: number, x1: number, layer: number): Placed[] {
    const [k0, k1] = chunkSpan(x0, x1);
    const out: Placed[] = [];
    for (let k = k0; k <= k1; k++) {
      for (const d of this.chunk(k)) {
        if (d.layer == layer && d.maxX >= x0 && d.minX <= x1) {
          out.push(d);
        }
      }
    }
    this.trim();
    return out.sort(paintOrder);
  }

  private trim() {
    for (const k of this.chunks.keys()) {
      if (this.chunks.size <= this.maxChunks) {
        break;
      }
      this.chunks.delete(k);
    }
  }
}

/**
 * A standalone SVG document of what a view `width` wide shows with its left
 * edge at camera position `camX`, each layer shifted by its parallax.
 */
export function exportSvg(engine: Engine, camX: number, width: number): string {
  let body = "";
  LAYERS.forEach((layer, li) => {
    const x0 = camX * layer.parallax;
    const x1 = x0 + width;
    const [k0, k1] = chunkSpan(x0, x1);
    const parts: { depth: number; chunk: number; order: number; svg: string }[] = [];
    for (let k = k0; k <= k1; k++) {
      engine.generateChunk(k).forEach((el, order) => {
        if (layerOf(el.tag) != li) {
          return;
        }
        const d = parseElement(el);
        if (d.maxX >= x0 && d.minX <= x1) {
          parts.push({ depth: el.depth, chunk: k, order, svg: el.svg });
        }
      });
    }
    parts.sort((a, b) => a.depth - b.depth || a.chunk - b.chunk || a.order - b.order);
    body += `<g transform='translate(${-x0} 0)'>` + parts.map((p) => p.svg).join("") + "</g>";
  });
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${VIEW_HEIGHT}' ` +
    `viewBox='0 0 ${width} ${VIEW_HEIGHT}'>${body}</svg>`
  );
}
