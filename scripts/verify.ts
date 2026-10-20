import { ALGOS } from "../src/algorithms.ts";
import { Arr } from "../src/arr.ts";
import { INPUTS, makeInput, mulberry32 } from "../src/inputs.ts";

let failed = 0;
for (const n of [16, 32, 64, 128, 256]) {
  for (const algo of ALGOS) {
    for (const input of INPUTS) {
      if (algo.dnf && input.id !== "sorted") continue;
      if (algo.id === "stooge" && n > 64) continue;
      for (let seed = 0; seed < 5; seed++) {
        const data = makeInput(input.id, n, mulberry32(seed));
        const expected = [...data].sort((x, y) => x - y);
        const arr = new Arr(data);
        const gen = algo.run(arr);
        while (!gen.next().done);
        if (arr.a.some((v, i) => v !== expected[i])) {
          failed++;
          console.error(`FAIL ${algo.id} n=${n} ${input.id} seed=${seed}`);
        }
      }
    }
  }
}
console.log(failed ? `${failed} failures` : "all sorted");
process.exit(failed ? 1 : 0);
