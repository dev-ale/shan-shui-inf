// @ts-nocheck
// Ported from the original single-file implementation (legacy/index.html).
// The drawing math is unchanged; randomness and noise are injected instead of global.
import { PolyTools } from "./polytools";
import { unNan, distance, mapval, loopNoise, bezmh, poly } from "./util";
import type { Core } from "./core";
import type { Brush } from "./brush";

export function createWater(core: Core, brush: Brush) {
  const { random, randChoice, normRand, wtrand, randGaussian, Noise } = core;
  const { stroke, blob, div, texture } = brush;
  function water(xoff, yoff, seed, args) {
    var args = args != undefined ? args : {};
    var hei = args.hei != undefined ? args.hei : 2;
    var len = args.len != undefined ? args.len : 800;
    var clu = args.clu != undefined ? args.clu : 10;
    var canv = "";

    var ptlist = [];
    var yk = 0;
    for (var i = 0; i < clu; i++) {
      ptlist.push([]);
      var xk = (random() - 0.5) * (len / 8);
      yk += random() * 5;
      var lk = len / 4 + random() * (len / 4);
      var reso = 5;
      for (var j = -lk; j < lk; j += reso) {
        ptlist[ptlist.length - 1].push([
          j + xk,
          Math.sin(j * 0.2) * hei * Noise.noise(j * 0.1) - 20 + yk,
        ]);
      }
    }

    for (var j = 1; j < ptlist.length; j += 1) {
      canv += stroke(
        ptlist[j].map(function(x) {
          return [x[0] + xoff, x[1] + yoff];
        }),
        {
          col:
            "rgba(100,100,100," + (0.3 + random() * 0.3).toFixed(3) + ")",
          wid: 1,
        },
      );
    }

    return canv;
  }
  return water as (
    xoff: number,
    yoff: number,
    seed: number,
    args?: { hei?: number; len?: number; clu?: number },
  ) => string;
}
