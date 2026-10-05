import { describe, expect, it } from "vitest";
import { createGenerators, paintPlan } from "../src/gen/engine";
import { planRange } from "../src/gen/planner";
import { loadLegacy } from "./legacy";

// The ported modules must produce exactly the SVG the 2018 page produced when
// they are fed the same random numbers. A second legacy realm supplies them.
function modern(seed: string) {
  const rng = loadLegacy(seed, false).random;
  return createGenerators(rng, rng);
}
const legacy = (seed: string) => loadLegacy(seed);

const cases: [string, (g: any) => string][] = [
  ["Tree.tree01", (g) => g.Tree.tree01(100, 500)],
  ["Tree.tree02", (g) => g.Tree.tree02(100, 500)],
  ["Tree.tree03", (g) => g.Tree.tree03(100, 500)],
  ["Tree.tree04", (g) => g.Tree.tree04(100, 500)],
  ["Tree.tree05", (g) => g.Tree.tree05(100, 500)],
  ["Tree.tree06", (g) => g.Tree.tree06(100, 500)],
  ["Tree.tree07", (g) => g.Tree.tree07(100, 500)],
  ["Tree.tree08", (g) => g.Tree.tree08(100, 500)],
  ["Mount.mountain", (g) => g.Mount.mountain(300, 500, 7)],
  ["Mount.flatMount", (g) => g.Mount.flatMount(300, 600, 3, { wid: 800, hei: 100, cho: 0.6 })],
  ["Mount.distMount", (g) => g.Mount.distMount(300, 250, 42, { hei: 150, len: 1000 })],
  ["Mount.rock", (g) => g.Mount.rock(300, 500, 5)],
  ["Arch.arch01", (g) => g.Arch.arch01(300, 500, 1)],
  ["Arch.arch02", (g) => g.Arch.arch02(300, 500, 1, { sto: 3, rot: 0.3 })],
  ["Arch.arch03", (g) => g.Arch.arch03(300, 500, 1)],
  ["Arch.arch04", (g) => g.Arch.arch04(300, 500, 1)],
  ["Arch.boat01", (g) => g.Arch.boat01(300, 500, 1, { sca: 0.6, fli: true })],
  ["Arch.transmissionTower01", (g) => g.Arch.transmissionTower01(300, 500, 1)],
  ["Man.man", (g) => g.Man.man(300, 500)],
  ["water", (g) => g.water(300, 500, 4)],
];

describe("ported drawing code matches the original", () => {
  for (const seed of ["golden", "1538000000000"]) {
    for (const [name, draw] of cases) {
      it(`${name} (seed ${seed})`, () => {
        const expected = draw(legacy(seed));
        const actual = draw(modern(seed));
        expect(expected.length).toBeGreaterThan(50);
        expect(actual).toBe(expected);
      });
    }

    it(`plans and paints a whole chunk like the original (seed ${seed})`, () => {
      const old = legacy(seed);
      // generates exactly the range [0, 512)
      old.chunkloader(513, -500);
      const expected = old.MEM.chunks.map((c: any) => c.canv).sort();

      const gen = modern(seed);
      const actual = paintPlan(gen, planRange(gen.core, 0, 512))
        .map((e) => e.svg)
        .sort();
      expect(actual.length).toBeGreaterThan(0);
      expect(actual).toEqual(expected);
    });

    it(`plans leftward chunks like the original (seed ${seed})`, () => {
      const plain = (p: any[]) => JSON.parse(JSON.stringify(p));
      const old = legacy(seed);
      const gen = modern(seed);
      expect(plain(planRange(gen.core, -512, 0))).toEqual(plain(old.mountplanner(-512, 0)));
    });
  }
});
