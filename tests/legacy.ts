import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../legacy/index.html", import.meta.url), "utf8");
// every <script> that comes before <body>: PRNG, noise, drawing code, planner
const scripts = [...html.split("<body")[0].matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => m[1],
);

/**
 * Runs the original 2018 page's scripts in an isolated realm seeded with
 * `seed`. By default the noise table is drawn right after seeding, which is
 * what the new code does too. Returns the realm's drawing globals and its
 * seeded Math.random.
 */
export function loadLegacy(seed: string, drawNoiseTable = true): any {
  const noop = () => {};
  const sandbox: any = {
    console: { log: noop },
    document: { addEventListener: noop },
    window: { btoa, location: { href: "http://localhost/?seed=" + seed } },
  };
  const context = vm.createContext(sandbox);
  for (const s of scripts) {
    vm.runInContext(s, context);
  }
  if (drawNoiseTable) {
    vm.runInContext("Noise.noise(0)", context);
  }
  return vm.runInContext(
    "({ Tree, Mount, Arch, Man, water, mountplanner, chunkloader, MEM, random: Math.random })",
    context,
  );
}
