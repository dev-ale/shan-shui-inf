import type { PolyShape } from "./parse";

// What a season does to the painting. Not a colour filter: evergreens and
// leaf trees react differently, every tree picks its own colour, winter
// strips the leaves and lays snow, and the mountains take a light wash.

export type Season = "ink" | "spring" | "summer" | "autumn" | "winter";
export const SEASONS: Season[] = ["ink", "spring", "summer", "autumn", "winter"];

type RGB = readonly [number, number, number];

/** A faint cast each season lays over paper and sky (multiplied; white is none). */
export const SEASON_CAST: Record<Season, RGB> = {
  ink: [255, 255, 255],
  spring: [255, 250, 250],
  summer: [250, 253, 248],
  autumn: [255, 248, 238],
  // a grey sky, so the snow-covered land can stand out as bare paper
  winter: [192, 200, 212],
};

/** The season at a date, by northern-hemisphere months. */
export function seasonAt(date: Date): Season {
  const m = date.getMonth();
  return m < 2 || m == 11 ? "winter" : m < 5 ? "spring" : m < 8 ? "summer" : "autumn";
}

/** How to paint one shape. */
export interface Paint {
  /** a colour, or [top, bottom] for a wash that runs down the shape */
  fill: string | readonly [string, string];
  stroke: string;
  /** opacity multiplier */
  alpha: number;
  /** lay snow on top of the shape */
  snow: boolean;
}

// tree01 (ridge firs), tree05 (pines) and tree07 (dark woods) keep their needles
const EVERGREEN = new Set([1, 5, 7]);
// tree04 and tree06 carry their leaves at the ends of twigs and go bare in winter
const TWIGGY = new Set([4, 6]);

const BLOSSOM: RGB[] = [
  [234, 150, 172],
  [216, 108, 142],
  [242, 186, 196],
  [224, 128, 150],
];
const FRESH: RGB[] = [
  [142, 178, 92],
  [112, 162, 98],
  [164, 190, 104],
];
const LUSH: RGB[] = [
  [70, 128, 76],
  [92, 142, 80],
  [56, 114, 92],
  [108, 150, 72],
];
const FALL: [RGB, number][] = [
  [[222, 166, 44], 0.3], // gold
  [[216, 118, 38], 0.55], // orange
  [[182, 52, 42], 0.75], // crimson
  [[152, 86, 46], 0.9], // russet
  [[152, 152, 72], 1], // not turned yet
];
const NEEDLES: Record<Exclude<Season, "ink">, [RGB, number]> = {
  spring: [[64, 106, 84], 0.4],
  summer: [[38, 86, 74], 0.55],
  autumn: [[56, 84, 70], 0.4],
  winter: [[58, 74, 80], 0.4],
};
/** [top, bottom] of the wash on a mountain's body; it must stay opaque to hide what is behind */
const WASH: Partial<Record<Season, readonly [string, string]>> = {
  spring: ["rgb(255,255,251)", "rgb(222,236,204)"],
  summer: ["rgb(220,234,234)", "rgb(216,234,204)"],
  autumn: ["rgb(253,247,234)", "rgb(245,228,194)"],
};
/** colour the distant ranges lean towards */
const HAZE: Record<Exclude<Season, "ink">, RGB> = {
  spring: [108, 140, 138],
  summer: [78, 112, 152],
  autumn: [142, 110, 122],
  winter: [118, 130, 152],
};

const cache = new Map<string, string>();

/** Pulls an `rgb()`/`rgba()` colour towards `to` by `k` (0..1), keeping its opacity. */
export function tintColor(color: string, to: RGB, k: number): string {
  const key = `${to[0]},${to[1]},${to[2]},${k.toFixed(2)}${color}`;
  let out = cache.get(key);
  if (out === undefined) {
    const m = /^rgba?\(([^)]+)\)$/.exec(color.trim());
    const c = m ? m[1].split(",").map(Number) : [];
    if (c.length >= 3 && c.every(Number.isFinite)) {
      const mix = (v: number, t: number) => Math.round(v + (t - v) * k);
      out = `rgba(${mix(c[0], to[0])},${mix(c[1], to[1])},${mix(c[2], to[2])},${c[3] ?? 1})`;
    } else {
      out = color;
    }
    if (cache.size > 20000) {
      cache.clear();
    }
    cache.set(key, out);
  }
  return out;
}

/** A repeatable number in [0, 1) from a few integers. */
export function hash01(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = <T>(list: T[], r: number) => list[Math.min(list.length - 1, Math.floor(r * list.length))];

/**
 * Decides how `shape` (number `index` within an element of kind `tag`) is
 * painted in `season`, or returns null to leave it out. `treeSeed`
 * identifies the tree the shape belongs to, so a whole tree agrees on a
 * colour while its neighbours choose their own.
 */
export function paintShape(
  season: Exclude<Season, "ink">,
  tag: string,
  shape: PolyShape,
  treeSeed: number,
  index: number,
): Paint | null {
  const plain: Paint = { fill: shape.fill, stroke: shape.stroke, alpha: 1, snow: false };
  const tinted = (to: RGB, k: number, alpha = 1, snow = false): Paint => ({
    fill: tintColor(shape.fill, to, k),
    stroke: tintColor(shape.stroke, to, k),
    alpha,
    snow,
  });

  if (tag == "distmount") {
    return tinted(HAZE[season], 0.45);
  }

  if (shape.tree) {
    const evergreen = EVERGREEN.has(shape.tree);
    // tree07 is nothing but foliage; elsewhere only blobs drawn as leaves count
    if (!(shape.leaf || shape.tree == 7)) {
      return plain;
    }
    if (evergreen) {
      const [to, k] = NEEDLES[season];
      return tinted(to, k, 1, season == "winter");
    }
    const r1 = hash01(treeSeed, 1);
    const r2 = hash01(treeSeed, 2);
    // leaves of one tree differ a little among themselves
    const jitter = (hash01(treeSeed, 3, index) - 0.5) * 0.3;
    switch (season) {
      case "spring":
        // some trees are in blossom, the rest in new leaf
        return r1 < 0.5 ? tinted(pick(BLOSSOM, r2), 0.85 + jitter * 0.4) : tinted(pick(FRESH, r2), 0.7 + jitter);
      case "summer":
        return tinted(pick(LUSH, r2), 0.7 + jitter);
      case "autumn":
        return tinted(FALL.find(([, upTo]) => r1 < upTo)![0], 0.85 + jitter * 0.5);
      case "winter":
        // bare branches; bushier trees keep a few dry leaves
        if (TWIGGY.has(shape.tree) || hash01(treeSeed, 4, index) > 0.3) {
          return null;
        }
        return tinted([150, 146, 140], 0.6, 0.6);
    }
  }

  if (!shape.arch && (tag == "mount" || tag == "flatmount")) {
    if (shape.fill == "white") {
      const wash = WASH[season];
      return wash ? { ...plain, fill: wash } : plain;
    }
    if (season == "winter") {
      // under snow, less of the rock shows through
      return { ...plain, alpha: 0.55 };
    }
  }
  return plain;
}
