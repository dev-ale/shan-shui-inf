import { createArch } from "./arch";
import { createBrush } from "./brush";
import { createCore, type Core } from "./core";
import { createMan } from "./man";
import { createMount } from "./mount";
import { createNoise } from "./noise";
import { planRange, type PlanItem } from "./planner";
import { createRng, type Rng } from "./prng";
import { createTree } from "./tree";
import { createWater } from "./water";

/** Width of one independently generated slice of the world. */
export const CHUNK_WIDTH = 512;

/** One painted thing (a mountain, its water, a boat ...) as SVG markup. */
export interface Element {
  tag: string;
  /** anchor position in world units */
  x: number;
  y: number;
  /** painter's order: smaller is further back */
  depth: number;
  svg: string;
}

/**
 * Optional bookkeeping markup: trees, their foliage and buildings can be
 * wrapped in groups so later stages (seasons) can tell them apart from rock.
 */
export const GROUP_CLOSE = "</g>";
export const groupOpen = (kind: "tree" | "leaf" | "arch", name = "") =>
  `<g class='${kind}'${name ? ` data-k='${name}'` : ""}>`;
/** Removes that markup again, leaving exactly what the drawing code produced. */
export const stripGroups = (svg: string) => svg.replace(/<\/?g[^>]*>/g, "");

function wrapAll(ns: Record<string, (...args: any[]) => any>, kind: "tree" | "arch") {
  for (const name of Object.keys(ns)) {
    const draw = ns[name];
    ns[name] = (...args: unknown[]) => {
      const out = draw(...args);
      return typeof out == "string" && out ? groupOpen(kind, name) + out + GROUP_CLOSE : out;
    };
  }
}

/**
 * The drawing modules wired to one noise field and one random stream.
 * With `mark`, trees, foliage and buildings are wrapped in groups; the
 * drawing itself and the random numbers it consumes stay the same.
 */
export function createGenerators(noiseRng: Rng, rng?: Rng, mark = false) {
  const noise = createNoise(noiseRng);
  const core: Core = createCore(noise, rng);
  const brush = createBrush(core);
  const leaf = (...args: Parameters<typeof brush.blob>) => {
    const out = brush.blob(...args);
    return typeof out == "string" && out ? groupOpen("leaf") + out + GROUP_CLOSE : out;
  };
  const Tree = createTree(core, mark ? { ...brush, leaf } : brush);
  const Man = createMan(core, brush);
  const Arch = createArch(core, brush, Man);
  if (mark) {
    wrapAll(Tree, "tree");
    wrapAll(Arch, "arch");
  }
  const Mount = createMount(core, brush, Tree, Arch);
  const water = createWater(core, brush);
  return { core, noise, brush, Tree, Man, Arch, Mount, water };
}
export type Generators = ReturnType<typeof createGenerators>;

/** Paints every planned item, in plan order, from the current random stream. */
export function paintPlan(gen: Generators, plan: PlanItem[]): Element[] {
  const { core, Mount, Arch, water } = gen;
  const { random, randChoice } = core;
  const out: Element[] = [];
  const add = (tag: string, x: number, y: number, depth: number, svg: string) => {
    // a stray NaN would hide the whole polyline, so park it off-canvas
    out.push({ tag, x, y, depth, svg: svg.includes("NaN") ? svg.replace(/NaN/g, "-1000") : svg });
  };

  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    if (p.tag == "mount") {
      add(p.tag, p.x, p.y, p.y, Mount.mountain(p.x, p.y, i * 2 * random()));
      add("water", p.x, p.y, p.y - 10000, water(p.x, p.y, i * 2));
    } else if (p.tag == "flatmount") {
      add(
        p.tag,
        p.x,
        p.y,
        p.y,
        Mount.flatMount(p.x, p.y, 2 * random() * Math.PI, {
          wid: 600 + random() * 400,
          hei: 100,
          cho: 0.5 + random() * 0.2,
        }),
      );
    } else if (p.tag == "distmount") {
      add(
        p.tag,
        p.x,
        p.y,
        p.y,
        Mount.distMount(p.x, p.y, random() * 100, {
          hei: 150,
          len: randChoice([500, 1000, 1500]),
        }),
      );
    } else if (p.tag == "boat") {
      add(
        p.tag,
        p.x,
        p.y,
        p.y,
        Arch.boat01(p.x, p.y, random(), {
          sca: p.y / 800,
          fli: randChoice([true, false]),
        }),
      );
    }
  }
  return out;
}

export interface Engine {
  readonly seed: string;
  /**
   * Generates chunk `index`, covering x in [index, index + 1) * CHUNK_WIDTH.
   * A chunk depends only on the seed and its index, never on which chunks
   * were generated before it.
   */
  generateChunk(index: number): Element[];
}

export function createEngine(seed: string): Engine {
  const gen = createGenerators(createRng(`${seed}/noise`), undefined, true);
  return {
    seed,
    generateChunk(index) {
      gen.core.setRng(createRng(`${seed}/chunk/${index}`));
      const xmin = index * CHUNK_WIDTH;
      return paintPlan(gen, planRange(gen.core, xmin, xmin + CHUNK_WIDTH));
    },
  };
}
