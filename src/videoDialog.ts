import { track } from "@vercel/analytics";
import * as audio from "./audio.ts";
import { INPUTS, type InputKind } from "./inputs.ts";
import {
  createScene,
  estimateSeconds,
  FPS,
  makePlan,
  type Aspect,
  type RankBy,
  type Tone,
  type VideoMode,
  type VideoOpts,
} from "./video.ts";

// X's limit for accounts without Premium
const X_LIMIT = 140;
const STORE_KEY = "video-v2";

type Shared = { input: InputKind; wave: OscillatorType; memes: boolean };

type Saved = {
  mode: VideoMode;
  aspect: Aspect;
  rankBy: RankBy;
  n: number;
  tourSeconds: number;
  raceSeconds: number;
};

const DEFAULTS: Saved = {
  mode: "tour",
  aspect: "16:9",
  rankBy: "input",
  n: 128,
  tourSeconds: 3.5,
  raceSeconds: 40,
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function initVideoDialog(shared: () => Shared, onOpen: () => void) {
  const dialog = $<HTMLDialogElement>("#video-dialog");
  const mode = $<HTMLSelectElement>("#video-mode");
  const aspect = $<HTMLSelectElement>("#video-aspect");
  const size = $<HTMLSelectElement>("#video-n");
  const rank = $<HTMLSelectElement>("#video-rank");
  const seconds = $<HTMLInputElement>("#video-seconds");
  const secondsLabel = $("#video-seconds-label");
  const summary = $("#video-summary");
  const duration = $("#video-duration");
  const previewBtn = $<HTMLButtonElement>("#video-preview");
  const renderBtn = $<HTMLButtonElement>("#video-render");
  const cancelBtn = $<HTMLButtonElement>("#video-cancel");
  const progress = $("#video-progress");
  const status = $("#video-status");
  const done = $("#video-done");
  const download = $<HTMLAnchorElement>("#video-download");
  const canvas = $<HTMLCanvasElement>("#video-canvas");
  const result = $<HTMLVideoElement>("#video-result");

  let saved: Saved = { ...DEFAULTS };
  try {
    saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") };
  } catch {}
  mode.value = saved.mode;
  aspect.value = saved.aspect;
  size.value = String(saved.n);
  rank.value = saved.rankBy;

  let rendering = false;
  let cancelled = false;
  let previewRaf = 0;
  let url: string | null = null;
  let caption = "";

  const opts = (): VideoOpts => ({
    ...shared(),
    n: saved.n,
    mode: saved.mode,
    aspect: saved.aspect,
    rankBy: saved.rankBy,
    seconds: saved.mode === "tour" ? saved.tourSeconds : saved.raceSeconds,
    seed: (Math.random() * 2 ** 32) >>> 0,
  });

  function sync() {
    secondsLabel.textContent = saved.mode === "tour" ? "seconds each" : "race seconds";
    seconds.value = String(saved.mode === "tour" ? saved.tourSeconds : saved.raceSeconds);
    const o = opts();
    const input = INPUTS.find((i) => i.id === o.input)!.label;
    summary.textContent = `from the main controls: ${input} input · ${o.wave} wave · ${o.memes ? "with" : "without"} bogo + stooge`;
    const s = estimateSeconds(o);
    duration.textContent = `≈ ${clock(s)} at 60fps, H.264 + AAC`;
    duration.classList.toggle("warn", s > X_LIMIT);
    if (s > X_LIMIT) duration.textContent += ` · over X's 2:20 limit without Premium`;
  }

  function persist() {
    localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    stopPreview();
    sync();
  }

  mode.onchange = () => {
    saved.mode = mode.value as VideoMode;
    persist();
  };
  aspect.onchange = () => {
    saved.aspect = aspect.value as Aspect;
    persist();
  };
  size.onchange = () => {
    saved.n = Number(size.value);
    persist();
  };
  rank.onchange = () => {
    saved.rankBy = rank.value as RankBy;
    persist();
  };
  seconds.onchange = () => {
    const v = Math.min(120, Math.max(1, Number(seconds.value) || 1));
    if (saved.mode === "tour") saved.tourSeconds = v;
    else saved.raceSeconds = v;
    persist();
  };

  function showCanvas() {
    result.pause();
    result.hidden = true;
    canvas.hidden = false;
  }

  function stopPreview() {
    if (!previewRaf) return;
    cancelAnimationFrame(previewRaf);
    previewRaf = 0;
    previewBtn.textContent = "▶ preview";
  }

  // Plays the exact scene the render would encode, in real time with live audio
  async function preview() {
    if (previewRaf) return stopPreview();
    audio.unlock();
    showCanvas();
    status.textContent = "planning…";
    const o = opts();
    track("video_preview", { mode: o.mode, aspect: o.aspect, n: o.n });
    const plan = await makePlan(o);
    status.textContent = "";
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext("2d")!;
    const scene = createScene(plan);
    const tones: Tone[] = [];
    const start = performance.now();
    let f = 0;
    previewBtn.textContent = "■ stop";
    const tick = () => {
      const elapsed = (performance.now() - start) / 1000;
      const due = Math.min(scene.frames - 1, Math.floor(elapsed * FPS));
      while (f <= due) {
        tones.length = 0;
        scene.step(f, tones);
        for (const t of tones) audio.tone(t.freq, t.dur, t.vol, Math.max(0, t.t - elapsed), t.wave);
        f++;
      }
      scene.draw(ctx, f - 1);
      progress.style.width = `${(f / scene.frames) * 100}%`;
      if (f < scene.frames) previewRaf = requestAnimationFrame(tick);
      else stopPreview();
    };
    previewRaf = requestAnimationFrame(tick);
  }

  $("#video-open").onclick = () => {
    onOpen();
    sync();
    dialog.showModal();
  };
  $("#video-close").onclick = () => {
    if (rendering) cancelled = true;
    stopPreview();
    dialog.close();
  };
  previewBtn.onclick = () => void preview();
  $("#video-fullscreen").onclick = () => {
    if (!previewRaf) void preview();
    void (result.hidden ? canvas : result).requestFullscreen();
  };
  cancelBtn.onclick = () => {
    cancelled = true;
  };
  $("#video-caption").onclick = async () => {
    await navigator.clipboard.writeText(caption);
    status.textContent = "caption copied";
  };

  renderBtn.onclick = async () => {
    if (rendering) return;
    stopPreview();
    rendering = true;
    cancelled = false;
    renderBtn.disabled = true;
    previewBtn.disabled = true;
    cancelBtn.hidden = false;
    done.hidden = true;
    showCanvas();
    progress.style.width = "0%";
    const o = opts();
    const started = performance.now();
    try {
      const { renderVideo } = await import("./export.ts");
      const out = await renderVideo(
        o,
        canvas,
        ({ phase, fraction }) => {
          progress.style.width = `${fraction * 100}%`;
          status.textContent = `${phase}… ${Math.round(fraction * 100)}%`;
        },
        () => cancelled
      );
      if (!out) {
        status.textContent = "cancelled";
        return;
      }
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(out.blob);
      result.src = url;
      result.hidden = false;
      canvas.hidden = true;
      download.href = url;
      download.download = `sorting-${o.mode === "tour" ? "fullscreen" : "grid"}-n${o.n}-${o.input}-${o.aspect.replace(":", "x")}.mp4`;
      done.hidden = false;
      const mb = (out.blob.size / 1e6).toFixed(1);
      const took = ((performance.now() - started) / 1000).toFixed(0);
      status.textContent = `${clock(out.seconds)} · ${mb} MB · rendered in ${took}s`;
      if (!out.aac) {
        status.textContent +=
          " · no AAC encoder here, audio is Opus. X wants AAC: ffmpeg -i in.mp4 -c:v copy -c:a aac out.mp4";
      }
      caption = makeCaption(o);
      track("video_export", {
        mode: o.mode,
        aspect: o.aspect,
        n: o.n,
        input: o.input,
        rankBy: o.rankBy,
        seconds: Math.round(out.seconds),
      });
    } catch (err) {
      console.error(err);
      status.textContent = `failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      rendering = false;
      renderBtn.disabled = false;
      previewBtn.disabled = false;
      cancelBtn.hidden = true;
    }
  };

  return { isOpen: () => dialog.open };
}

function makeCaption(o: VideoOpts) {
  const count = o.memes ? 21 : 19;
  const input = INPUTS.find((i) => i.id === o.input)!.label;
  const how =
    o.mode === "tour"
      ? `${count} sorting algorithms, ranked worst to best 🔊`
      : `${count} sorting algorithms racing on the same array 🔊`;
  return `${how}

same ${input} array of ${o.n}, same clock: every compare, swap and write costs one step.

throwback to learning CS. play with it: https://sorting-ranked.vercel.app`;
}
