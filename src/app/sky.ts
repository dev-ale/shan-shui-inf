import { SEASON_CAST, type Season } from "../gen/season";
import { VIEW_HEIGHT } from "../gen/world";

// Time of day: a colour cast multiplied over the paper, a red sun at dawn
// and dusk, a moon at night. Pure canvas code, shared by page and worker.

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type RGB = readonly [number, number, number];

export type SkyMode = "auto" | "dawn" | "day" | "dusk" | "night";
export const SKY_MODES: SkyMode[] = ["auto", "dawn", "day", "dusk", "night"];

export interface SkyLook {
  /** colours multiplied over the paper at the top and at the horizon */
  top: RGB;
  horizon: RGB;
  /** 0..1 */
  sun: number;
  /** world y of the sun's centre */
  sunY: number;
  /** 0..1 */
  moon: number;
}

const DAY: RGB = [255, 255, 255];
const NIGHT_TOP: RGB = [96, 112, 156];
const NIGHT_HORIZON: RGB = [146, 158, 190];

/** hour, top, horizon, darkness */
const KEYS: [number, RGB, RGB, number][] = [
  [0, NIGHT_TOP, NIGHT_HORIZON, 1],
  [4.6, NIGHT_TOP, NIGHT_HORIZON, 1],
  [6.2, [214, 218, 238], [255, 224, 208], 0],
  [8.5, DAY, DAY, 0],
  [16.5, DAY, DAY, 0],
  [18.6, [226, 212, 224], [255, 218, 190], 0],
  [20.4, NIGHT_TOP, NIGHT_HORIZON, 1],
  [24, NIGHT_TOP, NIGHT_HORIZON, 1],
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** 0 outside [a, c], rising to 1 at b */
const peak = (x: number, a: number, b: number, c: number) =>
  x <= a || x >= c ? 0 : x < b ? (x - a) / (b - a) : (c - x) / (c - b);

/** The hour (0..24) a mode stands for; "auto" follows the given clock. */
export function hourOf(mode: SkyMode, now: Date): number {
  switch (mode) {
    case "dawn":
      return 6.2;
    case "day":
      return 12;
    case "dusk":
      return 18.6;
    case "night":
      return 23;
    default:
      return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }
}

export function skyAt(hour: number): SkyLook {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) {
    i++;
  }
  const [h0, top0, hor0, dark0] = KEYS[i];
  const [h1, top1, hor1, dark1] = KEYS[i + 1];
  const t = (h - h0) / (h1 - h0);
  const rising = peak(h, 5.0, 6.2, 8.4);
  const setting = peak(h, 16.8, 18.6, 20.2);
  return {
    top: mix(top0, top1, t),
    horizon: mix(hor0, hor1, t),
    sun: Math.min(1, Math.max(rising, setting) * 1.6),
    // climbs out of the far ranges in the morning, sinks back in the evening
    sunY: rising > 0 ? lerp(300, 100, (h - 5.0) / 3.4) : lerp(100, 300, (h - 16.8) / 3.4),
    moon: lerp(dark0, dark1, t),
  };
}

const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const times = (a: RGB, b: RGB): RGB => [(a[0] * b[0]) / 255, (a[1] * b[1]) / 255, (a[2] * b[2]) / 255];

/** Multiplies the hour's and the season's colour cast over what is on the canvas. */
export function paintSky(ctx: Ctx2D, w: number, h: number, look: SkyLook, season: Season) {
  const cast = SEASON_CAST[season];
  const top = times(look.top, cast);
  const horizon = times(look.horizon, cast);
  if (Math.min(...top, ...horizon) > 254.5) {
    return;
  }
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(top));
  g.addColorStop(0.42, css(horizon));
  g.addColorStop(1, css(mix(horizon, top, 0.5)));
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

let scratch: OffscreenCanvas | undefined;

/**
 * Paints sun and moon, cut out wherever `ink` already covers the canvas, so
 * they sit behind the mountains. Call it before the ink goes on.
 */
export function paintBodies(
  ctx: Ctx2D,
  w: number,
  h: number,
  look: SkyLook,
  ink: CanvasImageSource | undefined,
) {
  const unit = h / VIEW_HEIGHT;
  const body = (cx: number, cy: number, radius: number, draw: (c: OffscreenCanvasRenderingContext2D, r: number) => void) => {
    const size = Math.ceil(radius * 2) + 2;
    const x = Math.round(cx - size / 2);
    const y = Math.round(cy - size / 2);
    if (!scratch || scratch.width < size) {
      scratch = new OffscreenCanvas(size, size);
    }
    const c = scratch.getContext("2d")!;
    c.globalCompositeOperation = "source-over";
    c.clearRect(0, 0, scratch.width, scratch.height);
    c.save();
    c.translate(size / 2, size / 2);
    draw(c, radius);
    c.restore();
    if (ink) {
      c.globalCompositeOperation = "destination-out";
      c.drawImage(ink, x, y, size, size, 0, 0, size, size);
    }
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.drawImage(scratch, 0, 0, size, size, x, y, size, size);
    ctx.restore();
  };

  if (look.sun > 0.01) {
    body(w * 0.72, look.sunY * unit, 26 * unit, (c, r) => {
      c.fillStyle = `rgba(196,58,40,${0.82 * look.sun})`;
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.fill();
    });
  }
  if (look.moon > 0.01) {
    body(w * 0.24, 105 * unit, 70 * unit, (c, r) => {
      const halo = c.createRadialGradient(0, 0, r * 0.3, 0, 0, r);
      halo.addColorStop(0, `rgba(255,250,232,${0.28 * look.moon})`);
      halo.addColorStop(1, "rgba(255,250,232,0)");
      c.fillStyle = halo;
      c.fillRect(-r, -r, r * 2, r * 2);
      c.fillStyle = `rgba(255,251,238,${0.95 * look.moon})`;
      c.beginPath();
      c.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      c.fill();
    });
  }
}

let snowScratch: OffscreenCanvas | undefined;

/**
 * Winter only: puts bare, bright paper back wherever `ink` covers the
 * canvas. The sky and the water stay grey and the land reads as snow, the
 * way snow scenes are painted in ink: by leaving the paper alone. Call it
 * before the ink goes on.
 */
export function paintSnowLight(
  ctx: Ctx2D,
  w: number,
  h: number,
  paper: CanvasPattern,
  ink: CanvasImageSource,
) {
  if (!snowScratch || snowScratch.width != w || snowScratch.height != h) {
    snowScratch = new OffscreenCanvas(w, h);
  }
  const c = snowScratch.getContext("2d")!;
  c.globalCompositeOperation = "copy";
  c.fillStyle = paper;
  c.fillRect(0, 0, w, h);
  c.globalCompositeOperation = "destination-in";
  c.drawImage(ink, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.92;
  ctx.drawImage(snowScratch, 0, 0);
  ctx.restore();
}
