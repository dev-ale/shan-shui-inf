import type { Season } from "../gen/season";
import { LAYERS, MAIN, tileId, TILE_WIDTH, VIEW_HEIGHT } from "../gen/world";
import { Ambient } from "./ambient";
import { PAPER_SIZE, paintPaper } from "./paper";
import type { FromWorker, ToWorker } from "./protocol";
import { paintBodies, paintSky, paintSnowLight, skyAt } from "./sky";
import type { SceneMood } from "./sound";

/** Tallest backing store we render, in device pixels; beyond it the canvas is upscaled. */
const MAX_PIXEL_HEIGHT = 1800;
/** How long a freshly painted tile takes to soak into the paper. */
const FADE_MS = 450;
/** With nothing but mist and birds moving, this many frames a second is plenty. */
const AMBIENT_FRAME_MS = 33;

interface Tile {
  bitmap: ImageBitmap;
  arrived: number;
  mounts: number;
  boats: number;
}

/**
 * Shows the world on a canvas. Tiles are painted by a worker and cached
 * here. A frame is: paper, the sky's colour cast, sun or moon, then the ink
 * (far ranges, mist, birds, everything else) multiplied on top.
 */
export class View {
  /** hour of the day (0..24) the sky is painted for */
  hour = 12;
  /** drifting mist, birds and falling petals/leaves/snow */
  ambientOn = true;

  /** device pixels per world unit */
  private scale = 1;
  private tilePx = TILE_WIDTH;
  private ctx: CanvasRenderingContext2D;
  private ink = document.createElement("canvas");
  private inkCtx = this.ink.getContext("2d")!;
  private paper!: CanvasPattern;
  private paperSource = document.createElement("canvas");
  private ambient!: Ambient;
  private worker!: Worker;
  private currentSeason: Season = "ink";
  private tiles = new Map<number, Tile>();
  private dropped: number[] = [];
  private lastWant = "";
  private lastCamPx = NaN;
  private lastCamX = NaN;
  private lastDir = 1;
  private lastDraw = 0;
  private lastHourKey = -1;
  private dirty = true;
  private pending = new Map<number, (msg: FromWorker) => void>();
  private requestId = 0;
  private visibleMissing = false;

  constructor(
    private canvas: HTMLCanvasElement,
    seed: string,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.paperSource.width = this.paperSource.height = PAPER_SIZE;
    this.setSeed(seed);
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  /** world units per CSS pixel */
  get unitsPerPx(): number {
    return VIEW_HEIGHT / (this.canvas.clientHeight || 1);
  }

  /** width of the visible slice of the world, in world units */
  get viewWidth(): number {
    return this.canvas.width / this.scale;
  }

  /** true while part of what is on screen has not been painted yet */
  get busy(): boolean {
    return this.visibleMissing;
  }

  get season(): Season {
    return this.currentSeason;
  }
  set season(next: Season) {
    if (next != this.currentSeason) {
      this.currentSeason = next;
      // foliage colour is baked into the tiles
      this.clearTiles();
    }
  }

  /** Starts over with a different world. */
  setSeed(seed: string) {
    this.worker?.terminate();
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.onMessage(e.data);
    this.send({ type: "init", seed });
    this.clearTiles();
    this.dropped = [];
    paintPaper(this.paperSource.getContext("2d")!, seed);
    document.body.style.backgroundImage = `url(${this.paperSource.toDataURL("image/png")})`;
    this.ambient = new Ambient(seed);
    this.resize();
  }

  /** What is on screen, summed up for the soundscape. */
  mood(): SceneMood {
    const camPx = Math.round(this.lastCamX * this.scale) || 0;
    const first = Math.floor(camPx / this.tilePx);
    const last = Math.floor((camPx + this.canvas.width - 1) / this.tilePx);
    let mounts = 0;
    let boats = 0;
    for (let i = first; i <= last; i++) {
      const tile = this.tiles.get(tileId(MAIN, i));
      mounts += tile?.mounts ?? 0;
      boats += tile?.boats ?? 0;
    }
    return { density: Math.min(1, mounts / (last - first + 1) / 7), water: boats > 0 };
  }

  /** A view `width` world units wide from camera position `camX`, as an SVG document. */
  async exportSvg(camX: number, width: number): Promise<string> {
    const msg = await this.ask({ type: "svg", id: 0, camX, width });
    return msg.type == "svg" ? msg.svg : "";
  }

  /** The same stretch as a finished picture, `pixelHeight` pixels tall at most. */
  async exportPng(camX: number, width: number, pixelHeight: number): Promise<Blob> {
    // browsers refuse canvases much wider than this
    const scale = Math.min(pixelHeight / VIEW_HEIGHT, 32000 / width);
    const msg = await this.ask({ type: "png", id: 0, camX, width, scale, season: this.season, hour: this.hour });
    if (msg.type != "png" || !msg.blob) {
      throw new Error(msg.type == "png" ? msg.error : "export failed");
    }
    return msg.blob;
  }

  /**
   * Draws the world with its left edge at camera position `camX`, if
   * anything changed since the last frame.
   */
  render(camX: number, now: number) {
    const { ctx, canvas, ink, inkCtx, tilePx, scale } = this;
    const camPx = Math.round(camX * scale);
    if (camPx != this.lastCamPx) {
      if (!Number.isNaN(this.lastCamPx)) {
        this.lastDir = camPx > this.lastCamPx ? 1 : -1;
      }
      this.lastCamPx = camPx;
      this.dirty = true;
      this.request(camX);
    }
    // the sky only needs repainting every few seconds of clock time
    const hourKey = Math.round(this.hour * 600);
    if (hourKey != this.lastHourKey) {
      this.lastHourKey = hourKey;
      this.dirty = true;
    }
    const sinceDraw = now - this.lastDraw;
    if (!this.dirty && !(this.ambientOn && sinceDraw >= AMBIENT_FRAME_MS)) {
      return;
    }
    const w = canvas.width;
    const h = canvas.height;
    const look = skyAt(this.hour);
    if (this.ambientOn) {
      const dCam = Number.isNaN(this.lastCamX) ? 0 : camX - this.lastCamX;
      this.ambient.step(Math.min(0.1, sinceDraw / 1000), dCam, this.viewWidth, this.season);
    }
    this.lastCamX = camX;
    this.lastDraw = now;

    // --- the ink, back to front
    inkCtx.clearRect(0, 0, w, h);
    let fading = false;
    let missing = false;
    LAYERS.forEach((layer, li) => {
      const layerPx = Math.round(camX * layer.parallax * scale);
      const first = Math.floor(layerPx / tilePx);
      const last = Math.floor((layerPx + w - 1) / tilePx);
      const y = Math.round(layer.y0 * scale);
      for (let i = first; i <= last; i++) {
        const tile = this.tiles.get(tileId(li, i));
        if (!tile) {
          missing = true;
          continue;
        }
        const age = (now - tile.arrived) / FADE_MS;
        if (age < 1) {
          fading = true;
        }
        inkCtx.globalAlpha = Math.min(1, Math.max(0, age));
        inkCtx.drawImage(tile.bitmap, i * tilePx - layerPx, y);
      }
      inkCtx.globalAlpha = 1;
      if (this.ambientOn) {
        if (li == 0) {
          // mist pools at the foot of the far ranges; birds pass in front of it
          this.ambient.drawMist(inkCtx, scale, w, camX, 190, 340, 5, 0.8, 0.9);
          this.ambient.drawBirds(inkCtx, scale);
        } else {
          this.ambient.drawMist(inkCtx, scale, w, camX, 400, 600, 9, 1.1, 0.3);
        }
      }
    });

    // --- the frame
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.paper;
    ctx.fillRect(0, 0, w, h);
    paintSky(ctx, w, h, look, this.season);
    paintBodies(ctx, w, h, look, ink);
    if (this.season == "winter") {
      paintSnowLight(ctx, w, h, this.paper, ink);
    }
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(ink, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    if (this.ambientOn) {
      this.ambient.drawFalling(ctx, scale);
    }

    this.visibleMissing = missing;
    this.dirty = fading;
  }

  private resize() {
    const { canvas } = this;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW == 0 || cssH == 0) {
      return;
    }
    const pixelH = Math.min(Math.round(cssH * devicePixelRatio), MAX_PIXEL_HEIGHT);
    // whole pixels per tile, so neighbouring tiles meet without a seam
    const tilePx = Math.max(1, Math.round((TILE_WIDTH * pixelH) / VIEW_HEIGHT));
    const scale = tilePx / TILE_WIDTH;
    const height = Math.round(VIEW_HEIGHT * scale);
    const width = Math.max(1, Math.round((cssW * height) / cssH));
    if (scale != this.scale || this.tilePx != tilePx) {
      this.clearTiles();
      this.scale = scale;
      this.tilePx = tilePx;
    }
    if (canvas.width != width || canvas.height != height) {
      canvas.width = this.ink.width = width;
      canvas.height = this.ink.height = height;
    }
    // the paper grain stays one CSS pixel per texel
    this.paper = this.ctx.createPattern(this.paperSource, "repeat")!;
    this.paper.setTransform(new DOMMatrix().scale(height / cssH));
    this.lastCamPx = NaN;
    this.dirty = true;
  }

  /** Tells the worker which tiles to paint next, and forgets far-away ones. */
  private request(camX: number) {
    const { tilePx } = this;
    const onScreen: number[] = [];
    const nearby: number[] = [];
    const wanted = new Set<number>();

    // nearest layer first: it carries most of the picture
    for (let li = LAYERS.length - 1; li >= 0; li--) {
      const layerPx = Math.round(camX * LAYERS[li].parallax * this.scale);
      const first = Math.floor(layerPx / tilePx);
      const last = Math.floor((layerPx + this.canvas.width - 1) / tilePx);
      const span = last - first + 1;
      const ahead = span + 2;
      const behind = Math.ceil(span / 2) + 1;
      const lo = first - (this.lastDir > 0 ? behind : ahead);
      const hi = last + (this.lastDir > 0 ? ahead : behind);
      const keep = Math.ceil(span * 1.5) + 3;
      for (let i = first - keep; i <= last + keep; i++) {
        wanted.add(tileId(li, i));
      }
      const push = (list: number[], i: number) => {
        const id = tileId(li, i);
        if (!this.tiles.has(id)) {
          list.push(id);
        }
      };
      // onward in the direction of travel first
      if (this.lastDir > 0) {
        for (let i = first; i <= last; i++) push(onScreen, i);
        for (let i = last + 1; i <= hi; i++) push(nearby, i);
        for (let i = first - 1; i >= lo; i--) push(nearby, i);
      } else {
        for (let i = last; i >= first; i--) push(onScreen, i);
        for (let i = first - 1; i >= lo; i--) push(nearby, i);
        for (let i = last + 1; i <= hi; i++) push(nearby, i);
      }
    }

    for (const [id, tile] of this.tiles) {
      if (!wanted.has(id)) {
        tile.bitmap.close();
        this.tiles.delete(id);
        this.dropped.push(id);
      }
    }

    const order = [...onScreen, ...nearby];
    const key = `${this.scale}:${this.season}:${order.join(",")}`;
    if (key != this.lastWant || this.dropped.length > 0) {
      this.lastWant = key;
      this.send({ type: "want", scale: this.scale, season: this.season, tiles: order, dropped: this.dropped });
      this.dropped = [];
    }
  }

  private onMessage(msg: FromWorker) {
    if (msg.type == "tile") {
      if (msg.scale != this.scale || msg.season != this.season) {
        msg.bitmap.close();
        return;
      }
      this.tiles.get(msg.id)?.bitmap.close();
      this.tiles.set(msg.id, { bitmap: msg.bitmap, arrived: performance.now(), mounts: msg.mounts, boats: msg.boats });
      this.dirty = true;
    } else {
      this.pending.get(msg.id)?.(msg);
      this.pending.delete(msg.id);
    }
  }

  private ask(msg: Extract<ToWorker, { id: number }>): Promise<FromWorker> {
    const id = ++this.requestId;
    this.send({ ...msg, id });
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  private clearTiles() {
    for (const tile of this.tiles.values()) {
      tile.bitmap.close();
    }
    this.tiles.clear();
    this.dropped = [];
    this.lastWant = "";
    this.lastCamPx = NaN;
    this.dirty = true;
  }

  private send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }
}
