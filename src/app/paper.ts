import { createNoise } from "../gen/noise";
import { createRng } from "../gen/prng";

export const PAPER_SIZE = 512;

/**
 * Fills a PAPER_SIZE square canvas with the grainy, seamlessly tiling
 * rice-paper texture that sits behind the ink.
 */
export function paintPaper(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  seed: string,
) {
  const random = createRng(`${seed}/paper`);
  const noise = createNoise(random);
  const reso = PAPER_SIZE;
  // one quadrant, mirrored into the other three so the edges line up
  for (let i = 0; i < reso / 2 + 1; i++) {
    for (let j = 0; j < reso / 2 + 1; j++) {
      let c = 245 + noise.noise(i * 0.1, j * 0.1) * 10;
      c -= random() * 20;
      ctx.fillStyle = `rgb(${c.toFixed(0)},${(c * 0.95).toFixed(0)},${(c * 0.85).toFixed(0)})`;
      ctx.fillRect(i, j, 1, 1);
      ctx.fillRect(reso - i, j, 1, 1);
      ctx.fillRect(i, reso - j, 1, 1);
      ctx.fillRect(reso - i, reso - j, 1, 1);
    }
  }
}
