import type { Op } from "./arr.ts";

export const BAR_COLORS = {
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

export type BarState = {
  // Highlighted op; null once the racer is no longer running
  hl: Op | null;
  // Green sweep position after finishing; -1 until then, >= n once it's all green
  sweep: number;
  dnf: boolean;
};

export function drawBars(
  ctx: CanvasRenderingContext2D,
  a: number[],
  max: number,
  x: number,
  y: number,
  w: number,
  h: number,
  { hl, sweep, dnf }: BarState
) {
  ctx.fillStyle = BAR_COLORS.bg;
  ctx.fillRect(x, y, w, h);
  const n = a.length;
  const bw = w / n;
  const gap = bw >= 4 ? Math.max(1, Math.floor(bw * 0.18)) : 0;
  const hj = hl && "j" in hl ? hl.j : -1;
  const sweepAt = Math.ceil(sweep) - 1;
  for (let i = 0; i < n; i++) {
    let color: string = BAR_COLORS.bar;
    if (dnf) color = BAR_COLORS.dnf;
    else if (sweep >= n) color = BAR_COLORS.done;
    else if (i === sweepAt) color = BAR_COLORS.sweep;
    else if (i < sweep) color = BAR_COLORS.done;
    if (hl && (i === hl.i || i === hj)) color = BAR_COLORS[hl.t];
    const bh = Math.max(1, Math.round((a[i] / max) * h));
    const x1 = Math.round(x + i * bw);
    const x2 = Math.round(x + (i + 1) * bw) - gap;
    ctx.fillStyle = color;
    ctx.fillRect(x1, y + h - bh, Math.max(1, x2 - x1), bh);
  }
}
