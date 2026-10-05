// An optional, generated soundscape: slow pentatonic phrases on a soft
// plucked tone over a quiet drone. Nothing is recorded. The phrases are
// written out below rather than random, and how busy the playing is follows
// what is on screen.

/** D major pentatonic over three octaves, from D3 */
const SCALE = [0, 1, 2].flatMap((oct) => [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3].map((r) => 146.83 * r * 2 ** oct));

/** Phrases as [scale step, length in beats]; they all come to rest on D or A. */
const PHRASES: [number, number][][] = [
  [[5, 1], [7, 1], [8, 2], [7, 1], [5, 3]],
  [[8, 1.5], [7, 0.5], [5, 1], [3, 1], [5, 4]],
  [[3, 1], [5, 1], [7, 2], [5, 1], [3, 3]],
  [[5, 2], [3, 1], [2, 1], [0, 4]],
  [[7, 1], [8, 1], [10, 2], [8, 1], [7, 1], [5, 4]],
  [[0, 2], [3, 2], [5, 4]],
  [[10, 1], [8, 1], [7, 1], [5, 1], [3, 4]],
  [[5, 3], [8, 3]],
];

export interface SceneMood {
  /** 0 (open water) .. 1 (crowded with mountains) */
  density: number;
  /** a boat is in view */
  water: boolean;
}

export class Soundscape {
  mood: SceneMood = { density: 0.5, water: false };

  private ctx?: AudioContext;
  private master?: GainNode;
  private dry?: GainNode;
  private wet?: GainNode;
  private timer?: number;
  private lastPhrase = -1;

  get playing(): boolean {
    return this.timer !== undefined;
  }

  /** Must be called from a click or key press, or the browser keeps it muted. */
  start() {
    if (this.playing) {
      return;
    }
    const ctx = (this.ctx ??= new AudioContext());
    void ctx.resume();
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(ctx.destination);

      this.dry = ctx.createGain();
      this.dry.gain.value = 0.6;
      this.dry.connect(this.master);
      const reverb = ctx.createConvolver();
      reverb.buffer = this.room(ctx, 4.5);
      this.wet = ctx.createGain();
      this.wet.gain.value = 0.5;
      this.wet.connect(reverb).connect(this.master);

      // a barely audible fifth (D2 + A2) so the pauses are not dead silence
      for (const [freq, level] of [
        [73.42, 0.035],
        [110, 0.02],
      ]) {
        const osc = ctx.createOscillator();
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        gain.gain.value = level;
        // slow swell, each voice at its own pace
        const swell = ctx.createOscillator();
        swell.frequency.value = 0.05 + level;
        const depth = ctx.createGain();
        depth.gain.value = level * 0.6;
        swell.connect(depth).connect(gain.gain);
        osc.connect(gain).connect(this.wet);
        osc.start();
        swell.start();
      }
    }
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.5, ctx.currentTime, 1.2);
    this.timer = window.setTimeout(this.phrase, 800);
  }

  stop() {
    if (!this.playing || !this.ctx || !this.master) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    const ctx = this.ctx;
    setTimeout(() => !this.playing && void ctx.suspend(), 2500);
  }

  /** Plays one phrase, then rests: longer over open water, shorter among peaks. */
  private phrase = () => {
    const ctx = this.ctx!;
    const { density, water } = this.mood;

    let pick = Math.floor(Math.random() * PHRASES.length);
    if (pick == this.lastPhrase) {
      pick = (pick + 1) % PHRASES.length;
    }
    this.lastPhrase = pick;

    // unhurried; a little quicker where the scene is busy
    const beat = 1.05 - density * 0.3;
    // over water everything sits an octave lower
    const shift = water ? -5 : 0;
    let t = ctx.currentTime + 0.1;
    for (const [step, beats] of PHRASES[pick]) {
      const freq = SCALE[Math.max(0, step + shift)];
      const length = beats * beat;
      this.note(freq, t, 0.22, length);
      t += length;
    }
    // let the last note ring, then leave room
    const rest = 3 + (1 - density) * 5 + Math.random() * 2;
    this.timer = window.setTimeout(this.phrase, (t - ctx.currentTime + rest) * 1000);
  };

  /**
   * One soft pluck: a few pure harmonics with a quick, rounded attack, the
   * upper ones dying away first, as on a string.
   */
  private note(freq: number, when: number, level: number, held: number) {
    const ctx = this.ctx!;
    const ring = Math.max(2.5, held + 2);
    const out = ctx.createGain();
    out.gain.value = level;
    out.connect(this.dry!);
    out.connect(this.wet!);
    for (const [harmonic, share, life] of [
      [1, 1, 1],
      [2, 0.28, 0.5],
      [3, 0.1, 0.3],
    ]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq * harmonic;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(share, when + 0.012);
      env.gain.setTargetAtTime(0, when + 0.012, (ring * life) / 4);
      osc.connect(env).connect(out);
      osc.start(when);
      osc.stop(when + ring * life + 0.5);
    }
  }

  /** A long, dark, smooth reverb tail. */
  private room(ctx: AudioContext, seconds: number): AudioBuffer {
    const buffer = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buffer.getChannelData(ch);
      let smooth = 0;
      for (let i = 0; i < d.length; i++) {
        // low-passed noise: without this the tail hisses
        smooth += ((Math.random() * 2 - 1) - smooth) * 0.12;
        d[i] = smooth * (1 - i / d.length) ** 2.5 * 3;
      }
    }
    return buffer;
  }
}
