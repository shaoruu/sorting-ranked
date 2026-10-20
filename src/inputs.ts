export type InputKind = "random" | "reversed" | "nearly" | "few" | "sorted";

export const INPUTS: {
  id: InputKind;
  label: string;
  short: string;
  // Inputs that depend on the seed get averaged over a few seeds in the benchmark
  seeded: boolean;
}[] = [
  { id: "random", label: "random", short: "rnd", seeded: true },
  { id: "reversed", label: "reversed", short: "rev", seeded: false },
  { id: "nearly", label: "nearly sorted", short: "near", seeded: true },
  { id: "few", label: "few unique", short: "few", seeded: true },
  { id: "sorted", label: "already sorted", short: "srt", seeded: false },
];

export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(a: number[], rand: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function makeInput(kind: InputKind, n: number, rand: () => number) {
  const a = Array.from({ length: n }, (_, i) => i + 1);
  switch (kind) {
    case "random":
      return shuffle(a, rand);
    case "reversed":
      return a.reverse();
    case "sorted":
      return a;
    case "nearly":
      for (let k = 0; k < Math.max(1, n / 16); k++) {
        const i = Math.floor(rand() * n);
        const j = Math.min(n - 1, i + 1 + Math.floor(rand() * 3));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    case "few":
      return shuffle(
        a.map((_, i) => ((i % 4) + 1) * (n / 4)),
        rand
      );
  }
}
