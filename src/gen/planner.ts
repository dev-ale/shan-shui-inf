import type { Core } from "./core";

export type PlanTag = "mount" | "distmount" | "flatmount" | "boat";

export interface PlanItem {
  tag: PlanTag;
  x: number;
  y: number;
  h?: number;
}

/**
 * Decides what goes where between xmin and xmax: mountains on the peaks of
 * the noise field, distant ranges every 1000 units, flat hills where no
 * mountain stands, and the occasional boat.
 */
export function planRange(core: Core, xmin: number, xmax: number): PlanItem[] {
  const { random, Noise } = core;

  function locmax(x: number, y: number, f: (x: number, y: number) => number, r: number) {
    const z0 = f(x, y);
    if (z0 <= 0.3) {
      return false;
    }
    for (let i = x - r; i < x + r; i++) {
      for (let j = y - r; j < y + r; j++) {
        if (f(i, j) > z0) {
          return false;
        }
      }
    }
    return true;
  }

  const reg: PlanItem[] = [];
  function chadd(r: PlanItem, mind = 10) {
    for (let k = 0; k < reg.length; k++) {
      if (Math.abs(reg[k].x - r.x) < mind) {
        return false;
      }
    }
    reg.push(r);
    return true;
  }

  const samp = 0.03;
  const ns = (x: number, _y?: number) => Math.max(Noise.noise(x * samp) - 0.55, 0) * 2;
  const yr = (x: number) => Noise.noise(x * 0.01, Math.PI);

  const xstep = 5;
  const mwid = 200;
  // how many mountains cover each x cell of this range
  const cover = new Map<number, number>();
  for (let i = xmin; i < xmax; i += xstep) {
    cover.set(Math.floor(i / xstep), 0);
  }

  for (let i = xmin; i < xmax; i += xstep) {
    for (let j = 0; j < yr(i) * 480; j += 30) {
      if (locmax(i, j, ns, 2)) {
        const xof = i + 2 * (random() - 0.5) * 500;
        const yof = j + 300;
        if (chadd({ tag: "mount", x: xof, y: yof, h: ns(i, j) })) {
          for (let k = Math.floor((xof - mwid) / xstep); k < (xof + mwid) / xstep; k++) {
            const n = cover.get(k);
            if (n !== undefined) {
              cover.set(k, n + 1);
            }
          }
        }
      }
    }
    if (Math.abs(i) % 1000 < Math.max(1, xstep - 1)) {
      chadd({ tag: "distmount", x: i, y: 280 - random() * 50, h: ns(i) });
    }
  }

  for (let i = xmin; i < xmax; i += xstep) {
    if (cover.get(Math.floor(i / xstep)) == 0) {
      if (random() < 0.01) {
        for (let j = 0; j < 4 * random(); j++) {
          chadd({
            tag: "flatmount",
            x: i + 2 * (random() - 0.5) * 700,
            y: 700 - j * 50,
            h: ns(i, j),
          });
        }
      }
    }
  }

  for (let i = xmin; i < xmax; i += xstep) {
    if (random() < 0.2) {
      chadd({ tag: "boat", x: i, y: 300 + random() * 390 }, 400);
    }
  }

  return reg;
}
