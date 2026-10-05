import type { Noise } from "./noise";
import type { Rng } from "./prng";
import { mapval } from "./util";

/** Randomness and noise shared by all drawing modules. */
export interface Core {
  random: Rng;
  randChoice<T>(arr: T[]): T;
  normRand(m: number, M: number): number;
  wtrand(func: (x: number) => number): number;
  randGaussian(): number;
  Noise: Noise;
  /** Switches the stream that `random` and its helpers draw from. */
  setRng(rng: Rng): void;
}

export function createCore(noise: Noise, rng?: Rng): Core {
  let current: Rng =
    rng ??
    (() => {
      throw new Error("no random stream selected");
    });
  const random = () => current();

  function randChoice<T>(arr: T[]): T {
    return arr[Math.floor(arr.length * random())];
  }

  function normRand(m: number, M: number) {
    return mapval(random(), 0, 1, m, M);
  }

  function wtrand(func: (x: number) => number): number {
    for (;;) {
      const x = random();
      const y = random();
      if (y < func(x)) {
        return x;
      }
    }
  }

  function randGaussian() {
    return (
      wtrand(function (x) {
        return Math.pow(Math.E, -24 * Math.pow(x - 0.5, 2));
      }) *
        2 -
      1
    );
  }

  return {
    random,
    randChoice,
    normRand,
    wtrand,
    randGaussian,
    Noise: noise,
    setRng(next) {
      current = next;
    },
  };
}
