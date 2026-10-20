import { INPUTS, type InputKind } from "./inputs.ts";
import {
  estimateSeconds,
  type Aspect,
  type RankBy,
  type VideoMode,
  type VideoOpts,
} from "./video.ts";

// X's limit for accounts without Premium
const X_LIMIT = 140;

type Shared = { n: number; input: InputKind; wave: OscillatorType; memes: boolean };

type Saved = {
  mode: VideoMode;
  aspect: Aspect;
  rankBy: RankBy;
  tourSeconds: number;
  raceSeconds: number;
};

const DEFAULTS: Saved = {
  mode: "tour",
  aspect: "16:9",
  rankBy: "input",
  tourSeconds: 4,
  raceSeconds: 40,
};

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function initVideoDialog(shared: () => Shared, onOpen: () => void) {
  const dialog = $<HTMLDialogElement>("#video-dialog");
  const mode = $<HTMLSelectElement>("#video-mode");
  const aspect = $<HTMLSelectElement>("#video-aspect");
  const rank = $<HTMLSelectElement>("#video-rank");
  const seconds = $<HTMLInputElement>("#video-seconds");
  const secondsLabel = $("#video-seconds-label");
  const summary = $("#video-summary");
  const duration = $("#video-duration");
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
    saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("video") ?? "{}") };
  } catch {}
  mode.value = saved.mode;
  aspect.value = saved.aspect;
  rank.value = saved.rankBy;

  let rendering = false;
  let cancelled = false;
  let url: string | null = null;
  let caption = "";

  const opts = (): VideoOpts => ({
    ...shared(),
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
    summary.textContent = `from the main controls: n = ${o.n} · ${input} · ${o.wave} wave · ${o.memes ? "with" : "without"} bogo + stooge`;
    const s = estimateSeconds(o);
    duration.textContent = `≈ ${clock(s)} at 60fps, H.264 + AAC`;
    duration.classList.toggle("warn", s > X_LIMIT);
    if (s > X_LIMIT) duration.textContent += ` · over X's 2:20 limit without Premium`;
    canvas.classList.toggle("tall", saved.aspect === "9:16");
    result.classList.toggle("tall", saved.aspect === "9:16");
  }

  function persist() {
    localStorage.setItem("video", JSON.stringify(saved));
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

  $("#video-open").onclick = () => {
    onOpen();
    sync();
    dialog.showModal();
  };
  $("#video-close").onclick = () => {
    if (rendering) cancelled = true;
    dialog.close();
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
    rendering = true;
    cancelled = false;
    renderBtn.disabled = true;
    cancelBtn.hidden = false;
    done.hidden = true;
    result.hidden = true;
    canvas.hidden = false;
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
      download.download = `sorting-ranked-${o.mode}-n${o.n}-${o.input}-${o.aspect.replace(":", "x")}.mp4`;
      done.hidden = false;
      const mb = (out.blob.size / 1e6).toFixed(1);
      const took = ((performance.now() - started) / 1000).toFixed(0);
      status.textContent = `${clock(out.seconds)} · ${mb} MB · rendered in ${took}s`;
      if (!out.aac) {
        status.textContent +=
          " · no AAC encoder here, audio is Opus. X wants AAC: ffmpeg -i in.mp4 -c:v copy -c:a aac out.mp4";
      }
      caption = makeCaption(o);
    } catch (err) {
      console.error(err);
      status.textContent = `failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      rendering = false;
      renderBtn.disabled = false;
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
