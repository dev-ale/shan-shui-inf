import { SEASONS, seasonAt, type Season } from "../gen/season";
import { Motion } from "./motion";
import { hourOf, SKY_MODES, type SkyMode } from "./sky";
import { Soundscape } from "./sound";
import { View } from "./view";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// --- settings: the address wins, then what was chosen last time

interface Settings {
  sky: SkyMode;
  season: Season | "auto";
  motion: boolean;
}

function readAddress() {
  const params = new URLSearchParams(location.search);
  for (const [k, v] of new URLSearchParams(location.hash.slice(1))) {
    params.set(k, v);
  }
  const x = parseFloat(params.get("x") ?? "");
  const sky = params.get("sky") as SkyMode | null;
  const season = params.get("season") as Season | null;
  return {
    seed: params.get("seed") || undefined,
    x: Number.isFinite(x) ? x : undefined,
    sky: sky && SKY_MODES.includes(sky) ? sky : undefined,
    season: season && SEASONS.includes(season) ? season : undefined,
    drift: params.has("drift"),
  };
}

function loadSettings(): Settings {
  const defaults: Settings = {
    sky: "auto",
    season: "auto",
    motion: !matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("shan-shui") ?? "{}") };
  } catch {
    return defaults;
  }
}

const start = readAddress();
const settings = loadSettings();
settings.sky = start.sky ?? settings.sky;
settings.season = start.season ?? settings.season;
const saveSettings = () => {
  try {
    localStorage.setItem("shan-shui", JSON.stringify(settings));
  } catch {
    // private browsing: the choice just lasts for this visit
  }
};

let seed = start.seed ?? String(Date.now());

const canvas = $<HTMLCanvasElement>("view");
const view = new View(canvas, seed);
const motion = new Motion(canvas, () => view.unitsPerPx);
const sound = new Soundscape();
motion.x = start.x ?? 0;

const season = (): Season => (settings.season == "auto" ? seasonAt(new Date()) : settings.season);
let hour = hourOf(settings.sky, new Date());
function applyScene() {
  view.season = season();
  view.ambientOn = settings.motion;
}
applyScene();

// --- address bar: always a link to exactly what is on screen

function address() {
  let a = `#seed=${encodeURIComponent(seed)}&x=${Math.round(motion.x)}`;
  if (settings.sky != "auto") a += `&sky=${settings.sky}`;
  if (settings.season != "auto") a += `&season=${settings.season}`;
  return a;
}
let shownAddress = "";
function syncAddress() {
  const next = address();
  if (next != shownAddress) {
    shownAddress = next;
    history.replaceState(null, "", location.pathname + next);
  }
}
setInterval(syncAddress, 400);

function regenerate(next: string) {
  seed = next || String(Date.now());
  seedInput.value = seed;
  view.setSeed(seed);
  motion.jumpTo(0);
  syncAddress();
}

window.addEventListener("hashchange", () => {
  if (location.hash == shownAddress) {
    return;
  }
  const to = readAddress();
  if (to.seed !== undefined && to.seed != seed) {
    regenerate(to.seed);
  }
  if (to.x !== undefined) {
    motion.jumpTo(to.x);
  }
  if (to.sky || to.season) {
    settings.sky = to.sky ?? settings.sky;
    settings.season = to.season ?? settings.season;
    skyInput.value = settings.sky;
    seasonInput.value = settings.season;
    applyScene();
  }
});

// --- menu

const menu = $<HTMLFormElement>("menu");
const menuBtn = $<HTMLButtonElement>("menu-btn");
const seedInput = $<HTMLInputElement>("seed");
const stepInput = $<HTMLInputElement>("step");
const autoInput = $<HTMLInputElement>("auto");
const skyInput = $<HTMLSelectElement>("sky");
const seasonInput = $<HTMLSelectElement>("season");
const motionInput = $<HTMLInputElement>("motion");
seedInput.value = seed;
skyInput.value = settings.sky;
seasonInput.value = settings.season;
motionInput.checked = settings.motion;

function showMenu(open: boolean) {
  menu.hidden = !open;
  menuBtn.textContent = open ? "✕" : "☰";
  menuBtn.setAttribute("aria-expanded", String(open));
}
menuBtn.addEventListener("click", () => showMenu(menu.hidden === true));
menu.addEventListener("submit", (e) => {
  e.preventDefault();
  regenerate(seedInput.value.trim());
});
$("random").addEventListener("click", () => regenerate(""));

skyInput.addEventListener("change", () => {
  settings.sky = skyInput.value as SkyMode;
  saveSettings();
});
seasonInput.addEventListener("change", () => {
  settings.season = seasonInput.value as Settings["season"];
  saveSettings();
  applyScene();
});
motionInput.addEventListener("change", () => {
  settings.motion = motionInput.checked;
  saveSettings();
  applyScene();
});

const stepSize = () => parseFloat(stepInput.value) || 0;
$("left").addEventListener("click", () => motion.glideBy(-stepSize()));
$("right").addEventListener("click", () => motion.glideBy(stepSize()));
autoInput.addEventListener("change", () => (motion.auto = autoInput.checked));

// --- sound

const soundBtn = $<HTMLButtonElement>("sound-btn");
soundBtn.addEventListener("click", () => {
  if (sound.playing) {
    sound.stop();
  } else {
    sound.start();
  }
  soundBtn.setAttribute("aria-pressed", String(sound.playing));
});
setInterval(() => sound.playing && (sound.mood = view.mood()), 1000);

// --- drift: full screen, no controls, slowly scrolling

let wakeLock: WakeLockSentinel | undefined;
let autoBeforeDrift = false;
const drifting = () => document.body.classList.contains("drift");

function setDrift(on: boolean, fullscreen = true) {
  if (on == drifting()) {
    return;
  }
  document.body.classList.toggle("drift", on);
  if (on) {
    showMenu(false);
    autoBeforeDrift = motion.auto;
    motion.auto = true;
    if (fullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
    navigator.wakeLock?.request("screen").then(
      (lock) => (wakeLock = lock),
      () => {},
    );
  } else {
    motion.auto = autoInput.checked = autoBeforeDrift;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    }
    void wakeLock?.release();
    wakeLock = undefined;
  }
}
$("drift-btn").addEventListener("click", () => setDrift(true));
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    setDrift(false);
  }
});
// a click or tap ends it; dragging and scrolling still steer
let pressAt = { x: 0, y: 0 };
canvas.addEventListener("pointerdown", (e) => (pressAt = { x: e.clientX, y: e.clientY }));
canvas.addEventListener("pointerup", (e) => {
  if (drifting() && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) < 6) {
    setDrift(false);
  }
});
if (start.drift) {
  // from a link: browsers only allow full screen after a click, so drift windowed
  setDrift(true, false);
}

window.addEventListener("keydown", (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (e.key == "Escape") {
    setDrift(false);
    showMenu(false);
  } else if (e.key == " " && !typing && !(e.target instanceof HTMLButtonElement)) {
    e.preventDefault();
    autoInput.checked = motion.auto = !motion.auto;
  } else if (e.key == "f" && !typing && !e.metaKey && !e.ctrlKey) {
    setDrift(!drifting());
  }
});

// --- saving

const status = $("save-status");
function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
async function save(kind: "png" | "svg") {
  const camX = Math.round(motion.x);
  const asked = parseFloat($<HTMLInputElement>("length").value);
  const width = Math.round(Number.isFinite(asked) ? Math.min(20000, Math.max(100, asked)) : view.viewWidth);
  const name = `shan-shui-${seed}-${camX}-${width}.${kind}`;
  status.textContent = "painting…";
  try {
    if (kind == "png") {
      download(await view.exportPng(camX, width, 2160), name);
    } else {
      download(new Blob([await view.exportSvg(camX, width)], { type: "image/svg+xml" }), name);
    }
    status.textContent = "";
  } catch (err) {
    console.error(err);
    status.textContent = "could not save";
  }
}
$("save-png").addEventListener("click", () => void save("png"));
$("save-svg").addEventListener("click", () => void save("svg"));

const copyBtn = $<HTMLButtonElement>("copy");
copyBtn.addEventListener("click", async () => {
  syncAddress();
  try {
    await navigator.clipboard.writeText(location.href);
    copyBtn.textContent = "Copied";
  } catch {
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
});

// --- frame loop

const hint = $("hint");
const busy = $("busy");
motion.onInteract = () => hint.classList.add("gone");
setTimeout(() => hint.classList.add("gone"), 8000);

let last = performance.now();
function frame(now: number) {
  // a background tab can stall for minutes; never integrate that as one step
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  motion.step(dt);

  // ease the sky towards the chosen hour the short way round the clock
  const target = hourOf(settings.sky, new Date());
  const gap = ((target - hour + 36) % 24) - 12;
  hour = Math.abs(gap) < 0.01 ? target : (hour + gap * (1 - Math.exp(-dt * 2.5)) + 24) % 24;
  view.hour = hour;
  if (settings.season == "auto") {
    view.season = season();
  }

  view.render(motion.x, now);
  busy.hidden = !view.busy;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- offline: cache the app after the first visit

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("sw.js", document.baseURI)).catch(() => {});
  });
}
