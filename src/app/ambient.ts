import { createNoise } from "../gen/noise";
import { createRng } from "../gen/prng";
import type { Season } from "../gen/season";
import { VIEW_HEIGHT } from "../gen/world";

// Things that move on their own: drifting mist, passing birds, and whatever
// the season lets fall. None of it is part of the generated world; it is
// drawn fresh every frame on top of the tiles.

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** world units one mist texture spans before repeating */
const MIST_SPAN = 1500;

/** A horizontally seamless field of soft white patches. */
function createMistTexture(seed: string): HTMLCanvasElement {
  const w = 768;
  const h = 128;
  const noise = createNoise(createRng(`${seed}/mist`));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    // walking a circle through the noise makes the left edge meet the right
    const a = (x / w) * Math.PI * 2;
    const nx = 3 + Math.cos(a) * 1.6;
    const nz = 3 + Math.sin(a) * 1.6;
    for (let y = 0; y < h; y++) {
      const v = y / h;
      const n = noise.noise(nx, v * 2.2, nz);
      const edge = Math.sin(v * Math.PI) ** 1.5;
      const alpha = Math.min(1, Math.max(0, (n - 0.38) * 3.2)) * edge;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

interface Bird {
  dx: number;
  dy: number;
  size: number;
  phase: number;
}
interface Flock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  birds: Bird[];
}
interface Flake {
  x: number;
  y: number;
  size: number;
  fall: number;
  phase: number;
}

const FALLING: Partial<Record<Season, { count: number; color: string; fall: [number, number]; size: [number, number]; round: boolean }>> = {
  spring: { count: 60, color: "rgba(214,128,150,0.85)", fall: [16, 34], size: [1.6, 3.2], round: false },
  autumn: { count: 45, color: "rgba(176,90,38,0.85)", fall: [26, 48], size: [1.8, 3.6], round: false },
  winter: { count: 150, color: "rgba(255,255,255,0.95)", fall: [28, 62], size: [0.9, 2.3], round: true },
};

export class Ambient {
  private mist: HTMLCanvasElement;
  private flocks: Flock[] = [];
  private nextFlock = 4 + Math.random() * 8;
  private flakes: Flake[] = [];
  private flakeSeason?: Season;
  private clock = 0;

  constructor(seed: string) {
    this.mist = createMistTexture(seed);
  }

  /** Moves everything on by `dt` seconds; `dCam` is how far the camera travelled meanwhile. */
  step(dt: number, dCam: number, viewWidth: number, season: Season) {
    this.clock += dt;

    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.nextFlock = 18 + Math.random() * 40;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const n = 3 + Math.floor(Math.random() * 5);
      this.flocks.push({
        x: dir > 0 ? -80 : viewWidth + 80,
        y: 70 + Math.random() * 170,
        vx: dir * (38 + Math.random() * 26),
        vy: -3 + Math.random() * 6,
        // a loose V behind the leader
        birds: Array.from({ length: n }, (_, i) => {
          const rank = Math.ceil(i / 2);
          return {
            dx: -dir * rank * (11 + Math.random() * 5),
            dy: (i % 2 ? 1 : -1) * rank * (5 + Math.random() * 4),
            size: 4 + Math.random() * 2.5,
            phase: Math.random() * 6,
          };
        }),
      });
    }
    for (const f of this.flocks) {
      // far away, so they barely shift as the view scrolls
      f.x += f.vx * dt - dCam * 0.3;
      f.y += f.vy * dt;
    }
    this.flocks = this.flocks.filter((f) => f.x > -400 && f.x < viewWidth + 400);

    const kind = FALLING[season];
    if (season != this.flakeSeason) {
      this.flakeSeason = season;
      this.flakes = kind
        ? Array.from({ length: kind.count }, () => ({
            x: Math.random() * viewWidth,
            y: Math.random() * VIEW_HEIGHT,
            size: kind.size[0] + Math.random() * (kind.size[1] - kind.size[0]),
            fall: kind.fall[0] + Math.random() * (kind.fall[1] - kind.fall[0]),
            phase: Math.random() * 6,
          }))
        : [];
    }
    const span = viewWidth + 40;
    for (const p of this.flakes) {
      p.y += p.fall * dt;
      // close to the eye, so they sweep past faster than the land
      p.x += Math.sin(this.clock * 0.9 + p.phase) * 14 * dt - 9 * dt - dCam * 1.3;
      if (p.y > VIEW_HEIGHT + 10) {
        p.y = -10;
        p.x = Math.random() * span;
      }
      p.x = ((((p.x + 20) % span) + span) % span) - 20;
    }
  }

  /**
   * A band of mist between world y `y0` and `y1`. Drawn white: once the ink
   * is multiplied onto the paper, white is simply bare paper.
   */
  drawMist(ctx: Ctx2D, unit: number, width: number, camX: number, y0: number, y1: number, speed: number, parallax: number, alpha: number) {
    const span = MIST_SPAN * unit;
    const shift = ((camX * parallax + this.clock * speed) * unit) % span;
    ctx.globalAlpha = alpha;
    for (let x = -(((shift % span) + span) % span); x < width; x += span) {
      ctx.drawImage(this.mist, x, y0 * unit, span + 1, (y1 - y0) * unit);
    }
    ctx.globalAlpha = 1;
  }

  drawBirds(ctx: Ctx2D, unit: number) {
    ctx.strokeStyle = "rgba(70,70,70,0.75)";
    ctx.lineWidth = 1.1 * unit;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const f of this.flocks) {
      for (const b of f.birds) {
        const x = (f.x + b.dx) * unit;
        const y = (f.y + b.dy) * unit;
        const s = b.size * unit;
        const lift = Math.sin(this.clock * 9 + b.phase) * s * 0.55;
        ctx.moveTo(x - s, y - lift);
        ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.35 - lift * 0.3, x, y);
        ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.35 - lift * 0.3, x + s, y - lift);
      }
    }
    ctx.stroke();
  }

  /** Petals, leaves or snow, straight onto the finished frame. */
  drawFalling(ctx: Ctx2D, unit: number) {
    const kind = this.flakeSeason && FALLING[this.flakeSeason];
    if (!kind) {
      return;
    }
    ctx.fillStyle = kind.color;
    ctx.beginPath();
    for (const p of this.flakes) {
      const x = p.x * unit;
      const y = p.y * unit;
      const r = p.size * unit;
      if (kind.round) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      } else {
        // a small leaf shape that tumbles as it falls
        const a = this.clock * 1.7 + p.phase;
        ctx.moveTo(x + r, y);
        ctx.ellipse(x, y, r, r * 0.45, a, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
}
