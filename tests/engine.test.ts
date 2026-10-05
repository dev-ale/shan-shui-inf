import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CHUNK_WIDTH, createEngine, stripGroups } from "../src/gen/engine";
import { parseElement } from "../src/gen/parse";
import { createRng } from "../src/gen/prng";
import { drawSlice } from "../src/gen/raster";
import { paintShape, seasonAt, tintColor } from "../src/gen/season";
import type { PolyShape } from "../src/gen/parse";
import { exportSvg, FAR, LAYERS, layerOf, MAIN, REACH, tileId, tileOf, TILE_WIDTH, World } from "../src/gen/world";
import { hourOf, skyAt } from "../src/app/sky";

// group wrappers are bookkeeping, not art, so they stay out of the fingerprint
const digest = (s: string) => createHash("sha256").update(stripGroups(s)).digest("hex").slice(0, 16);

describe("createRng", () => {
  it("repeats for the same key and differs between keys", () => {
    const take = (key: string) => Array.from({ length: 5 }, createRng(key));
    expect(take("a")).toEqual(take("a"));
    expect(take("a")).not.toEqual(take("b"));
  });

  it("stays in [0, 1) and is roughly uniform", () => {
    const rng = createRng("uniform");
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const v = rng();
      expect(v >= 0 && v < 1).toBe(true);
      buckets[Math.floor(v * 10)]++;
    }
    for (const n of buckets) {
      expect(n).toBeGreaterThan(9_500);
      expect(n).toBeLessThan(10_500);
    }
  });
});

describe("engine", () => {
  it("generates a chunk the same way whatever was generated before it", () => {
    const direct = createEngine("order").generateChunk(3);

    const wandering = createEngine("order");
    for (const k of [0, -1, 1, 2, -2, 7]) {
      wandering.generateChunk(k);
    }
    expect(wandering.generateChunk(3)).toEqual(direct);
  });

  it("gives different seeds different worlds", () => {
    const a = createEngine("one").generateChunk(0).map((e) => e.svg);
    const b = createEngine("two").generateChunk(0).map((e) => e.svg);
    expect(a).not.toEqual(b);
  });

  // If one of these fails, the art for existing links has changed. Update the
  // snapshot only when that is the intent.
  it.each([
    ["golden", 0],
    ["golden", 5],
    ["golden", -3],
    ["1538000000000", 93],
  ])("seed %s chunk %i is unchanged", (seed, index) => {
    const chunk = createEngine(seed).generateChunk(index);
    expect(
      chunk.map((e) => `${e.tag} x=${e.x.toFixed(1)} depth=${e.depth.toFixed(1)} ${digest(e.svg)}`),
    ).toMatchSnapshot();
  });

  it("keeps every element within REACH of its chunk", () => {
    const engine = createEngine("reach");
    for (let k = -12; k < 12; k++) {
      for (const el of engine.generateChunk(k)) {
        const d = parseElement(el);
        expect(d.minX).toBeGreaterThanOrEqual(k * CHUNK_WIDTH - REACH);
        expect(d.maxX).toBeLessThanOrEqual((k + 1) * CHUNK_WIDTH + REACH);
      }
    }
  });
});

describe("parseElement", () => {
  it("decodes every polyline with its style and points", () => {
    const el = {
      tag: "t",
      x: 1000.4,
      y: 0,
      depth: 0,
      svg:
        "<polyline points=' 1000.0,5.0 1010.5,6.0 1020.0,-7.5' style='fill:rgba(1,2,3,0.5);stroke:rgba(4,5,6,1);stroke-width:2'/>" +
        "<polyline points=' 990.0,1.0 995.0,2.0' style='fill:rgba(0,0,0,0);stroke:rgba(0,0,0,0);stroke-width:0'/>",
    };
    const d = parseElement(el);
    expect(d.originX).toBe(1000);
    expect(d.shapes).toHaveLength(2);
    const [a, b] = d.shapes;
    expect(a).toMatchObject({ kind: "poly", fill: "rgba(1,2,3,0.5)", stroke: "rgba(4,5,6,1)", width: 2 });
    expect(a.kind == "poly" && Array.from(a.pts)).toEqual([0, 5, 10.5, 6, 20, -7.5]);
    expect(b).toMatchObject({ width: 0 });
    expect([d.minX, d.maxX]).toEqual([990, 1022]);
  });

  it("accounts for every polyline of a real chunk", () => {
    for (const el of createEngine("golden").generateChunk(0)) {
      const tags = el.svg.split("<polyline").length - 1;
      const shapes = parseElement(el).shapes.filter((s) => s.kind == "poly");
      // only degenerate single-point polylines may be dropped
      expect(shapes.length).toBeGreaterThan(tags * 0.99);
      expect(shapes.length).toBeLessThanOrEqual(tags);
    }
  });
});

describe("World", () => {
  it("returns the same tile contents after its chunks were evicted", () => {
    const world = new World(createEngine("evict"), 8);
    const ids = (x0: number) =>
      world.drawablesIn(x0, x0 + TILE_WIDTH, MAIN).map((d) => `${d.chunk}:${d.order}:${d.shapes.length}`);
    const before = ids(0);
    ids(40 * CHUNK_WIDTH);
    expect(world.size).toBeLessThanOrEqual(8);
    expect(world.has(0)).toBe(false);
    expect(ids(0)).toEqual(before);
  });

  it("paints neighbouring tiles in a consistent order", () => {
    const world = new World(createEngine("order"));
    const key = (d: { chunk: number; order: number }) => `${d.chunk}:${d.order}`;
    const left = world.drawablesIn(0, TILE_WIDTH, MAIN).map(key);
    const right = new Set(world.drawablesIn(TILE_WIDTH, 2 * TILE_WIDTH, MAIN).map(key));
    const both = world.drawablesIn(0, 2 * TILE_WIDTH, MAIN).map(key);
    expect(both.filter((k) => left.includes(k))).toEqual(left);
    expect(both.filter((k) => right.has(k))).toEqual([...right].sort((a, b) => both.indexOf(a) - both.indexOf(b)));
  });

  it("exports a well-formed SVG with one group per layer", () => {
    const svg = exportSvg(createEngine("golden"), 1000, 800);
    expect(svg.startsWith("<svg xmlns='http://www.w3.org/2000/svg' width='800' height='700' viewBox='0 0 800 700'>")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    // the far layer has only moved 60% as far as the camera
    expect(svg).toContain("<g transform='translate(-600 0)'>");
    expect(svg).toContain("<g transform='translate(-1000 0)'>");
    expect(svg).toContain("<polyline");
  });
});

describe("layers", () => {
  it("round-trips tile ids, including left of the origin", () => {
    for (const layer of [FAR, MAIN]) {
      for (const index of [-7, -1, 0, 1, 12345]) {
        expect(tileOf(tileId(layer, index))).toEqual({ layer, index });
      }
    }
  });

  it("puts only distant ranges on the far layer, inside its band", () => {
    const engine = createEngine("layers");
    let far = 0;
    for (let k = -10; k < 10; k++) {
      for (const el of engine.generateChunk(k)) {
        if (layerOf(el.tag) != FAR) {
          continue;
        }
        far++;
        expect(el.tag).toBe("distmount");
        expect(el.depth).toBeLessThan(300);
        for (const s of parseElement(el).shapes) {
          if (s.kind == "poly") {
            for (let i = 1; i < s.pts.length; i += 2) {
              expect(s.pts[i]).toBeGreaterThanOrEqual(LAYERS[FAR].y0);
              expect(s.pts[i]).toBeLessThanOrEqual(LAYERS[FAR].y1);
            }
          }
        }
      }
    }
    expect(far).toBeGreaterThan(0);
  });

  it("keeps everything else in front of the far layer", () => {
    for (const el of createEngine("layers").generateChunk(0)) {
      if (el.tag == "mount" || el.tag == "flatmount" || el.tag == "boat") {
        expect(el.depth).toBeGreaterThanOrEqual(300);
      }
    }
  });
});

const shapesOf = (seed: string, from: number, to: number) => {
  const engine = createEngine(seed);
  const out: { tag: string; shape: PolyShape; seed: number; n: number }[] = [];
  for (let k = from; k < to; k++) {
    for (const el of engine.generateChunk(k)) {
      const d = parseElement(el);
      d.shapes.forEach((shape, n) => {
        if (shape.kind == "poly") {
          out.push({ tag: el.tag, shape, seed: d.originX * 7 + shape.treeId * 977, n });
        }
      });
    }
  }
  return out;
};

describe("seasons", () => {
  const all = shapesOf("golden", 0, 14);
  const leaves = all.filter((s) => s.shape.tree && (s.shape.leaf || s.shape.tree == 7));

  it("tells species, foliage, wood and buildings apart", () => {
    const kinds = new Set(all.map((s) => s.shape.tree));
    expect(kinds.size).toBeGreaterThan(4);
    expect(leaves.length).toBeGreaterThan(200);
    // trunks and branches exist too, and are not foliage
    expect(all.some((s) => s.shape.tree == 4 && !s.shape.leaf)).toBe(true);
    expect(all.some((s) => s.shape.arch)).toBe(true);
    expect(all.some((s) => !s.shape.tree && !s.shape.arch)).toBe(true);
  });

  it("tints towards a colour and keeps opacity", () => {
    expect(tintColor("rgba(100,100,100,0.5)", [200, 0, 100], 0.5)).toBe("rgba(150,50,100,0.5)");
    expect(tintColor("rgb(0,0,0)", [200, 100, 50], 1)).toBe("rgba(200,100,50,1)");
    expect(tintColor("white", [200, 100, 50], 1)).toBe("white");
  });

  it("leaves wood, buildings and water in plain ink", () => {
    for (const season of ["spring", "summer", "autumn"] as const) {
      for (const s of all) {
        const wood = s.shape.tree && !s.shape.leaf && s.shape.tree != 7;
        if (wood || s.shape.arch || s.tag == "water" || s.tag == "boat") {
          expect(paintShape(season, s.tag, s.shape, s.seed, s.n)).toMatchObject({ fill: s.shape.fill, alpha: 1 });
        }
      }
    }
  });

  it("gives autumn trees several different colours", () => {
    const hues = new Set<string>();
    const perTree = new Map<number, string>();
    for (const s of leaves.filter((l) => ![1, 5, 7].includes(l.shape.tree))) {
      const fill = paintShape("autumn", s.tag, s.shape, s.seed, s.n)!.fill as string;
      const [r, g, b] = fill.slice(5).split(",").map(Number);
      // which colour family: red, orange/gold or olive
      hues.add(r > g * 1.9 ? "red" : g > b * 1.6 && r > g * 1.15 ? "gold" : "other");
      perTree.set(s.seed, fill);
    }
    expect(hues.size).toBeGreaterThanOrEqual(3);
    expect(new Set(perTree.values()).size).toBeGreaterThan(10);
  });

  it("keeps evergreens dark in autumn while leaf trees turn", () => {
    const fir = leaves.find((l) => l.shape.tree == 7)!;
    const [r, g] = (paintShape("autumn", fir.tag, fir.shape, fir.seed, fir.n)!.fill as string).slice(5).split(",").map(Number);
    expect(g).toBeGreaterThan(r);
  });

  it("strips twig trees bare in winter and snows on evergreens", () => {
    const twiggy = leaves.filter((l) => l.shape.tree == 4 || l.shape.tree == 6);
    expect(twiggy.length).toBeGreaterThan(0);
    for (const s of twiggy) {
      expect(paintShape("winter", s.tag, s.shape, s.seed, s.n)).toBeNull();
    }
    const fir = leaves.find((l) => l.shape.tree == 7)!;
    expect(paintShape("winter", fir.tag, fir.shape, fir.seed, fir.n)!.snow).toBe(true);
    // the branches stay
    const branch = all.find((s) => s.shape.tree == 4 && !s.shape.leaf)!;
    expect(paintShape("winter", branch.tag, branch.shape, branch.seed, branch.n)).not.toBeNull();
  });

  it("washes mountain bodies with an opaque gradient", () => {
    const body = all.find((s) => s.tag == "mount" && s.shape.fill == "white" && !s.shape.arch && !s.shape.tree)!;
    const fill = paintShape("summer", "mount", body.shape, 0, 0)!.fill;
    expect(Array.isArray(fill)).toBe(true);
    expect((fill as readonly string[]).every((c) => c.startsWith("rgb("))).toBe(true);
    expect(paintShape("winter", "mount", body.shape, 0, 0)!.fill).toBe("white");
  });

  it("draws plain ink exactly as before when no season is set", () => {
    const fills: string[] = [];
    const ctx: any = new Proxy({}, { get: () => () => {}, set: (_t, prop, value) => (prop == "fillStyle" && fills.push(value), true) });
    const d = parseElement(createEngine("golden").generateChunk(0).find((e) => e.tag == "mount")!);
    drawSlice(ctx, [d], d.minX, d.maxX, 1);
    expect(fills).toEqual(d.shapes.filter((s) => s.kind == "poly").map((s) => s.fill));
  });

  it("knows the season of a date", () => {
    expect(seasonAt(new Date(2026, 0, 15))).toBe("winter");
    expect(seasonAt(new Date(2026, 3, 15))).toBe("spring");
    expect(seasonAt(new Date(2026, 6, 15))).toBe("summer");
    expect(seasonAt(new Date(2026, 9, 5))).toBe("autumn");
    expect(seasonAt(new Date(2026, 11, 24))).toBe("winter");
  });
});

describe("sky", () => {
  it("leaves the paper untouched at midday", () => {
    const noon = skyAt(12);
    expect(noon.top).toEqual([255, 255, 255]);
    expect(noon.horizon).toEqual([255, 255, 255]);
    expect(noon.sun).toBe(0);
    expect(noon.moon).toBe(0);
  });

  it("shows the sun at dawn and dusk and the moon at night", () => {
    expect(skyAt(6.2).sun).toBe(1);
    expect(skyAt(18.6).sun).toBe(1);
    expect(skyAt(6.2).moon).toBeCloseTo(0);
    expect(skyAt(23).moon).toBe(1);
    expect(skyAt(23).sun).toBe(0);
    expect(skyAt(2).top[0]).toBeLessThan(120);
  });

  it("changes smoothly, also across midnight", () => {
    for (let h = 0; h < 24; h += 0.05) {
      const a = skyAt(h);
      const b = skyAt(h + 0.05);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(a.top[i] - b.top[i])).toBeLessThan(8);
        expect(Math.abs(a.horizon[i] - b.horizon[i])).toBeLessThan(8);
      }
      expect(Math.abs(a.moon - b.moon)).toBeLessThan(0.1);
    }
    expect(skyAt(24)).toEqual(skyAt(0));
  });

  it("maps modes to hours", () => {
    expect(hourOf("dusk", new Date())).toBe(18.6);
    expect(hourOf("auto", new Date(2026, 9, 5, 13, 30))).toBe(13.5);
  });
});
