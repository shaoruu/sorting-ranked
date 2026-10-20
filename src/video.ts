import { ALGOS, title, type Algo } from "./algorithms.ts";
import { Arr, type Op, type Sorter } from "./arr.ts";
import { FANFARE, pitch, WAVE_GAIN } from "./audio.ts";
import { BAR_COLORS, drawBars } from "./bars.ts";
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
const INTRO = sec(1.6);
const SHUFFLE = sec(0.7);
const SETTLE = sec(0.15);
const SWEEP = sec(0.9);
const HOLD = sec(0.4);
const WIN_HOLD = sec(1.2);
const RACE_HOLD = sec(1.5);
const OUTRO = sec(6);
// Race clock is exponential: the fastest finisher lands at this fraction of the race
const FIRST_FINISH = 0.15;

const countAlgos = (memes: boolean) => ALGOS.filter((a) => memes || !a.meme).length;

export function estimateSeconds(opts: VideoOpts) {
  const frames =
    opts.mode === "tour"
      ? INTRO +
        countAlgos(opts.memes) * (SHUFFLE + SETTLE + sec(opts.seconds) + SWEEP + HOLD) +
        (WIN_HOLD - HOLD) +
        OUTRO
      : INTRO + SHUFFLE + SETTLE + sec(opts.seconds) + RACE_HOLD + OUTRO;
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
  sorted: number[];
  // Swaps that turn sorted into base, shown before every sort like the old videos
  shuffle: [number, number][];
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

// Fixes positions in a random order so it looks like a shuffle rather than a sweep
function shuffleSwaps(sorted: number[], base: number[], rand: () => number) {
  const a = sorted.slice();
  const order = a.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const fixed = new Uint8Array(a.length);
  const swaps: [number, number][] = [];
  for (const i of order) {
    fixed[i] = 1;
    if (a[i] === base[i]) continue;
    let j = 0;
    while (fixed[j] || a[j] !== base[i]) j++;
    [a[i], a[j]] = [a[j], a[i]];
    swaps.push([i, j]);
  }
  return swaps;
}

export async function makePlan(opts: VideoOpts): Promise<Plan> {
  const [width, height] = DIMENSIONS[opts.aspect];
  const rand = mulberry32(opts.seed);
  const base = makeInput(opts.input, opts.n, rand);
  const sorted = base.slice().sort((x, y) => x - y);
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
  return {
    opts,
    width,
    height,
    base,
    sorted,
    shuffle: shuffleSwaps(sorted, base, rand),
    max: sorted[sorted.length - 1],
    entries,
  };
}

// ---- drawing helpers

const C = {
  bg: "#000000",
  fg: "#ffffff",
  dim: "#9a9a9a",
  faint: "#5a5a5a",
  line: "#262626",
  red: BAR_COLORS.cmp,
  green: BAR_COLORS.done,
};

const URL_TEXT = "sorting-ranked.vercel.app";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const sans = (px: number, weight = 400) => `${weight} ${Math.round(px)}px ${FONT}`;
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

function measure(ctx: CanvasRenderingContext2D, s: string, font: string) {
  ctx.font = font;
  return ctx.measureText(s).width;
}

function fit(ctx: CanvasRenderingContext2D, s: string, font: string, maxW: number) {
  if (measure(ctx, s, font) <= maxW) return s;
  while (s.length > 1 && measure(ctx, `${s}…`, font) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}

function clear(ctx: CanvasRenderingContext2D, plan: Plan) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, plan.width, plan.height);
}

// The old videos show the delay per array access; here it's per step
function delayLabel(stepsPerSec: number) {
  const ms = 1000 / Math.max(1e-9, stepsPerSec);
  return `${ms >= 1 ? ms.toFixed(2) : ms.toPrecision(2)} ms delay`;
}

const inputLabel = (plan: Plan) => INPUTS.find((i) => i.id === plan.opts.input)!.label;

const toneDur = (stepsPerSec: number) => Math.min(0.12, Math.max(0.04, 2 / stepsPerSec));

function fanfareTones(tones: Tone[], t: number) {
  for (const [delay, freq, dur] of FANFARE) tones.push({ t: t + delay, freq, dur, vol: 0.6 });
}

// ---- intro and outro, shared by both modes

function introTones(local: number, t: number, tones: Tone[]) {
  if (local === 6) tones.push({ t, freq: 660, dur: 0.1, vol: 0.5 });
  if (local === 14) tones.push({ t, freq: 990, dur: 0.18, vol: 0.5 });
}

function drawIntro(ctx: CanvasRenderingContext2D, plan: Plan, local: number) {
  clear(ctx, plan);
  const { width: W, height: H, opts } = plan;
  const cx = W / 2;
  const cy = H / 2;
  ctx.globalAlpha = Math.min(1, local / 10);
  const big = W < H ? 64 : 84;
  text(ctx, `${plan.entries.length} Sorting Algorithms, Ranked`, cx, cy, sans(big, 700), C.fg, "center");
  const how = opts.mode === "tour" ? "worst to best" : "all at once";
  text(ctx, `${how} · n = ${opts.n} · ${inputLabel(plan)} input`, cx, cy + big * 0.9, sans(big * 0.4), C.dim, "center");
  text(ctx, "sound on", cx, cy + big * 1.55, sans(big * 0.34), C.faint, "center");
  ctx.globalAlpha = 1;
}

const REVEAL_DELAY = 10;
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
  clear(ctx, plan);
  const { width: W, height: H, entries, opts } = plan;
  const n = entries.length;
  const tall = W < H;
  const tableW = Math.min(W - (tall ? 96 : 160), 1400);
  const x0 = (W - tableW) / 2;
  text(ctx, "Final Ranking", x0, 130, sans(tall ? 68 : 72, 700), C.fg);
  const sub =
    opts.rankBy === "overall"
      ? `n = ${opts.n} · geometric mean of steps over 5 inputs · lower is better`
      : `n = ${opts.n} · ${inputLabel(plan)} input · fewer steps is better`;
  text(ctx, sub, x0, 178, sans(26), C.dim);

  const top = 220;
  const bottom = H - 90;
  const rowH = Math.min(tall ? 76 : 60, (bottom - top) / n);
  const fs = rowH * 0.56;
  const rankW = measure(ctx, "#21", sans(fs, 700)) + 20;
  const nameW = Math.max(...entries.map((e) => measure(ctx, title(e.algo), sans(fs)))) + 28;
  const valueW = measure(ctx, "3,412,345", sans(fs)) + 20;
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
    const base = y + rowH * 0.7;
    const winner = e.rank === 1 && !e.dnf;
    const color = e.dnf ? C.red : winner ? C.green : C.fg;
    ctx.globalAlpha = p;
    text(ctx, e.dnf ? "DNF" : `#${e.rank}`, x0, base, sans(fs, 700), color);
    text(ctx, title(e.algo), x0 + rankW, base, sans(fs, winner ? 700 : 400), color);
    if (e.dnf) {
      text(ctx, "never finished", x0 + tableW, base, sans(fs), C.red, "right");
    } else {
      const frac = 0.04 + 0.96 * ((Math.log(e.score) - lo) / span);
      ctx.fillStyle = winner ? C.green : C.fg;
      ctx.fillRect(barX, y + rowH * 0.28, barW * frac * p, rowH * 0.44);
      text(ctx, fmt(e.score), x0 + tableW, base, sans(fs), C.dim, "right");
    }
    ctx.globalAlpha = 1;
  });
  text(ctx, URL_TEXT, W / 2, H - 40, sans(26), C.faint, "center");
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

// Plays the sorted -> base shuffle, one frame at a time
class Shuffler {
  a: number[];
  hl: Op | null = null;
  private done = 0;
  private plan: Plan;

  constructor(plan: Plan) {
    this.plan = plan;
    this.a = plan.sorted.slice();
  }

  step(local: number, t: number, tones: Tone[]) {
    const { shuffle, max } = this.plan;
    const target = Math.round((shuffle.length * (local + 1)) / SHUFFLE);
    let last: [number, number] | null = null;
    while (this.done < Math.min(target, shuffle.length)) {
      last = shuffle[this.done++];
      const [i, j] = last;
      [this.a[i], this.a[j]] = [this.a[j], this.a[i]];
    }
    this.hl = last ? { t: "swap", i: last[0], j: last[1] } : null;
    if (last) tones.push({ t, freq: pitch(this.a[last[0]], max), dur: 0.05, vol: 0.7 });
  }
}

// Top-left overlay in the style of the old videos, plus the URL top-right
function overlay(ctx: CanvasRenderingContext2D, plan: Plan, line1: string, line2: string, color = C.fg) {
  const { width: W, height: H } = plan;
  const pad = W < H ? 40 : 48;
  const fs = W < H ? 34 : 38;
  text(ctx, fit(ctx, line1, sans(fs, 700), W - pad * 2), pad, pad + fs, sans(fs, 700), color);
  text(ctx, fit(ctx, line2, sans(fs * 0.68), W - pad * 2), pad, pad + fs * 2.05, sans(fs * 0.68), C.dim);
  if (W >= H) text(ctx, URL_TEXT, W - pad, pad + fs, sans(fs * 0.6), C.faint, "right");
  return pad + fs * 2.6;
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
  private cur: { idx: number; shuffler: Shuffler; l: Live } | null = null;

  constructor(plan: Plan) {
    this.plan = plan;
    this.order = [...plan.entries].reverse();
    this.sortFrames = sec(plan.opts.seconds);
    let f = INTRO;
    this.order.forEach((_, i) => {
      const hold = i === this.order.length - 1 ? WIN_HOLD : HOLD;
      const len = SHUFFLE + SETTLE + this.sortFrames + SWEEP + hold;
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
      this.cur = {
        idx: i,
        shuffler: new Shuffler(this.plan),
        l: live(this.order[i].algo, this.plan.base),
      };
    }
    const e = this.order[i];
    // Negative while shuffling; 0..sortFrames while sorting; past that, sweep and hold
    const local = f - this.starts[i] - SHUFFLE - SETTLE;
    return { i, e, local, ...this.cur };
  }

  private rate(e: Entry) {
    return e.stats.dnf ? this.dnfRate : e.stats.steps / this.sortFrames;
  }

  step(f: number, tones: Tone[]) {
    const t = f / FPS;
    if (f < INTRO) return introTones(f, t, tones);
    if (f >= this.outroStart) return outroTones(this.plan, f - this.outroStart, t, tones);
    const { i, e, local, shuffler, l } = this.segment(f);
    const shuffleLocal = local + SHUFFLE + SETTLE;
    if (shuffleLocal < SHUFFLE) return shuffler.step(shuffleLocal, t, tones);
    if (local < 0) {
      shuffler.hl = null;
      return;
    }
    if (local < this.sortFrames) {
      const rate = this.rate(e);
      const target = e.stats.dnf
        ? Math.round(rate * (local + 1))
        : Math.round((e.stats.steps * (local + 1)) / this.sortFrames);
      if (advanceTo(l, target) && l.last) {
        tones.push({ t, freq: pitch(l.arr.get(l.last.i), this.plan.max), dur: toneDur(rate * FPS), vol: 1 });
      }
      if (local === this.sortFrames - 1) {
        l.last = null;
        if (e.stats.dnf) tones.push({ t, freq: 82, dur: 0.6, vol: 1, wave: "sawtooth" });
      }
      return;
    }
    if (e.stats.dnf) return;
    const n = l.arr.n;
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
    const { e, local, shuffler, l } = this.segment(f);
    const { width: W, height: H } = plan;
    clear(ctx, plan);

    const shuffling = local < 0;
    const sorting = local >= 0 && local < this.sortFrames;
    const dnfShown = e.stats.dnf && local >= this.sortFrames;
    const line1 = `#${e.rank}  ${title(e.algo)}`;
    const line2 = shuffling
      ? `avg ${e.algo.avg} · shuffling…`
      : `${fmt(l.arr.steps)} steps, ${fmt(l.arr.cmps)} comparisons, ${fmt(l.arr.writes)} writes, ${delayLabel(this.rate(e) * FPS)}`;
    const top = overlay(ctx, plan, line1, line2, e.rank === 1 && !e.dnf && local >= this.sortFrames ? C.green : C.fg);

    const barsTop = top + 16;
    if (shuffling) {
      drawBars(ctx, shuffler.a, plan.max, 0, barsTop, W, H - barsTop, { hl: shuffler.hl, sweep: -1, dnf: false });
    } else {
      drawBars(ctx, l.arr.a, plan.max, 0, barsTop, W, H - barsTop, {
        hl: sorting ? l.last : null,
        sweep: l.sweep,
        dnf: dnfShown,
      });
    }

    if (dnfShown) {
      const p = easeOut(Math.min(1, (local - this.sortFrames) / 8));
      const cy = (barsTop + H) / 2;
      const big = W < H ? 220 : 260;
      ctx.globalAlpha = p;
      ctx.fillStyle = C.bg;
      ctx.fillRect(W / 2 - big * 1.4, cy - big * 0.85, big * 2.8, big * 0.85 + 100);
      text(ctx, "DNF", W / 2, cy, sans(big, 700), C.red, "center");
      text(ctx, `gave up after ${fmt(l.arr.steps)} steps`, W / 2, cy + 64, sans(34), C.red, "center");
      ctx.globalAlpha = 1;
    }
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
  private shuffler: Shuffler;
  private raceStart: number;
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
    this.shuffler = new Shuffler(plan);
    const finished = plan.entries.filter((e) => !e.stats.dnf).map((e) => e.stats.steps);
    this.sMax = Math.max(...finished);
    this.raceStart = INTRO + SHUFFLE + SETTLE;
    this.raceFrames = sec(plan.opts.seconds);
    this.clock = makeClock(Math.min(...finished), this.sMax, plan.opts.seconds);
    this.outroStart = this.raceStart + this.raceFrames + RACE_HOLD;
    this.frames = this.outroStart + OUTRO;
  }

  step(f: number, tones: Tone[]) {
    const t = f / FPS;
    if (f < INTRO) return introTones(f, t, tones);
    if (f >= this.outroStart) return outroTones(this.plan, f - this.outroStart, t, tones);
    if (f < INTRO + SHUFFLE) return this.shuffler.step(f - INTRO, t, tones);
    if (f < this.raceStart) {
      this.shuffler.hl = null;
      return;
    }
    const k = f - this.raceStart;
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
          tones.push({ t, freq: 82, dur: 0.6, vol: 1, wave: "sawtooth" });
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
    clear(ctx, plan);
    const shuffling = f < this.raceStart;
    const line1 = `${this.racers.length} Sorting Algorithms, Same Array`;
    const line2 = shuffling
      ? `n = ${opts.n} · ${inputLabel(plan)} input · shuffling…`
      : `n = ${opts.n} · ${inputLabel(plan)} input · step ${fmt(this.now)} · ${delayLabel(this.speed)}`;
    const top = overlay(ctx, plan, line1, line2);

    const gw = W;
    const gy = top + 8;
    const gh = H - gy;
    const gap = 4;
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
    const hh = Math.max(24, Math.min(40, ph * 0.16));
    const fs = hh * 0.62;

    ctx.fillStyle = C.line;
    ctx.fillRect(0, gy, W, gh);
    this.racers.forEach((r, idx) => {
      const x = (idx % cols) * (pw + gap);
      const y = gy + Math.floor(idx / cols) * (ph + gap);
      ctx.fillStyle = C.bg;
      ctx.fillRect(x, y, pw, ph);
      const rank = this.liveRank(r);
      const label =
        r.status === "dnf" ? "DNF  " : r.status === "done" ? `#${rank}  ` : "";
      const color = r.status === "dnf" ? C.red : r.status === "done" && rank === 1 ? C.green : C.fg;
      const steps = fmt(r.l.arr.steps);
      const stepsW = measure(ctx, steps, sans(fs * 0.9));
      const base = y + hh * 0.75;
      const name = `${label}${r.e.algo.short ?? r.e.algo.name}`;
      text(ctx, fit(ctx, name, sans(fs, 700), pw - 28 - stepsW), x + 10, base, sans(fs, 700), color);
      text(ctx, steps, x + pw - 10, base, sans(fs * 0.9), C.dim, "right");
      const a = shuffling ? this.shuffler.a : r.l.arr.a;
      drawBars(ctx, a, plan.max, x, y + hh + 2, pw, ph - hh - 2, {
        hl: shuffling ? this.shuffler.hl : r.status === "running" ? r.l.last : null,
        sweep: shuffling ? -1 : r.l.sweep,
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
