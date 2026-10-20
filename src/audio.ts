let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let wave: OscillatorType = "triangle";

// Square and saw carry far more energy than sine at the same gain
const WAVE_GAIN: Record<string, number> = {
  sine: 1,
  triangle: 0.9,
  square: 0.35,
  sawtooth: 0.4,
};

// Browsers only allow audio after a user gesture, so call this from click/key handlers
export function unlock() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
}

export function setWave(w: OscillatorType) {
  wave = w;
}

// The classic mapping from those old visualizer videos
export const pitch = (value: number, max: number) => 120 + 1100 * (value / max);

export function tone(freq: number, dur = 0.08, vol = 1, delay = 0) {
  if (!ctx || !master || ctx.state !== "running") return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(vol * WAVE_GAIN[wave], t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export function fanfare() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    tone(f, i === 3 ? 0.4 : 0.16, 0.7, i * 0.09)
  );
}
