// @ts-nocheck
// Ported from the original single-file implementation (legacy/index.html).
// The drawing math is unchanged; randomness and noise are injected instead of global.
import { PolyTools } from "./polytools";

export function unNan(plist) {
  if (typeof plist != "object" || plist == null) {
    return plist || 0;
  } else {
    return plist.map(unNan);
  }
}
//console.log(unNan([[undefined,[NaN,NaN],null],false,1]))

export function distance(p0, p1) {
  return Math.sqrt(Math.pow(p0[0] - p1[0], 2) + Math.pow(p0[1] - p1[1], 2));
}

export function mapval(value, istart, istop, ostart, ostop) {
  return (
    ostart + (ostop - ostart) * (((value - istart) * 1.0) / (istop - istart))
  );
}
export function loopNoise(nslist) {
  var dif = nslist[nslist.length - 1] - nslist[0];
  var bds = [100, -100];
  for (var i = 0; i < nslist.length; i++) {
    nslist[i] += (dif * (nslist.length - 1 - i)) / (nslist.length - 1);
    if (nslist[i] < bds[0]) bds[0] = nslist[i];
    if (nslist[i] > bds[1]) bds[1] = nslist[i];
  }
  for (var i = 0; i < nslist.length; i++) {
    nslist[i] = mapval(nslist[i], bds[0], bds[1], 0, 1);
  }
}

export function bezmh(P, w) {
  w = w == undefined ? 1 : w;
  if (P.length == 2) {
    P = [P[0], PolyTools.midPt(P[0], P[1]), P[1]];
  }
  var plist = [];
  for (var j = 0; j < P.length - 2; j++) {
    var p0;
    var p1;
    var p2;
    if (j == 0) {
      p0 = P[j];
    } else {
      p0 = PolyTools.midPt(P[j], P[j + 1]);
    }
    p1 = P[j + 1];
    if (j == P.length - 3) {
      p2 = P[j + 2];
    } else {
      p2 = PolyTools.midPt(P[j + 1], P[j + 2]);
    }
    var pl = 20;
    for (var i = 0; i < pl + (j == P.length - 3); i += 1) {
      var t = i / pl;
      var u = Math.pow(1 - t, 2) + 2 * t * (1 - t) * w + t * t;
      plist.push([
        (Math.pow(1 - t, 2) * p0[0] +
          2 * t * (1 - t) * p1[0] * w +
          t * t * p2[0]) /
          u,
        (Math.pow(1 - t, 2) * p0[1] +
          2 * t * (1 - t) * p1[1] * w +
          t * t * p2[1]) /
          u,
      ]);
    }
  }
  return plist;
}

export function poly(plist, args) {
  var args = args != undefined ? args : {};
  var xof = args.xof != undefined ? args.xof : 0;
  var yof = args.yof != undefined ? args.yof : 0;
  var fil = args.fil != undefined ? args.fil : "rgba(0,0,0,0)";
  var str = args.str != undefined ? args.str : fil;
  var wid = args.wid != undefined ? args.wid : 0;

  var canv = "<polyline points='";
  for (var i = 0; i < plist.length; i++) {
    canv +=
      " " +
      (plist[i][0] + xof).toFixed(1) +
      "," +
      (plist[i][1] + yof).toFixed(1);
  }
  canv +=
    "' style='fill:" +
    fil +
    ";stroke:" +
    str +
    ";stroke-width:" +
    wid +
    "'/>";
  return canv;
}
