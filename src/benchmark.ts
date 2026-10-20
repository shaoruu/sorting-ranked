import { ALGOS, type Algo } from "./algorithms.ts";
import { Arr } from "./arr.ts";
import { INPUTS, makeInput, mulberry32, type InputKind } from "./inputs.ts";

const SEEDS = 3;
// Bogo gets this many steps before it's called infinite
const DNF_CAP = 200_000;

export type BenchRow = {
  algo: Algo;
  steps: Record<InputKind, number>;
  ranks: Record<InputKind, number>;
  // Geometric mean of steps across inputs, so no single input dominates
  score: number;
};

function run(algo: Algo, data: number[]) {
  const arr = new Arr(data);
  const gen = algo.run(arr);
  while (!gen.next().done) {
    if (algo.dnf && arr.steps > DNF_CAP) return Infinity;
  }
  return arr.steps;
}

export async function benchmark(
  n: number,
  onProgress: (fraction: number) => void
): Promise<BenchRow[]> {
  const rows: BenchRow[] = [];
  const total = ALGOS.length * INPUTS.length;
  let done = 0;
  for (const algo of ALGOS) {
    const steps = {} as Record<InputKind, number>;
    for (const input of INPUTS) {
      const seeds = input.seeded ? SEEDS : 1;
      let sum = 0;
      for (let s = 0; s < seeds; s++) {
        sum += run(algo, makeInput(input.id, n, mulberry32(1000 + s)));
      }
      steps[input.id] = sum / seeds;
      onProgress(++done / total);
      await new Promise((r) => setTimeout(r));
    }
    const logs = INPUTS.map((i) => Math.log(steps[i.id]));
    const score = Math.exp(logs.reduce((x, y) => x + y, 0) / logs.length);
    rows.push({ algo, steps, ranks: {} as Record<InputKind, number>, score });
  }
  for (const input of INPUTS) {
    for (const row of rows) {
      row.ranks[input.id] =
        1 + rows.filter((o) => o.steps[input.id] < row.steps[input.id]).length;
    }
  }
  return rows.sort((a, b) => a.score - b.score);
}
