import type { Element } from "./engine";

/** A filled and/or stroked polyline, with points relative to its element's origin. */
export interface PolyShape {
  kind: "poly";
  /** x0, y0, x1, y1, ... */
  pts: Float32Array;
  fill: string;
  stroke: string;
  width: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** 1..8 for a shape inside Tree.tree01..tree08, otherwise 0 */
  tree: number;
  /** numbers the trees within one element, so each can get its own colour */
  treeId: number;
  /** foliage rather than trunk, branch or bark */
  leaf: boolean;
  /** part of a building, boat or figure */
  arch: boolean;
}

export interface TextShape {
  kind: "text";
  text: string;
  size: number;
  fill: string;
  x: number;
  y: number;
  /** rotation in degrees */
  rot: number;
  minX: number;
  maxX: number;
}

export type Shape = PolyShape | TextShape;

/** An element decoded into shapes a canvas can draw directly. */
export interface Drawable {
  tag: string;
  depth: number;
  /**
   * World x that shape coordinates are relative to. Keeping coordinates
   * small keeps them exact in 32-bit floats however far the world scrolls.
   */
  originX: number;
  /** world-space horizontal extent */
  minX: number;
  maxX: number;
  shapes: Shape[];
}

function attr(src: string, name: string, from: number, to: number): string {
  const key = name + "='";
  const a = src.indexOf(key, from);
  if (a < 0 || a > to) {
    return "";
  }
  return src.slice(a + key.length, src.indexOf("'", a + key.length));
}

function styleProp(style: string, name: string): string {
  for (const part of style.split(";")) {
    const c = part.indexOf(":");
    if (c > 0 && part.slice(0, c).trim() == name) {
      return part.slice(c + 1).trim();
    }
  }
  return "";
}

/**
 * Decodes the markup the generator emits. That is only ever
 * `<polyline points style/>`, the odd shop sign as `<text>`, and the
 * `<g class='tree|leaf|arch'>` wrappers the engine adds.
 */
export function parseElement(el: Element): Drawable {
  const src = el.svg;
  const originX = Math.round(el.x);
  const shapes: Shape[] = [];
  let minX = Infinity;
  let maxX = -Infinity;

  let pos = 0;
  // open groups, innermost last
  const groups: string[] = [];
  let tree = 0;
  let treeId = 0;
  let leaves = 0;
  let arches = 0;
  for (;;) {
    const open = src.indexOf("<", pos);
    if (open < 0) {
      break;
    }
    const close = src.indexOf(">", open);
    if (src.startsWith("<polyline", open)) {
      const nums = attr(src, "points", open, close).split(/[ ,]+/);
      const first = nums[0] === "" ? 1 : 0;
      const pts = new Float32Array((nums.length - first) & ~1);
      let lo = Infinity;
      let hi = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        const x = +nums[first + i] - originX;
        const y = +nums[first + i + 1];
        pts[i] = x;
        pts[i + 1] = y;
        if (x < lo) lo = x;
        if (x > hi) hi = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
      const style = attr(src, "style", open, close);
      const fill = styleProp(style, "fill");
      const width = +styleProp(style, "stroke-width") || 0;
      if (pts.length >= 4) {
        shapes.push({
          kind: "poly",
          pts,
          fill,
          stroke: styleProp(style, "stroke") || fill,
          width,
          minX: lo - width,
          maxX: hi + width,
          minY: top,
          maxY: bottom,
          tree,
          treeId,
          leaf: leaves > 0,
          arch: arches > 0,
        });
        minX = Math.min(minX, lo - width);
        maxX = Math.max(maxX, hi + width);
      }
      pos = close + 1;
    } else if (src.startsWith("<text", open)) {
      const end = src.indexOf("</text>", close);
      const text = src.slice(close + 1, end);
      const size = +attr(src, "font-size", open, close);
      const tf = /translate\(([^,]+),([^)]+)\)\s*rotate\(([^)]+)\)/.exec(
        attr(src, "transform", open, close),
      );
      const x = (tf ? +tf[1] : 0) - originX;
      const half = text.length * size * 0.5;
      shapes.push({
        kind: "text",
        text,
        size,
        fill: styleProp(attr(src, "style", open, close), "fill"),
        x,
        y: tf ? +tf[2] : 0,
        rot: tf ? +tf[3] : 0,
        minX: x - half,
        maxX: x + half,
      });
      minX = Math.min(minX, x - half);
      maxX = Math.max(maxX, x + half);
      pos = end + 7;
    } else {
      if (src.startsWith("<g", open)) {
        const kind = attr(src, "class", open, close);
        groups.push(kind);
        if (kind == "tree" && tree == 0) {
          tree = +attr(src, "data-k", open, close).replace("tree", "") || 0;
          treeId++;
        } else if (kind == "leaf") {
          leaves++;
        } else if (kind == "arch") {
          arches++;
        }
      } else if (src.startsWith("</g", open)) {
        const kind = groups.pop();
        if (kind == "tree" && !groups.includes("tree")) {
          tree = 0;
        } else if (kind == "leaf") {
          leaves--;
        } else if (kind == "arch") {
          arches--;
        }
      }
      pos = close + 1;
    }
  }

  return {
    tag: el.tag,
    depth: el.depth,
    originX,
    minX: originX + minX,
    maxX: originX + maxX,
    shapes,
  };
}
