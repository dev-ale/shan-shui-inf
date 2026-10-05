import type { Drawable } from "./parse";
import { hash01, paintShape, type Season } from "./season";

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SliceOptions {
  /** paints the slice as it looks in this season; "ink" is the plain original */
  season?: Season;
  /** shifts the drawing up by this many pixels, for tiles that start below y = 0 */
  offsetY?: number;
}

/**
 * Paints the slice [x0, x1) of the given drawables (already in painting
 * order) onto a canvas `scale` pixels per world unit, matching how a browser
 * would render the equivalent SVG polylines.
 */
export function drawSlice(
  ctx: Ctx2D,
  drawables: Drawable[],
  x0: number,
  x1: number,
  scale: number,
  { season = "ink", offsetY = 0 }: SliceOptions = {},
) {
  ctx.miterLimit = 4;
  for (const d of drawables) {
    if (d.maxX < x0 || d.minX > x1) {
      continue;
    }
    ctx.setTransform(scale, 0, 0, scale, (d.originX - x0) * scale, -offsetY);
    const lo = x0 - d.originX;
    const hi = x1 - d.originX;
    // the same for every tile the element appears on
    const elementSeed = Math.round(d.originX * 7 + d.depth * 13);
    for (let n = 0; n < d.shapes.length; n++) {
      const s = d.shapes[n];
      if (s.maxX < lo || s.minX > hi) {
        continue;
      }
      if (s.kind == "poly") {
        const paint = season == "ink" ? null : paintShape(season, d.tag, s, elementSeed + s.treeId * 977, n);
        if (season != "ink" && !paint) {
          continue;
        }
        const p = s.pts;
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        for (let i = 2; i < p.length; i += 2) {
          ctx.lineTo(p[i], p[i + 1]);
        }
        if (!paint) {
          ctx.fillStyle = s.fill;
          ctx.fill();
          if (s.width > 0) {
            ctx.strokeStyle = s.stroke;
            ctx.lineWidth = s.width;
            ctx.stroke();
          }
          continue;
        }
        if (typeof paint.fill == "string") {
          ctx.fillStyle = paint.fill;
        } else {
          const wash = ctx.createLinearGradient(0, s.minY, 0, s.maxY);
          wash.addColorStop(0, paint.fill[0]);
          wash.addColorStop(1, paint.fill[1]);
          ctx.fillStyle = wash;
        }
        ctx.globalAlpha = paint.alpha;
        ctx.fill();
        if (s.width > 0) {
          ctx.strokeStyle = paint.stroke;
          ctx.lineWidth = s.width;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (paint.snow && hash01(elementSeed, s.treeId, n) < 0.7) {
          // the same shape again, nudged up and to the left, in white:
          // snow resting on the upper side of the boughs
          ctx.save();
          ctx.clip();
          ctx.translate(-0.8, -2.2);
          ctx.beginPath();
          ctx.moveTo(p[0], p[1]);
          for (let i = 2; i < p.length; i += 2) {
            ctx.lineTo(p[i], p[i + 1]);
          }
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          ctx.fill();
          ctx.restore();
        }
      } else {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate((s.rot * Math.PI) / 180);
        ctx.font = `${s.size}px Verdana, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = s.fill;
        ctx.fillText(s.text, 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
