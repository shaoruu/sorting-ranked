import "./style.css";
import { ALGOS, type Algo } from "./algorithms.ts";
import { Arr, type Op, type Sorter } from "./arr.ts";
import * as audio from "./audio.ts";
import { benchmark, type BenchRow } from "./benchmark.ts";
import { INPUTS, makeInput, mulberry32, type InputKind } from "./inputs.ts";

const SIZES = [16, 32, 64, 128, 256];
const SPEED_MIN = 5;
const SPEED_MAX = 100_000;
// Max voices per frame in "all" mode, or it turns into white noise
const ALL_VOICES = 4;

type SoundMode = "solo" | "all" | "off";

type Settings = {
  n: number;
  input: InputKind;
  speed: number;
  sound: SoundMode;
  wave: OscillatorType;
  memes: boolean;
  solo: string;
};

const DEFAULTS: Settings = {
  n: 64,
  input: "random",
  speed: 300,
  sound: "solo",
  wave: "triangle",
  memes: true,
  solo: "quick-hoare",
};

function loadSettings(): Settings {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("settings") ?? "{}") };
    if (!SIZES.includes(saved.n)) saved.n = DEFAULTS.n;
    if (!INPUTS.some((i) => i.id === saved.input)) saved.input = DEFAULTS.input;
    return saved;
  } catch {
    return { ...DEFAULTS };
  }
}

const settings = loadSettings();
const save = () => localStorage.setItem("settings", JSON.stringify(settings));

const COLORS = {
  bg: "#0f130f",
  bar: "#cfe8cf",
  done: "#3ddc84",
  sweep: "#ffffff",
  dnf: "#4a3434",
  cmp: "#ff4d4d",
  swap: "#ffd23f",
  write: "#ffd23f",
  read: "#4da3ff",
} as const;

type Status = "running" | "done" | "dnf";

type Racer = {
  algo: Algo;
  arr: Arr;
  gen: Sorter;
  max: number;
  status: Status;
  rank: number;
  last: Op | null;
  // Set when the racer stepped (or swept) this frame, so it gets a tone
  ticked: boolean;
  swept: boolean;
  // Green sweep position after finishing; -1 until then
  sweep: number;
  dirty: boolean;
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  rankEl: HTMLElement;
  stepsEl: HTMLElement;
  row: HTMLTableRowElement;
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const grid = $("#grid");
const playBtn = $<HTMLButtonElement>("#play");
const raceBoard = $("#race-board");
const overallBoard = $("#overall-board");
const note = $("#note");

let racers: Racer[] = [];
let running = false;
let fastForward = false;
let budget = 0;
let zoomed: Racer | null = null;
let fanfared = false;
let voiceOffset = 0;
let tab: "race" | "overall" = "race";

const fmt = (x: number) => Math.round(x).toLocaleString("en-US");
const raceOver = () => racers.every((r) => r.status !== "running");
const started = () => racers.some((r) => r.arr.steps > 0);

const canvasRacer = new WeakMap<Element, Racer>();
const resizer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const canvas = entry.target as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    const r = canvasRacer.get(canvas);
    if (r) draw(r);
  }
});

function createRacer(algo: Algo, data: number[]): Racer {
  const el = document.createElement("div");
  el.className = "panel";
  el.innerHTML = `<div class="head"><span class="rank"></span><span class="name"></span><span class="steps">0</span></div><canvas></canvas>`;
  el.querySelector(".name")!.textContent = algo.name;
  el.title = algo.note;
  const canvas = el.querySelector("canvas")!;
  const arr = new Arr(data);
  const row = document.createElement("tr");
  const r: Racer = {
    algo,
    arr,
    gen: algo.run(arr),
    max: Math.max(...data),
    status: "running",
    rank: 0,
    last: null,
    ticked: false,
    swept: false,
    sweep: -1,
    dirty: true,
    el,
    canvas,
    ctx: canvas.getContext("2d")!,
    rankEl: el.querySelector(".rank")!,
    stepsEl: el.querySelector(".steps")!,
    row,
  };
  el.addEventListener("click", () => {
    audio.unlock();
    setSolo(r);
  });
  el.addEventListener("dblclick", () => toggleZoom(r));
  row.addEventListener("click", () => {
    audio.unlock();
    setSolo(r);
    if (zoomed && zoomed !== r) toggleZoom(r);
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  });
  grid.append(el);
  canvasRacer.set(canvas, r);
  resizer.observe(canvas);
  return r;
}

function newRace() {
  running = false;
  fastForward = false;
  budget = 0;
  fanfared = false;
  for (const r of racers) resizer.unobserve(r.canvas);
  grid.replaceChildren();
  const seed = (Math.random() * 2 ** 32) >>> 0;
  const base = makeInput(settings.input, settings.n, mulberry32(seed));
  racers = ALGOS.filter((a) => settings.memes || !a.meme).map((algo) =>
    createRacer(algo, base.slice())
  );
  if (!racers.some((r) => r.algo.id === settings.solo)) settings.solo = racers[0].algo.id;
  zoomed = null;
  document.body.classList.remove("zoomed");
  buildBoard();
  setSolo(racers.find((r) => r.algo.id === settings.solo)!);
  syncPlay();
}

function setSolo(r: Racer) {
  settings.solo = r.algo.id;
  save();
  for (const o of racers) {
    o.el.classList.toggle("solo", o === r);
    o.row.classList.toggle("solo", o === r);
  }
  const { algo } = r;
  note.innerHTML = `<b></b> <span class="o"></span><div></div>`;
  note.querySelector("b")!.textContent = algo.name;
  note.querySelector(".o")!.textContent =
    `best ${algo.best} · avg ${algo.avg} · worst ${algo.worst}`;
  note.querySelector("div")!.textContent = algo.note;
}

function toggleZoom(r: Racer) {
  if (zoomed) zoomed.el.classList.remove("zoomed");
  zoomed = zoomed === r ? null : r;
  if (zoomed) {
    zoomed.el.classList.add("zoomed");
    setSolo(zoomed);
  }
  document.body.classList.toggle("zoomed", !!zoomed);
}

function advance(steps: number) {
  let finished = false;
  for (const r of racers) {
    if (r.status !== "running") continue;
    for (let k = 0; k < steps; k++) {
      const res = r.gen.next();
      if (res.done) {
        r.status = "done";
        r.sweep = 0;
        r.last = null;
        finished = true;
        break;
      }
      r.last = res.value;
    }
    r.ticked = true;
    r.dirty = true;
  }
  if (finished) onFinish();
}

function onFinish() {
  const done = racers.filter((r) => r.status === "done");
  for (const r of done) {
    r.rank = 1 + done.filter((o) => o.arr.steps < r.arr.steps).length;
  }
  if (!fanfared && settings.sound !== "off") {
    fanfared = true;
    audio.fanfare();
  }
  const left = racers.filter((r) => r.status === "running");
  if (left.every((r) => r.algo.dnf)) {
    for (const r of left) {
      r.status = "dnf";
      r.last = null;
      r.dirty = true;
    }
    running = false;
    fastForward = false;
    syncPlay();
  }
}

function sweep(dt: number) {
  for (const r of racers) {
    if (r.sweep < 0 || r.sweep >= r.arr.n) continue;
    r.sweep = Math.min(r.arr.n, r.sweep + Math.max(1, (r.arr.n * dt) / 0.6));
    r.swept = true;
    r.dirty = true;
  }
}

function sound() {
  if (settings.sound === "off") return;
  const dur = Math.min(0.12, Math.max(0.04, 2 / settings.speed));
  const voices: number[] = [];
  for (const r of racers) {
    if (settings.sound === "solo" && r.algo.id !== settings.solo) continue;
    if (r.ticked && r.last) voices.push(audio.pitch(r.arr.get(r.last.i), r.max));
    else if (r.swept) {
      voices.push(audio.pitch(r.arr.get(Math.ceil(r.sweep) - 1), r.max));
    }
  }
  if (settings.sound === "solo") {
    for (const f of voices) audio.tone(f, dur);
    return;
  }
  const count = Math.min(ALL_VOICES, voices.length);
  for (let k = 0; k < count; k++) {
    audio.tone(voices[(voiceOffset + k) % voices.length], dur, 0.45);
  }
  voiceOffset += count;
}

function draw(r: Racer) {
  r.dirty = false;
  const { ctx, canvas, arr } = r;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, w, h);
  const n = arr.n;
  const bw = w / n;
  const gap = bw >= 4 ? Math.max(1, Math.floor(bw * 0.18)) : 0;
  const hl = r.status === "running" ? r.last : null;
  const hj = hl && "j" in hl ? hl.j : -1;
  const sweepAt = Math.ceil(r.sweep) - 1;
  for (let i = 0; i < n; i++) {
    let color: string = COLORS.bar;
    if (r.status === "dnf") color = COLORS.dnf;
    else if (r.sweep >= n) color = COLORS.done;
    else if (i === sweepAt) color = COLORS.sweep;
    else if (i < r.sweep) color = COLORS.done;
    if (hl && (i === hl.i || i === hj)) color = COLORS[hl.t];
    const bh = Math.max(1, Math.round((arr.a[i] / r.max) * h));
    const x = Math.round(i * bw);
    const x2 = Math.round((i + 1) * bw) - gap;
    ctx.fillStyle = color;
    ctx.fillRect(x, h - bh, Math.max(1, x2 - x), bh);
  }
  r.stepsEl.textContent = fmt(arr.steps);
  const rank = rankLabel(r);
  r.rankEl.textContent = rank.text;
  r.rankEl.className = `rank ${rank.cls}`;
}

function rankLabel(r: Racer) {
  if (r.status === "dnf") return { text: "DNF", cls: "dnf" };
  if (r.status === "running") return { text: "", cls: "" };
  return { text: `#${r.rank}`, cls: r.rank <= 3 ? `r${r.rank}` : "" };
}

function buildBoard() {
  raceBoard.innerHTML = `<table><thead><tr><th>#</th><th>algorithm</th><th>steps</th><th>cmp</th><th>writes</th></tr></thead><tbody></tbody></table>`;
  const tbody = raceBoard.querySelector("tbody")!;
  for (const r of racers) {
    r.row.innerHTML = `<td class="rank"></td><td><div></div><div class="big-o"></div></td><td></td><td></td><td></td>`;
    r.row.cells[1].children[0].textContent = r.algo.name;
    r.row.cells[1].children[1].textContent = `avg ${r.algo.avg}`;
    tbody.append(r.row);
  }
  renderBoard();
}

const STATUS_ORDER: Record<Status, number> = { done: 0, running: 1, dnf: 2 };

function renderBoard() {
  const order = [...racers].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.status === "done" ? a.arr.steps - b.arr.steps : 0)
  );
  const tbody = raceBoard.querySelector("tbody")!;
  order.forEach((r, i) => {
    if (tbody.children[i] !== r.row) tbody.insertBefore(r.row, tbody.children[i]);
    const rank = rankLabel(r);
    const [rankCell, , steps, cmps, writes] = r.row.cells;
    rankCell.textContent = rank.text || "·";
    rankCell.className = `rank ${rank.cls}`;
    steps.textContent = fmt(r.arr.steps);
    cmps.textContent = fmt(r.arr.cmps);
    writes.textContent = fmt(r.arr.writes);
    r.row.classList.toggle("running", r.status === "running");
  });
}

const benchCache = new Map<number, BenchRow[]>();
let benchToken = 0;

async function showOverall() {
  const n = settings.n;
  const cached = benchCache.get(n);
  if (cached) return renderOverall(cached, n);
  const token = ++benchToken;
  overallBoard.innerHTML = `<div class="meta">benchmarking every algorithm on every input at n = ${n}…</div><div class="progress"><div></div></div>`;
  const bar = overallBoard.querySelector<HTMLElement>(".progress div")!;
  const rows = await benchmark(n, (f) => {
    if (token === benchToken) bar.style.width = `${f * 100}%`;
  });
  benchCache.set(n, rows);
  if (token === benchToken && tab === "overall" && settings.n === n) {
    renderOverall(rows, n);
  }
}

function rankColor(rank: number, total: number) {
  const t = (rank - 1) / Math.max(1, total - 1);
  return `hsl(${Math.round(140 - 140 * t)} 70% ${Math.round(58 - 8 * t)}%)`;
}

function renderOverall(rows: BenchRow[], n: number) {
  const head = INPUTS.map((i) => `<th title="${i.label}">${i.short}</th>`).join("");
  overallBoard.innerHTML = `<table><thead><tr><th>#</th><th>algorithm</th>${head}<th>score</th></tr></thead><tbody></tbody></table><div class="meta">n = ${n}. cells are rank per input (hover for steps). score = geometric mean of steps across all five inputs, lower is better. seeded inputs averaged over 3 seeds.</div>`;
  const tbody = overallBoard.querySelector("tbody")!;
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    const cells = INPUTS.map((input) => {
      const steps = row.steps[input.id];
      const label = Number.isFinite(steps) ? row.ranks[input.id] : "∞";
      const bg = Number.isFinite(steps)
        ? rankColor(row.ranks[input.id], rows.length)
        : "#4a3434";
      const title = Number.isFinite(steps) ? `${fmt(steps)} steps` : "gave up";
      return `<td class="cell" style="background:${bg}" title="${title}">${label}</td>`;
    }).join("");
    const score = Number.isFinite(row.score) ? fmt(row.score) : "∞";
    const cls = i < 3 ? `r${i + 1}` : "";
    tr.innerHTML = `<td class="rank ${cls}">${i + 1}</td><td><div></div><div class="big-o"></div></td>${cells}<td>${score}</td>`;
    tr.cells[1].children[0].textContent = row.algo.name;
    tr.cells[1].children[1].textContent = `avg ${row.algo.avg}`;
    tr.title = row.algo.note;
    const racer = racers.find((r) => r.algo === row.algo);
    if (racer) tr.addEventListener("click", () => racer.row.click());
    tbody.append(tr);
  });
}

function setTab(next: typeof tab) {
  tab = next;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button")) {
    b.classList.toggle("active", b.dataset.tab === tab);
  }
  raceBoard.hidden = tab !== "race";
  overallBoard.hidden = tab !== "overall";
  if (tab === "overall") void showOverall();
}

function syncPlay() {
  playBtn.textContent = raceOver()
    ? "▶ race again"
    : running
      ? "❚❚ pause"
      : started()
        ? "▶ resume"
        : "▶ start";
}

function togglePlay() {
  audio.unlock();
  if (raceOver()) {
    newRace();
    running = true;
  } else {
    running = !running;
  }
  syncPlay();
}

function finish() {
  audio.unlock();
  if (raceOver()) return;
  running = true;
  fastForward = true;
  syncPlay();
}

let lastT = performance.now();
let boardDue = 0;

function frame(t: number) {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  for (const r of racers) {
    r.ticked = false;
    r.swept = false;
  }
  if (running && fastForward) {
    const until = performance.now() + 12;
    while (running && performance.now() < until) advance(2000);
  } else if (running) {
    budget += settings.speed * dt;
    const steps = Math.floor(budget);
    budget -= steps;
    if (steps > 0) advance(steps);
  }
  sweep(dt);
  sound();
  for (const r of racers) if (r.dirty) draw(r);
  if (t >= boardDue) {
    renderBoard();
    boardDue = t + 100;
  }
  requestAnimationFrame(frame);
}

// Speed slider is logarithmic: 5 to 100k steps per second
const speedToSlider = (s: number) =>
  Math.round((1000 * Math.log(s / SPEED_MIN)) / Math.log(SPEED_MAX / SPEED_MIN));
const sliderToSpeed = (v: number) =>
  Math.round(SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** (v / 1000));

function bindControls() {
  const size = $<HTMLSelectElement>("#size");
  size.innerHTML = SIZES.map((n) => `<option value="${n}">${n}</option>`).join("");
  size.value = String(settings.n);
  size.onchange = () => {
    settings.n = Number(size.value);
    save();
    newRace();
    if (tab === "overall") void showOverall();
  };

  const input = $<HTMLSelectElement>("#input");
  input.innerHTML = INPUTS.map((i) => `<option value="${i.id}">${i.label}</option>`).join("");
  input.value = settings.input;
  input.onchange = () => {
    settings.input = input.value as InputKind;
    save();
    newRace();
  };

  const speed = $<HTMLInputElement>("#speed");
  const speedOut = $<HTMLOutputElement>("#speed-out");
  speed.value = String(speedToSlider(settings.speed));
  const showSpeed = () => (speedOut.textContent = `${fmt(settings.speed)}/s`);
  showSpeed();
  speed.oninput = () => {
    settings.speed = sliderToSpeed(Number(speed.value));
    showSpeed();
    save();
  };

  const soundSel = $<HTMLSelectElement>("#sound");
  soundSel.value = settings.sound;
  soundSel.onchange = () => {
    audio.unlock();
    settings.sound = soundSel.value as SoundMode;
    save();
  };

  const wave = $<HTMLSelectElement>("#wave");
  wave.value = settings.wave;
  audio.setWave(settings.wave);
  wave.onchange = () => {
    audio.unlock();
    settings.wave = wave.value as OscillatorType;
    audio.setWave(settings.wave);
    audio.tone(440, 0.15);
    save();
  };

  const memes = $<HTMLInputElement>("#memes");
  memes.checked = settings.memes;
  memes.onchange = () => {
    settings.memes = memes.checked;
    save();
    newRace();
  };

  playBtn.onclick = togglePlay;
  $("#reset").onclick = () => {
    audio.unlock();
    newRace();
  };
  $("#skip").onclick = finish;

  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button")) {
    b.onclick = () => setTab(b.dataset.tab as typeof tab);
  }

  // Buttons keep focus after a click, and space would then click them again on top of our shortcut
  document.addEventListener("click", (e) => {
    if (e.target instanceof HTMLButtonElement) e.target.blur();
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target instanceof HTMLSelectElement) return;
    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlay();
        break;
      case "r":
        audio.unlock();
        newRace();
        break;
      case "f":
        finish();
        break;
      case "Escape":
        if (zoomed) toggleZoom(zoomed);
        break;
    }
  });
}

bindControls();
newRace();
requestAnimationFrame(frame);
