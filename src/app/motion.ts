/**
 * The camera: where the left edge of the view sits in the world, and
 * everything that moves it (wheel, drag with momentum, keys, auto-scroll).
 */
export class Motion {
  /** world x of the view's left edge */
  x = 0;
  auto = false;
  /** auto-scroll speed in world units per second */
  autoSpeed = 40;
  /** called on the first deliberate movement by the user */
  onInteract?: () => void;

  private velocity = 0;
  private keyVelocity = 0;
  private keyDir = 0;
  private glide = 0;
  private drag?: { id: number; lastX: number; lastT: number };

  /** @param unitsPerPx world units per CSS pixel, at the time of asking */
  constructor(
    private el: HTMLElement,
    private unitsPerPx: () => number,
  ) {
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("blur", () => (this.keyDir = 0));
  }

  /** Eases the view sideways by `units`. */
  glideBy(units: number) {
    this.glide += units;
  }

  jumpTo(x: number) {
    this.x = x;
    this.velocity = this.glide = 0;
  }

  /** Advances the camera by `dt` seconds. */
  step(dt: number) {
    const ease = (rate: number) => 1 - Math.exp(-dt * rate);
    this.keyVelocity += (this.keyDir * 900 - this.keyVelocity) * ease(8);
    if (Math.abs(this.keyVelocity) < 0.5 && this.keyDir == 0) {
      this.keyVelocity = 0;
    }
    let dx = this.keyVelocity * dt;
    if (!this.drag) {
      dx += this.velocity * dt;
      this.velocity *= Math.exp(-dt * 3);
      if (Math.abs(this.velocity) < 2) {
        this.velocity = 0;
      }
      const g = Math.abs(this.glide) < 0.05 ? this.glide : this.glide * ease(7);
      this.glide -= g;
      dx += g;
      if (this.auto) {
        dx += this.autoSpeed * dt;
      }
    }
    this.x += dx;
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey) {
      return; // pinch-zoom gesture, not a scroll
    }
    const unit = e.deltaMode == 1 ? 16 : e.deltaMode == 2 ? this.el.clientHeight : 1;
    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const units = raw * unit * this.unitsPerPx();
    this.velocity = 0;
    if (e.deltaMode == 0 && Math.abs(raw) < 40) {
      // trackpads report small deltas with their own momentum: follow exactly
      this.x += units;
    } else {
      // notched mouse wheels jump in big steps: smooth them out
      this.glide += units;
    }
    this.onInteract?.();
  };

  private onPointerDown = (e: PointerEvent) => {
    if (e.button != 0 || this.drag) {
      return;
    }
    this.el.setPointerCapture(e.pointerId);
    this.el.classList.add("dragging");
    this.drag = { id: e.pointerId, lastX: e.clientX, lastT: e.timeStamp };
    this.velocity = this.glide = 0;
  };

  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id != e.pointerId) {
      return;
    }
    const units = (d.lastX - e.clientX) * this.unitsPerPx();
    const dt = (e.timeStamp - d.lastT) / 1000;
    if (dt > 0) {
      // smoothed, so one jittery sample does not decide the fling
      this.velocity += (units / dt - this.velocity) * 0.5;
    }
    this.x += units;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    if (units != 0) {
      this.onInteract?.();
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || d.id != e.pointerId) {
      return;
    }
    if (e.type == "pointercancel" || e.timeStamp - d.lastT > 80) {
      this.velocity = 0; // the pointer had come to rest: no fling
    }
    this.drag = undefined;
    this.el.classList.remove("dragging");
  };

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName == "INPUT" || t.tagName == "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    const dir = e.key == "ArrowRight" ? 1 : e.key == "ArrowLeft" ? -1 : 0;
    if (dir == 0) {
      return;
    }
    e.preventDefault();
    if (e.type == "keydown") {
      this.keyDir = dir;
      this.onInteract?.();
    } else if (this.keyDir == dir) {
      this.keyDir = 0;
    }
  };
}
