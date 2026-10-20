import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  canEncodeAudio,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
} from "mediabunny";
import {
  createScene,
  FPS,
  makePlan,
  SAMPLE_RATE,
  synthesize,
  type Tone,
  type VideoOpts,
} from "./video.ts";

export type Progress = { phase: string; fraction: number };

const AUDIO_BITRATE = 192_000;

async function loadFonts() {
  await Promise.all(
    ['80px VT323', '400 30px "IBM Plex Mono"', '600 30px "IBM Plex Mono"'].map((f) =>
      document.fonts.load(f)
    )
  );
}

// Renders offline, frame by frame, so nothing drops no matter how slow the machine is
export async function renderVideo(
  opts: VideoOpts,
  canvas: HTMLCanvasElement,
  onProgress: (p: Progress) => void,
  isCancelled: () => boolean
) {
  await loadFonts();
  onProgress({ phase: opts.rankBy === "overall" ? "benchmarking" : "planning", fraction: 0 });
  const plan = await makePlan(opts);
  canvas.width = plan.width;
  canvas.height = plan.height;

  onProgress({ phase: "synthesizing audio", fraction: 0 });
  const tones: Tone[] = [];
  const sim = createScene(plan);
  for (let f = 0; f < sim.frames; f++) sim.step(f, tones);
  const seconds = sim.frames / FPS;
  const samples = synthesize(tones, seconds, opts.wave);

  // ~0.1 bits per pixel per frame: 12 Mbps at 1080p60, under X's 25 Mbps cap
  const bitrate = Math.round(plan.width * plan.height * FPS * 0.1);
  const videoOk = await canEncodeVideo("avc", {
    width: plan.width,
    height: plan.height,
    bitrate,
    frameRate: FPS,
  });
  if (!videoOk) throw new Error("This browser can't encode H.264. Use Chrome or Safari.");
  const aac = await canEncodeAudio("aac", {
    numberOfChannels: 2,
    sampleRate: SAMPLE_RATE,
    bitrate: AUDIO_BITRATE,
  });

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const video = new CanvasSource(canvas, { codec: "avc", bitrate, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: aac ? "aac" : "opus", bitrate: AUDIO_BITRATE });
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(audio);
  await output.start();

  let audioAt = 0;
  // Audio goes in one-second chunks alongside the frames so the muxer can interleave as it goes
  const addAudio = async (until: number) => {
    const end = Math.min(samples.length, Math.round(until * SAMPLE_RATE));
    if (end <= audioAt) return;
    const chunk = samples.subarray(audioAt, end);
    const buf = new AudioBuffer({ length: chunk.length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    buf.copyToChannel(chunk, 0);
    buf.copyToChannel(chunk, 1);
    audioAt = end;
    await audio.add(buf);
  };

  const ctx = canvas.getContext("2d")!;
  const scene = createScene(plan);
  const discard: Tone[] = [];
  for (let f = 0; f < scene.frames; f++) {
    if (isCancelled()) {
      await output.cancel();
      return null;
    }
    scene.step(f, discard);
    discard.length = 0;
    scene.draw(ctx, f);
    await video.add(f / FPS, 1 / FPS);
    if (f % FPS === FPS - 1) await addAudio((f + 1) / FPS + 1);
    onProgress({ phase: "encoding", fraction: (f + 1) / scene.frames });
  }
  await addAudio(seconds + 1);
  onProgress({ phase: "finalizing", fraction: 1 });
  await output.finalize();
  return { blob: new Blob([target.buffer!], { type: "video/mp4" }), aac, seconds };
}
