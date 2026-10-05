/// <reference lib="webworker" />
import { createEngine } from "../gen/engine";
import { drawSlice } from "../gen/raster";
import type { Season } from "../gen/season";
import { exportSvg, LAYERS, tileOf, TILE_WIDTH, VIEW_HEIGHT, World } from "../gen/world";
import { PAPER_SIZE, paintPaper } from "./paper";
import type { FromWorker, ToWorker } from "./protocol";
import { paintBodies, paintSky, paintSnowLight, skyAt } from "./sky";

// Generates the world and paints it into tiles off the main thread, so the
// page only ever has to blit finished bitmaps.

let seed = "";
let world: World | undefined;
let scale = 1;
let season: Season = "ink";
let queue: number[] = [];
const sent = new Set<number>();
let running = false;

const post = (msg: FromWorker, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type == "init") {
    seed = msg.seed;
    world = new World(createEngine(seed));
    queue = [];
    sent.clear();
  } else if (msg.type == "want") {
    if (msg.scale != scale || msg.season != season) {
      scale = msg.scale;
      season = msg.season;
      sent.clear();
    }
    for (const t of msg.dropped) {
      sent.delete(t);
    }
    queue = msg.tiles.filter((t) => !sent.has(t));
    void run();
  } else if (msg.type == "svg" && world) {
    post({ type: "svg", id: msg.id, svg: exportSvg(world.engine, msg.camX, msg.width) });
  } else if (msg.type == "png" && world) {
    renderPng(world, msg).then(
      (blob) => post({ type: "png", id: msg.id, blob }),
      (err) => post({ type: "png", id: msg.id, error: String(err) }),
    );
  }
};

// lets newer messages in between units of work
const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function run() {
  if (running) {
    return;
  }
  running = true;
  while (world && queue.length > 0) {
    const id = queue[0];
    const { layer, index } = tileOf(id);
    const band = LAYERS[layer];
    const x0 = index * TILE_WIDTH;
    const x1 = x0 + TILE_WIDTH;
    const need = world.missing(x0, x1);
    if (need !== undefined) {
      world.chunk(need);
    } else {
      const s = scale;
      const top = Math.round(band.y0 * s);
      const canvas = new OffscreenCanvas(Math.round(TILE_WIDTH * s), Math.round(band.y1 * s) - top);
      const drawables = world.drawablesIn(x0, x1, layer);
      drawSlice(canvas.getContext("2d")!, drawables, x0, x1, s, { season, offsetY: top });
      const bitmap = canvas.transferToImageBitmap();
      sent.add(id);
      queue = queue.filter((t) => t != id);
      post(
        {
          type: "tile",
          id,
          scale: s,
          season,
          bitmap,
          mounts: drawables.filter((d) => d.tag == "mount").length,
          boats: drawables.filter((d) => d.tag == "boat").length,
        },
        [bitmap],
      );
    }
    await breathe();
  }
  running = false;
}

/** Paints a whole stretch of the scroll, the way the page composes a frame. */
async function renderPng(w: World, msg: Extract<ToWorker, { type: "png" }>): Promise<Blob> {
  const s = msg.scale;
  const width = Math.round(msg.width * s);
  const height = Math.round(VIEW_HEIGHT * s);

  const ink = new OffscreenCanvas(width, height);
  const inkCtx = ink.getContext("2d")!;
  LAYERS.forEach((layer, li) => {
    const x0 = msg.camX * layer.parallax;
    const x1 = x0 + msg.width;
    drawSlice(inkCtx, w.drawablesIn(x0, x1, li), x0, x1, s, { season: msg.season });
  });

  const paper = new OffscreenCanvas(PAPER_SIZE, PAPER_SIZE);
  paintPaper(paper.getContext("2d")!, seed);
  const out = new OffscreenCanvas(width, height);
  const ctx = out.getContext("2d", { alpha: false })!;
  const pattern = ctx.createPattern(paper, "repeat")!;
  // grain sized as on a 900 pixel tall screen
  pattern.setTransform(new DOMMatrix().scale(height / 900));
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, width, height);
  const look = skyAt(msg.hour);
  paintSky(ctx, width, height, look, msg.season);
  paintBodies(ctx, width, height, look, ink);
  if (msg.season == "winter") {
    paintSnowLight(ctx, width, height, pattern, ink);
  }
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(ink, 0, 0);
  ink.width = ink.height = 0;
  return out.convertToBlob({ type: "image/png" });
}
