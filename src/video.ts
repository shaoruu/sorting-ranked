import { ALGOS, type Algo } from "./algorithms.ts";
import { Arr, type Op, type Sorter } from "./arr.ts";
import { FANFARE, pitch, WAVE_GAIN } from "./audio.ts";
import { drawBars } from "./bars.ts";
import { benchmark } from "./benchmark.ts";
import { INPUTS, makeInput, mulberry32, type InputKind } from "./inputs.ts";

export const FPS = 60;
export const SAMPLE_RATE = 48_000;

export type VideoMode = "tour" | "race";
export type Aspect = "16:9" | "1:1" | "9:16";
export type RankBy = "input" | "overall";

export const DIMENSIONS: Record<Aspect, [number, number]> = {
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
  "9:16": [1080, 1920],
};

export type VideoOpts = {
  mode: VideoMode;
  aspect: Aspect;
  rankBy: RankBy;
  n: number;
  input: InputKind;
  wave: OscillatorType;
  memes: boolean;
  // Tour: seconds each algorithm gets to sort. Race: seconds the race lasts.
  seconds: number;
  seed: number;
};

export type Tone = {
  t: number;
  freq: number;
  dur: number;
  vol: number;
  wave?: OscillatorType;
};

const sec = (s: number) => Math.round(s * FPS);
const INTRO = sec(2.4);
const SWEEP = sec(0.8);
const HOLD = sec(0.5);
const WIN_HOLD = sec(1.4);
const RACE_HOLD = sec(1.5);
const OUTRO = sec(7);
// Race clock is exponential: the fastest finisher lands at this fraction of the race
const FIRST_FINISH = 0.15;

const countAlgos = (memes: boolean) => ALGOS.filter((a) => memes || !a.meme).length;

export function estimateSeconds(opts: VideoOpts) {
  const frames =
    opts.mode === "tour"
      ? INTRO +
        countAlgos(opts.memes) * (sec(opts.seconds) + SWEEP + HOLD) +
        (WIN_HOLD - HOLD) +
        OUTRO
      : INTRO + sec(opts.seconds) + RACE_HOLD + OUTRO;
  return frames / FPS;
}

type Stats = { steps: number; cmps: number; writes: number; dnf: boolean };

type Entry = {
  algo: Algo;
  // Run on the input shown in the video
  stats: Stats;
  // What the ranking is by: steps on this input, or the overall benchmark score
  score: number;
  rank: number;
  dnf: boolean;
};

export type Plan = {
  opts: VideoOpts;
  width: number;
  height: number;
  base: number[];
  max: number;
  // Best first
  entries: Entry[];
};

function dryRun(algo: Algo, base: number[], cap: number): Stats {
  const arr = new Arr(base.slice());
  const gen = algo.run(arr);
  let dnf = false;
  while (!gen.next().done) {
    if (arr.steps > cap) {
      dnf = true;
      break;
    }
  }
  return { steps: arr.steps, cmps: arr.cmps, writes: arr.writes, dnf };
}

export async function makePlan(opts: VideoOpts): Promise<Plan> {
  const [width, height] = DIMENSIONS[opts.aspect];
  const base = makeInput(opts.input, opts.n, mulberry32(opts.seed));
  const algos = ALGOS.filter((a) => opts.memes || !a.meme);
  const stats = new Map<Algo, Stats>();
  for (const a of algos) if (!a.dnf) stats.set(a, dryRun(a, base, Infinity));
  const cap = Math.max(...[...stats.values()].map((s) => s.steps));
  for (const a of algos) if (a.dnf) stats.set(a, dryRun(a, base, cap));

  let scores: Map<Algo, number>;
  if (opts.rankBy === "overall") {
    const rows = await benchmark(opts.n, () => {});
    scores = new Map(rows.map((r) => [r.algo, r.score]));
  } else {
    scores = new Map(
      algos.map((a) => {
        const s = stats.get(a)!;
        return [a, s.dnf ? Infinity : s.steps];
      })
    );
  }
  const entries: Entry[] = algos.map((algo) => {
    const score = scores.get(algo)!;
    return { algo, stats: stats.get(algo)!, score, rank: 0, dnf: !Number.isFinite(score) };
  });
  for (const e of entries) {
    e.rank = 1 + entries.filter((o) => o.score < e.score).length;
  }
  entries.sort((a, b) => a.score - b.score || 0);
  return { opts, width, height, base, max: Math.max(...base), entries };
}

// ---- drawing helpers

const C = {
  bg: "#0a0c0a",
  panel: "#0f130f",
  line: "#1d241d",
  lineHi: "#2f3a2f",
  fg: "#cfe8cf",
  dim: "#6b806b",
  accent: "#3ddc84",
  red: "#ff4d4d",
  gold: "#ffd23f",
  silver: "#c9d1d9",
  bronze: "#e0915a",
};

const URL_TEXT = "sorting-ranked.vercel.app";
const vt = (px: number) => `${Math.round(px)}px VT323, monospace`;
const mono = (px: number, weight = 400) => `${weight} ${Math.round(px)}px "IBM Plex Mono", monospace`;
const fmt = (x: number) => Math.round(x).toLocaleString("en-US");
const easeOut = (x: number) => 1 - (1 - x) ** 3;

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  font: string,
  color: string,
  align: CanvasTextAlign = "left"
) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s, x, y);
}

function glow(ctx: CanvasRenderingContext2D, color: string, blur: number, fn: () => void) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

function measure(ctx: CanvasRenderingContext2D, s: string, font: string) {
  ctx.font = font;
  return ctx.measureText(s).width;
}

function fit(ctx: CanvasRenderingContext2D, s: string, font: string, maxW: number) {
  if (measure(ctx, s, font) <= maxW) return s;
  while (s.length > 1 && measure(ctx, `${s}…`, font) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function wrap(ctx: CanvasRenderingContext2D, s: string, font: string, maxW: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of s.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(ctx, next, font) > maxW) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function rankColor(rank: number, dnf: boolean) {
  if (dnf) return C.red;
  return rank === 1 ? C.gold : rank === 2 ? C.silver : rank === 3 ? C.bronze : C.accent;
}

function hueColor(rank: number, total: number) {
  const t = (rank - 1) / Math.max(1, total - 1);
  return `hsl(${Math.round(140 - 140 * t)} 70% ${Math.round(56 - 8 * t)}%)`;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, border: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fillStyle = C.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = border;
  ctx.stroke();
}

function background(ctx: CanvasRenderingContext2D, plan: Plan, watermark = true) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, plan.width, plan.height);
  if (watermark) {
    text(ctx, URL_TEXT, plan.width - 40, plan.height - 30, mono(22), C.dim, "right");
  }
}

const inputLabel = (plan: Plan) => INPUTS.find((i) => i.id === plan.opts.input)!.label;

const toneDur = (stepsPerSec: number) => Math.min(0.12, Math.max(0.04, 2 / stepsPerSec));

function fanfareTones(tones: Tone[], t: number) {
  for (const [delay, freq, dur] of FANFARE) tones.push({ t: t + delay, freq, dur, vol: 0.8 });
}

// ---- intro and outro cards, shared by both modes

function introTones(local: number, t: number, tones: Tone[]) {
  if (local === 8) tones.push({ t, freq: 880, dur: 0.08, vol: 0.6, wave: "square" });
  if (local === 16) tones.push({ t, freq: 1320, dur: 0.16, vol: 0.6, wave: "square" });
}

function drawIntro(ctx: CanvasRenderingContext2D, plan: Plan, local: number) {
  background(ctx, plan);
  const { width: W, height: H, opts } = plan;
  const cx = W / 2;
  const cy = H / 2;
  ctx.globalAlpha = Math.min(1, local / 12);
  const cursor = Math.floor(local / 24) % 2 === 0 ? "_" : " ";
  glow(ctx, C.accent, 40, () =>
    text(ctx, `SORTING.EXE${cursor}`, cx, cy - 40, vt(W < H ? 150 : 190), C.accent, "center")
  );
  text(ctx, `${plan.entries.length} sorting algorithms, ranked`, cx, cy + 50, mono(46, 600), C.fg, "center");
  const how = opts.mode === "tour" ? "worst to best" : "all at once, same clock";
  text(ctx, `${how} · n = ${opts.n} · ${inputLabel(plan)}`, cx, cy + 110, mono(28), C.dim, "center");
  text(ctx, "sound on ♪", cx, cy + 170, mono(28), C.accent, "center");
  ctx.globalAlpha = 1;
}

const REVEAL_DELAY = 12;
const REVEAL_EVERY = 5;

function outroTones(plan: Plan, local: number, t: number, tones: Tone[]) {
  const n = plan.entries.length;
  const k = (local - REVEAL_DELAY) / REVEAL_EVERY;
  if (k < 0 || k >= n || !Number.isInteger(k)) return;
  // Worst is revealed first, climbing two octaves up to #1
  tones.push({ t, freq: 220 * 2 ** ((2 * k) / Math.max(1, n - 1)), dur: 0.06, vol: 0.6 });
  if (k === n - 1) fanfareTones(tones, t + 0.08);
}

function drawOutro(ctx: CanvasRenderingContext2D, plan: Plan, local: number) {
  background(ctx, plan, false);
  const { width: W, height: H, entries, opts } = plan;
  const n = entries.length;
  const cx = W / 2;
  glow(ctx, C.accent, 30, () => text(ctx, "FINAL RANKING", cx, 150, vt(110), C.accent, "center"));
  const sub =
    opts.rankBy === "overall"
      ? `n = ${opts.n} · geometric mean of steps over 5 inputs · lower wins`
      : `n = ${opts.n} · ${inputLabel(plan)} · fewer steps wins`;
  text(ctx, sub, cx, 200, mono(24), C.dim, "center");

  const top = 250;
  const bottom = H - 90;
  const rowH = Math.min(W < H ? 76 : 60, (bottom - top) / n);
  const fs = rowH * 0.6;
  const tableW = Math.min(W - 96, 1400);
  const x0 = (W - tableW) / 2;
  const rankW = measure(ctx, "#21", vt(fs * 1.35)) + 16;
  const nameW = Math.max(...entries.map((e) => measure(ctx, e.algo.name, mono(fs, 600)))) + 24;
  const valueW = measure(ctx, "3,412,345", mono(fs)) + 16;
  const barX = x0 + rankW + nameW;
  const barW = Math.max(40, tableW - rankW - nameW - valueW);
  const finite = entries.filter((e) => !e.dnf).map((e) => Math.log(e.score));
  const lo = Math.min(...finite);
  const span = Math.max(1e-9, Math.max(...finite) - lo);

  entries.forEach((e, i) => {
    const revealAt = REVEAL_DELAY + (n - 1 - i) * REVEAL_EVERY;
    if (local < revealAt) return;
    const p = easeOut(Math.min(1, (local - revealAt) / 14));
    const y = top + i * rowH;
    const base = y + rowH * 0.72;
    ctx.globalAlpha = p;
    const color = rankColor(e.rank, e.dnf);
    const draw = () => text(ctx, e.dnf ? "DNF" : `#${e.rank}`, x0, base, vt(fs * 1.35), color);
    if (e.rank === 1 && !e.dnf) glow(ctx, C.gold, 20, draw);
    else draw();
    text(ctx, e.algo.name, x0 + rankW, base, mono(fs, 600), e.rank === 1 ? C.gold : C.fg);
    if (e.dnf) {
      text(ctx, "∞", x0 + tableW, base, mono(fs), C.red, "right");
    } else {
      const frac = 0.06 + 0.94 * ((Math.log(e.score) - lo) / span);
      ctx.fillStyle = hueColor(e.rank, n);
      ctx.fillRect(barX, y + rowH * 0.25, barW * frac * p, rowH * 0.5);
      text(ctx, fmt(e.score), x0 + tableW, base, mono(fs), C.fg, "right");
    }
    ctx.globalAlpha = 1;
  });
  text(ctx, `try it yourself: ${URL_TEXT}`, cx, H - 36, mono(26), C.dim, "center");
}

// ---- scenes

export interface Scene {
  readonly frames: number;
  // Advances the simulation to frame f (called for every frame in order) and pushes any tones it makes
  step(f: number, tones: Tone[]): void;
  draw(ctx: CanvasRenderingContext2D, f: number): void;
}

type Live = { arr: Arr; gen: Sorter; last: Op | null; sweep: number };

function live(algo: Algo, base: number[]): Live {
  const arr = new Arr(base.slice());
  return { arr, gen: algo.run(arr), last: null, sweep: -1 };
}

// Runs until the array has taken target steps; whether anything ran
function advanceTo(l: Live, target: number) {
  let ran = false;
  while (l.arr.steps < target) {
    const res = l.gen.next();
    if (res.done) break;
    l.last = res.value;
    ran = true;
  }
  return ran;
}

class Tour implements Scene {
  readonly frames: number;
  private plan: Plan;
  private order: Entry[];
  private starts: number[] = [];
  private lengths: number[] = [];
  private sortFrames: number;
  private outroStart: number;
  // Steps per frame for runs that never finish
  private dnfRate: number;
  private cur: { idx: number; l: Live } | null = null;

  constructor(plan: Plan) {
    this.plan = plan;
    this.order = [...plan.entries].reverse();
    this.sortFrames = sec(plan.opts.seconds);
    let f = INTRO;
    this.order.forEach((_, i) => {
      const len = this.sortFrames + SWEEP + (i === this.order.length - 1 ? WIN_HOLD : HOLD);
      this.starts.push(f);
      this.lengths.push(len);
      f += len;
    });
    this.outroStart = f;
    this.frames = f + OUTRO;
    const finished = plan.entries.filter((e) => !e.stats.dnf).map((e) => e.stats.steps);
    this.dnfRate = Math.max(50, Math.max(...finished) / this.sortFrames);
  }

  private segment(f: number) {
    const i = this.starts.findIndex((s, k) => f >= s && f < s + this.lengths[k]);
    if (!this.cur || this.cur.idx !== i) {
      this.cur = { idx: i, l: live(this.order[i].algo, this.plan.base) };
    }
    return { i, e: this.order[i], local: f - this.starts[i], l: this.cur.l };
  }

  step(f: number, tones: Tone[]) {
    const t = f / FPS;
    if (f < INTRO) return introTones(f, t, tones);
    if (f >= this.outroStart) return outroTones(this.plan, f - this.outroStart, t, tones);
    const { i, e, local, l } = this.segment(f);
    const n = l.arr.n;
    if (local < this.sortFrames) {
      const rate = e.stats.dnf ? this.dnfRate : e.stats.steps / this.sortFrames;
      const target = e.stats.dnf
        ? Math.round(rate * (local + 1))
        : Math.round((e.stats.steps * (local + 1)) / this.sortFrames);
      if (advanceTo(l, target) && l.last) {
        tones.push({ t, freq: pitch(l.arr.get(l.last.i), this.plan.max), dur: toneDur(rate * FPS), vol: 1 });
      }
      if (local === this.sortFrames - 1) {
        l.last = null;
        if (e.stats.dnf) tones.push({ t, freq: 82, dur: 0.6, vol: 1.2, wave: "sawtooth" });
      }
      return;
    }
    if (e.stats.dnf) return;
    const s = local - this.sortFrames;
    if (s < SWEEP) {
      l.sweep = (n * (s + 1)) / SWEEP;
      tones.push({ t, freq: pitch(l.arr.get(Math.ceil(l.sweep) - 1), this.plan.max), dur: 0.06, vol: 0.8 });
    } else if (s === SWEEP && i === this.order.length - 1) {
      fanfareTones(tones, t);
    }
  }

  draw(ctx: CanvasRenderingContext2D, f: number) {
    const { plan } = this;
    if (f < INTRO) return drawIntro(ctx, plan, f);
    if (f >= this.outroStart) return drawOutro(ctx, plan, f - this.outroStart);
    const { i, e, local, l } = this.segment(f);
    const { width: W, height: H } = plan;
    background(ctx, plan);
    const pad = W < H ? 56 : 72;
    const innerW = W - pad * 2;

    const rankText = `#${e.rank}`;
    const rankFont = vt(160);
    const rankY = pad + 120;
    glow(ctx, rankColor(e.rank, e.dnf), 30, () => text(ctx, rankText, pad, rankY, rankFont, rankColor(e.rank, e.dnf)));
    const nameX = pad + measure(ctx, rankText, rankFont) + 36;
    const nameFont = mono(W < H ? 52 : 64, 600);
    text(ctx, fit(ctx, e.algo.name, nameFont, W - nameX - pad), nameX, rankY - 52, nameFont, C.fg);
    const { best, avg, worst } = e.algo;
    text(ctx, `best ${best} · avg ${avg} · worst ${worst}`, nameX, rankY, mono(28), C.dim);

    let y = rankY + 66;
    const noteFont = mono(W < H ? 30 : 32);
    for (const line of wrap(ctx, e.algo.note, noteFont, innerW).slice(0, 3)) {
      text(ctx, line, pad, y, noteFont, C.fg);
      y += 44;
    }

    const sorting = local < this.sortFrames;
    const rate = e.stats.dnf ? this.dnfRate : e.stats.steps / this.sortFrames;
    const stats: [string, string, string][] = [
      ["STEPS", fmt(l.arr.steps), C.accent],
      ["COMPARES", fmt(l.arr.cmps), C.fg],
      ["WRITES", fmt(l.arr.writes), C.fg],
      ["PLAYBACK", `${fmt(rate * FPS)}/s`, C.dim],
    ];
    const blockW = innerW / stats.length;
    const valueFont = vt(Math.min(84, blockW / 5.2));
    y += 16;
    stats.forEach(([label, value, color], k) => {
      const x = pad + k * blockW;
      text(ctx, label, x, y + 20, mono(20), C.dim);
      text(ctx, value, x, y + 90, valueFont, color);
    });

    const barsTop = y + 130;
    const barsBottom = H - pad - 30;
    drawBars(ctx, l.arr.a, plan.max, pad, barsTop, innerW, barsBottom - barsTop, {
      hl: sorting ? l.last : null,
      sweep: l.sweep,
      dnf: e.stats.dnf && !sorting,
    });

    if (e.stats.dnf && !sorting) {
      const cx = W / 2;
      const cy = (barsTop + barsBottom) / 2;
      const p = easeOut(Math.min(1, (local - this.sortFrames) / 8));
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.12);
      ctx.scale(2 - p, 2 - p);
      ctx.globalAlpha = p;
      ctx.lineWidth = 10;
      ctx.strokeStyle = C.red;
      ctx.strokeRect(-260, -150, 520, 260);
      glow(ctx, C.red, 30, () => text(ctx, "DNF", 0, 50, vt(260), C.red, "center"));
      text(ctx, `gave up after ${fmt(l.arr.steps)} steps`, 0, 90, mono(26), C.red, "center");
      ctx.restore();
    }

    text(ctx, `${i + 1} / ${this.order.length}`, pad, H - 30, mono(22), C.dim);
  }
}

function makeClock(sMin: number, sMax: number, T: number): (t: number) => number {
  const ratio = sMax / Math.max(1, sMin);
  if (ratio <= 1 / FIRST_FINISH) return (t) => (sMax * t) / T;
  const f = (k: number) => Math.expm1(k * T) / Math.expm1(k * FIRST_FINISH * T);
  let lo = 1e-9;
  let hi = 1 / T;
  while (f(hi) < ratio) hi *= 2;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < ratio) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  const a = sMax / Math.expm1(k * T);
  return (t) => a * Math.expm1(k * t);
}

type RaceRacer = { e: Entry; l: Live; status: "running" | "done" | "dnf" };

const RACE_VOICES = 3;
const SWEEP_VOICES = 3;

class Race implements Scene {
  readonly frames: number;
  private plan: Plan;
  private racers: RaceRacer[];
  private raceFrames: number;
  private outroStart: number;
  private clock: (t: number) => number;
  private sMax: number;
  private now = 0;
  private speed = 0;
  private fanfared = false;
  private voice = 0;

  constructor(plan: Plan) {
    this.plan = plan;
    const byAlgoOrder = [...plan.entries].sort((a, b) => ALGOS.indexOf(a.algo) - ALGOS.indexOf(b.algo));
    this.racers = byAlgoOrder.map((e) => ({ e, l: live(e.algo, plan.base), status: "running" }));
    const finished = plan.entries.filter((e) => !e.stats.dnf).map((e) => e.stats.steps);
    this.sMax = Math.max(...finished);
    this.raceFrames = sec(plan.opts.seconds);
    this.clock = makeClock(Math.min(...finished), this.sMax, plan.opts.seconds);
    this.outroStart = INTRO + this.raceFrames + RACE_HOLD;
    this.frames = this.outroStart + OUTRO;
  }

  step(f: number, tones: Tone[]) {
    const t = f / FPS;
    if (f < INTRO) return introTones(f, t, tones);
    if (f >= this.outroStart) return outroTones(this.plan, f - this.outroStart, t, tones);
    const k = f - INTRO;
    if (k < this.raceFrames) {
      const target = k === this.raceFrames - 1 ? this.sMax : Math.round(this.clock((k + 1) / FPS));
      this.speed = (this.clock((k + 1) / FPS) - this.clock(k / FPS)) * FPS;
      this.now = target;
      const voices: number[] = [];
      for (const r of this.racers) {
        if (r.status !== "running") continue;
        const ran = advanceTo(r.l, target);
        if (!r.e.stats.dnf && r.l.arr.steps >= r.e.stats.steps) {
          r.status = "done";
          r.l.last = null;
          r.l.sweep = 0;
          if (!this.fanfared) {
            this.fanfared = true;
            fanfareTones(tones, t);
          }
        } else if (ran && r.l.last) {
          voices.push(pitch(r.l.arr.get(r.l.last.i), this.plan.max));
        }
      }
      if (k === this.raceFrames - 1) {
        for (const r of this.racers) {
          if (r.status !== "running") continue;
          r.status = "dnf";
          r.l.last = null;
          tones.push({ t, freq: 82, dur: 0.6, vol: 1.2, wave: "sawtooth" });
        }
      }
      const count = Math.min(RACE_VOICES, voices.length);
      for (let v = 0; v < count; v++) {
        tones.push({ t, freq: voices[(this.voice + v) % voices.length], dur: toneDur(this.speed), vol: 0.4 });
      }
      this.voice += count;
    }
    let sweeps = 0;
    for (const r of this.racers) {
      const n = r.l.arr.n;
      if (r.status !== "done" || r.l.sweep >= n) continue;
      r.l.sweep = Math.min(n, r.l.sweep + n / SWEEP);
      if (sweeps++ < SWEEP_VOICES) {
        tones.push({ t, freq: pitch(r.l.arr.get(Math.ceil(r.l.sweep) - 1), this.plan.max), dur: 0.06, vol: 0.5 });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, f: number) {
    const { plan } = this;
    if (f < INTRO) return drawIntro(ctx, plan, f);
    if (f >= this.outroStart) return drawOutro(ctx, plan, f - this.outroStart);
    const { width: W, height: H, opts } = plan;
    background(ctx, plan);
    const pad = 40;
    glow(ctx, C.accent, 24, () => text(ctx, "SORTING.EXE", pad, pad + 64, vt(88), C.accent));
    text(ctx, `${this.racers.length} algorithms · n = ${opts.n} · ${inputLabel(plan)}`, pad, pad + 104, mono(24), C.dim);
    text(ctx, `STEP ${fmt(this.now)}`, W - pad, pad + 64, vt(72), C.fg, "right");
    text(ctx, `${fmt(this.speed)} steps/s`, W - pad, pad + 104, mono(24), C.dim, "right");

    const gx = pad;
    const gy = pad + 140;
    const gw = W - pad * 2;
    const gh = H - gy - pad - 24;
    const gap = 14;
    const count = this.racers.length;
    let best = { cols: 1, score: -1 };
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const pw = (gw - gap * (cols - 1)) / cols;
      const ph = (gh - gap * (rows - 1)) / rows;
      const aspect = pw / ph;
      const score = pw * ph * Math.min(1, aspect / 1.2, 2.6 / aspect);
      if (score > best.score) best = { cols, score };
    }
    const cols = best.cols;
    const rows = Math.ceil(count / cols);
    const pw = (gw - gap * (cols - 1)) / cols;
    const ph = (gh - gap * (rows - 1)) / rows;
    const hh = Math.max(26, Math.min(44, ph * 0.17));
    const fs = hh * 0.6;

    this.racers.forEach((r, idx) => {
      const x = gx + (idx % cols) * (pw + gap);
      const y = gy + Math.floor(idx / cols) * (ph + gap);
      const done = r.status === "done";
      const first = done && r.e.stats.steps === Math.min(...this.racers.filter((o) => o.status === "done").map((o) => o.e.stats.steps));
      panel(ctx, x, y, pw, ph, first ? C.gold : C.line);
      let nx = x + 12;
      const base = y + hh * 0.78;
      if (r.status !== "running") {
        const label = r.status === "dnf" ? "DNF" : `#${this.liveRank(r)}`;
        const font = vt(hh * 1.05);
        text(ctx, label, nx, base + 2, font, rankColor(this.liveRank(r), r.status === "dnf"));
        nx += measure(ctx, label, font) + 10;
      }
      const steps = fmt(r.l.arr.steps);
      const stepsW = measure(ctx, steps, mono(fs * 0.9));
      text(ctx, steps, x + pw - 12, base, mono(fs * 0.9), C.dim, "right");
      const nameFont = mono(fs, 600);
      const name = r.e.algo.short ?? r.e.algo.name;
      text(ctx, fit(ctx, name, nameFont, x + pw - 24 - stepsW - nx), nx, base, nameFont, C.fg);
      drawBars(ctx, r.l.arr.a, plan.max, x + 10, y + hh + 4, pw - 20, ph - hh - 14, {
        hl: r.status === "running" ? r.l.last : null,
        sweep: r.l.sweep,
        dnf: r.status === "dnf",
      });
    });
  }

  // Rank by steps on this input, which is what the race shows (ranking by overall only reorders the outro)
  private liveRank(r: RaceRacer) {
    return 1 + this.racers.filter((o) => o.status === "done" && o.e.stats.steps < r.e.stats.steps).length;
  }
}

export function createScene(plan: Plan): Scene {
  return plan.opts.mode === "tour" ? new Tour(plan) : new Race(plan);
}

// ---- audio

function osc(wave: OscillatorType, p: number) {
  switch (wave) {
    case "sine":
      return Math.sin(2 * Math.PI * p);
    case "square":
      return p < 0.5 ? 1 : -1;
    case "sawtooth":
      return 2 * p - 1;
    default:
      return 1 - 4 * Math.abs(p - 0.5);
  }
}

// Same envelope as the live synth: 4ms attack, exponential decay to -80dB over the tone
export function synthesize(tones: Tone[], seconds: number, wave: OscillatorType) {
  const out = new Float32Array(Math.ceil(seconds * SAMPLE_RATE));
  // Hotter than the live mix; social video plays at phone-speaker volume and tanh catches the peaks
  const master = 0.7;
  const attack = Math.round(0.004 * SAMPLE_RATE);
  for (const tone of tones) {
    const w = tone.wave ?? wave;
    const gain = tone.vol * WAVE_GAIN[w] * master;
    const start = Math.round(tone.t * SAMPLE_RATE);
    const len = Math.round(tone.dur * SAMPLE_RATE);
    const decay = Math.log(10000) / Math.max(1, len - attack);
    const inc = tone.freq / SAMPLE_RATE;
    let p = 0;
    for (let i = 0; i < len && start + i < out.length; i++) {
      const env = i < attack ? i / attack : Math.exp(-(i - attack) * decay);
      out[start + i] += osc(w, p) * env * gain;
      p += inc;
      if (p >= 1) p -= 1;
    }
  }
  // Soft limit, since overlapping tones can sum past full scale
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i]);
  return out;
}
