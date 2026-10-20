import type { Arr, Sorter, Step } from "./arr.ts";
import { mulberry32 } from "./inputs.ts";

export type Algo = {
  id: string;
  name: string;
  // For small race panels in the video
  short?: string;
  best: string;
  avg: string;
  worst: string;
  note: string;
  // Joke entries, hidden by the "bogo + stooge" toggle
  meme?: boolean;
  // Might never finish, so it's marked DNF once everyone else is done
  dnf?: boolean;
  run: (a: Arr) => Sorter;
};

function* bubble(a: Arr): Sorter {
  for (let end = a.n - 1; end > 0; end--) {
    let swapped = false;
    for (let i = 0; i < end; i++) {
      if ((yield* a.cmp(i, i + 1)) > 0) {
        yield* a.swap(i, i + 1);
        swapped = true;
      }
    }
    if (!swapped) return;
  }
}

function* cocktail(a: Arr): Sorter {
  let lo = 0;
  let hi = a.n - 1;
  while (lo < hi) {
    let last = lo;
    for (let i = lo; i < hi; i++) {
      if ((yield* a.cmp(i, i + 1)) > 0) {
        yield* a.swap(i, i + 1);
        last = i;
      }
    }
    hi = last;
    last = hi;
    for (let i = hi; i > lo; i--) {
      if ((yield* a.cmp(i - 1, i)) > 0) {
        yield* a.swap(i - 1, i);
        last = i;
      }
    }
    lo = last;
  }
}

function* oddEven(a: Arr): Sorter {
  let sorted = false;
  while (!sorted) {
    sorted = true;
    for (const start of [1, 0]) {
      for (let i = start; i + 1 < a.n; i += 2) {
        if ((yield* a.cmp(i, i + 1)) > 0) {
          yield* a.swap(i, i + 1);
          sorted = false;
        }
      }
    }
  }
}

function* gnome(a: Arr): Sorter {
  let i = 0;
  while (i < a.n) {
    if (i === 0 || (yield* a.cmp(i - 1, i)) <= 0) i++;
    else {
      yield* a.swap(i - 1, i);
      i--;
    }
  }
}

function* comb(a: Arr): Sorter {
  let gap = a.n;
  let sorted = false;
  while (!sorted) {
    gap = Math.floor(gap / 1.3);
    if (gap <= 1) {
      gap = 1;
      sorted = true;
    }
    for (let i = 0; i + gap < a.n; i++) {
      if ((yield* a.cmp(i, i + gap)) > 0) {
        yield* a.swap(i, i + gap);
        sorted = false;
      }
    }
  }
}

function* selection(a: Arr): Sorter {
  for (let i = 0; i < a.n - 1; i++) {
    let min = i;
    for (let j = i + 1; j < a.n; j++) {
      if ((yield* a.cmp(j, min)) < 0) min = j;
    }
    if (min !== i) yield* a.swap(i, min);
  }
}

// Shifting insertion sort over [lo, hi) with stride gap
function* gappedInsertion(a: Arr, lo: number, hi: number, gap: number): Sorter {
  for (let i = lo + gap; i < hi; i++) {
    const v = a.get(i);
    let j = i;
    while (j - gap >= lo && (yield* a.cmpv(a.get(j - gap), v, j - gap, j)) > 0) {
      yield* a.set(j, a.get(j - gap));
      j -= gap;
    }
    if (j !== i) yield* a.set(j, v);
  }
}

function* binaryInsertion(a: Arr): Sorter {
  for (let i = 1; i < a.n; i++) {
    const v = a.get(i);
    let lo = 0;
    let hi = i;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((yield* a.cmpv(a.get(mid), v, mid, i)) <= 0) lo = mid + 1;
      else hi = mid;
    }
    for (let j = i; j > lo; j--) yield* a.set(j, a.get(j - 1));
    if (lo !== i) yield* a.set(lo, v);
  }
}

const CIURA = [701, 301, 132, 57, 23, 10, 4, 1];

function* shell(a: Arr): Sorter {
  for (const gap of CIURA) {
    if (gap < a.n) yield* gappedInsertion(a, 0, a.n, gap);
  }
}

// Merges [lo, mid] and [mid + 1, hi]; only the left half is buffered
function* merge(a: Arr, lo: number, mid: number, hi: number): Sorter {
  const buf: number[] = [];
  for (let i = lo; i <= mid; i++) buf.push(yield* a.read(i));
  let i = 0;
  let j = mid + 1;
  let k = lo;
  while (i < buf.length && j <= hi) {
    if ((yield* a.cmpv(buf[i], a.get(j), k, j)) <= 0) {
      yield* a.set(k++, buf[i++]);
    } else {
      yield* a.set(k++, a.get(j++));
    }
  }
  while (i < buf.length) yield* a.set(k++, buf[i++]);
}

function* mergeSort(a: Arr, lo: number, hi: number): Sorter {
  if (lo >= hi) return;
  const mid = (lo + hi) >> 1;
  yield* mergeSort(a, lo, mid);
  yield* mergeSort(a, mid + 1, hi);
  yield* merge(a, lo, mid, hi);
}

function* tim(a: Arr): Sorter {
  const RUN = 16;
  for (let lo = 0; lo < a.n; lo += RUN) {
    yield* gappedInsertion(a, lo, Math.min(lo + RUN, a.n), 1);
  }
  for (let size = RUN; size < a.n; size *= 2) {
    for (let lo = 0; lo + size < a.n; lo += 2 * size) {
      const mid = lo + size - 1;
      const hi = Math.min(lo + 2 * size - 1, a.n - 1);
      if ((yield* a.cmp(mid, mid + 1)) > 0) yield* merge(a, lo, mid, hi);
    }
  }
}

function* quickHoare(a: Arr, lo: number, hi: number): Sorter {
  if (lo >= hi) return;
  const pivot = a.get((lo + hi) >> 1);
  let i = lo - 1;
  let j = hi + 1;
  while (true) {
    do i++;
    while ((yield* a.cmpv(a.get(i), pivot, i)) < 0);
    do j--;
    while ((yield* a.cmpv(a.get(j), pivot, j)) > 0);
    if (i >= j) break;
    yield* a.swap(i, j);
  }
  yield* quickHoare(a, lo, j);
  yield* quickHoare(a, j + 1, hi);
}

function* quickLomuto(a: Arr, lo: number, hi: number): Sorter {
  if (lo >= hi) return;
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if ((yield* a.cmp(j, hi)) < 0) {
      if (i !== j) yield* a.swap(i, j);
      i++;
    }
  }
  if (i !== hi) yield* a.swap(i, hi);
  yield* quickLomuto(a, lo, i - 1);
  yield* quickLomuto(a, i + 1, hi);
}

function* siftDown(a: Arr, i: number, n: number): Sorter {
  while (true) {
    const l = 2 * i + 1;
    let big = i;
    if (l < n && (yield* a.cmp(l, big)) > 0) big = l;
    if (l + 1 < n && (yield* a.cmp(l + 1, big)) > 0) big = l + 1;
    if (big === i) return;
    yield* a.swap(i, big);
    i = big;
  }
}

function* heap(a: Arr): Sorter {
  for (let i = (a.n >> 1) - 1; i >= 0; i--) yield* siftDown(a, i, a.n);
  for (let end = a.n - 1; end > 0; end--) {
    yield* a.swap(0, end);
    yield* siftDown(a, 0, end);
  }
}

const BASE = 4;
const digit = (v: number, exp: number) => Math.floor(v / exp) % BASE;

function* maxValue(a: Arr): Step<number> {
  let max = 0;
  for (let i = 0; i < a.n; i++) max = Math.max(max, yield* a.read(i));
  return max;
}

function* radixLSD(a: Arr): Sorter {
  const max = yield* maxValue(a);
  for (let exp = 1; Math.floor(max / exp) > 0; exp *= BASE) {
    const vals: number[] = [];
    const count = new Array(BASE).fill(0);
    for (let i = 0; i < a.n; i++) {
      const v = yield* a.read(i);
      vals.push(v);
      count[digit(v, exp)]++;
    }
    for (let d = 1; d < BASE; d++) count[d] += count[d - 1];
    const out = new Array<number>(a.n);
    for (let i = a.n - 1; i >= 0; i--) out[--count[digit(vals[i], exp)]] = vals[i];
    for (let i = 0; i < a.n; i++) yield* a.set(i, out[i]);
  }
}

function* radixMSD(a: Arr, lo: number, hi: number, exp: number): Sorter {
  if (hi - lo < 2 || exp < 1) return;
  const vals: number[] = [];
  const count = new Array(BASE).fill(0);
  for (let i = lo; i < hi; i++) {
    const v = yield* a.read(i);
    vals.push(v);
    count[digit(v, exp)]++;
  }
  const pos = [0];
  for (let d = 1; d < BASE; d++) pos.push(pos[d - 1] + count[d - 1]);
  const out = new Array<number>(vals.length);
  for (const v of vals) out[pos[digit(v, exp)]++] = v;
  for (let i = 0; i < out.length; i++) yield* a.set(lo + i, out[i]);
  let start = lo;
  for (let d = 0; d < BASE; d++) {
    yield* radixMSD(a, start, start + count[d], exp / BASE);
    start += count[d];
  }
}

// Needs a power-of-two length, which every size offered is
function* bitonic(a: Arr): Sorter {
  for (let k = 2; k <= a.n; k *= 2) {
    for (let j = k >> 1; j > 0; j >>= 1) {
      for (let i = 0; i < a.n; i++) {
        const l = i ^ j;
        if (l <= i) continue;
        const c = yield* a.cmp(i, l);
        if ((i & k) === 0 ? c > 0 : c < 0) yield* a.swap(i, l);
      }
    }
  }
}

function* cyclePos(a: Arr, item: number, start: number): Step<number> {
  let pos = start;
  for (let i = start + 1; i < a.n; i++) {
    if ((yield* a.cmpv(a.get(i), item, i, start)) < 0) pos++;
  }
  return pos;
}

function* cycle(a: Arr): Sorter {
  for (let start = 0; start < a.n - 1; start++) {
    let item = a.get(start);
    let pos = yield* cyclePos(a, item, start);
    if (pos === start) continue;
    while ((yield* a.cmpv(item, a.get(pos), pos)) === 0) pos++;
    let next = a.get(pos);
    yield* a.set(pos, item);
    item = next;
    while (pos !== start) {
      pos = yield* cyclePos(a, item, start);
      while ((yield* a.cmpv(item, a.get(pos), pos)) === 0) pos++;
      next = a.get(pos);
      yield* a.set(pos, item);
      item = next;
    }
  }
}

function* flip(a: Arr, k: number): Sorter {
  for (let i = 0, j = k; i < j; i++, j--) yield* a.swap(i, j);
}

function* pancake(a: Arr): Sorter {
  for (let size = a.n; size > 1; size--) {
    let max = 0;
    for (let i = 1; i < size; i++) {
      if ((yield* a.cmp(i, max)) > 0) max = i;
    }
    if (max === size - 1) continue;
    if (max > 0) yield* flip(a, max);
    yield* flip(a, size - 1);
  }
}

function* stooge(a: Arr, i: number, j: number): Sorter {
  if ((yield* a.cmp(i, j)) > 0) yield* a.swap(i, j);
  if (j - i + 1 > 2) {
    const t = Math.floor((j - i + 1) / 3);
    yield* stooge(a, i, j - t);
    yield* stooge(a, i + t, j);
    yield* stooge(a, i, j - t);
  }
}

// Seeded so a run is reproducible: video export simulates every run twice and both must match
function* bogo(a: Arr): Sorter {
  const rand = mulberry32(0xb090);
  while (true) {
    let sorted = true;
    for (let i = 1; i < a.n; i++) {
      if ((yield* a.cmp(i - 1, i)) > 0) {
        sorted = false;
        break;
      }
    }
    if (sorted) return;
    for (let i = a.n - 1; i > 0; i--) {
      yield* a.swap(i, Math.floor(rand() * (i + 1)));
    }
  }
}

export const ALGOS: Algo[] = [
  {
    id: "bubble",
    name: "Bubble",
    best: "n",
    avg: "n²",
    worst: "n²",
    note: "The first one everyone learns. The last one anyone uses.",
    run: bubble,
  },
  {
    id: "cocktail",
    name: "Cocktail Shaker",
    short: "Cocktail",
    best: "n",
    avg: "n²",
    worst: "n²",
    note: "Bubble sort that goes both ways, so small values stop crawling.",
    run: cocktail,
  },
  {
    id: "odd-even",
    name: "Odd-Even",
    best: "n",
    avg: "n²",
    worst: "n²",
    note: "Bubble sort built for parallel hardware: every pair in a pass is independent.",
    run: oddEven,
  },
  {
    id: "gnome",
    name: "Gnome",
    best: "n",
    avg: "n²",
    worst: "n²",
    note: "One loop, no nesting. A garden gnome shuffling flower pots.",
    run: gnome,
  },
  {
    id: "comb",
    name: "Comb",
    best: "n log n",
    avg: "n²/2ᵖ",
    worst: "n²",
    note: "Bubble sort with a gap that shrinks by 1.3 each pass. Kills the turtles.",
    run: comb,
  },
  {
    id: "selection",
    name: "Selection",
    best: "n²",
    avg: "n²",
    worst: "n²",
    note: "Always n²/2 compares, no matter the input. At most n swaps though.",
    run: selection,
  },
  {
    id: "insertion",
    name: "Insertion",
    best: "n",
    avg: "n²",
    worst: "n²",
    note: "How you sort a hand of cards. Unbeatable on nearly sorted input.",
    run: (a) => gappedInsertion(a, 0, a.n, 1),
  },
  {
    id: "binary-insertion",
    name: "Binary Insertion",
    short: "Bin. Insertion",
    best: "n log n",
    avg: "n²",
    worst: "n²",
    note: "Binary search finds the slot fast. The shifting is still O(n²).",
    run: binaryInsertion,
  },
  {
    id: "shell",
    name: "Shell",
    best: "n log n",
    avg: "~n¹·³",
    worst: "n¹·⁵",
    note: "Insertion sort with long jumps first. Ciura's 2001 gap sequence.",
    run: shell,
  },
  {
    id: "merge",
    name: "Merge",
    best: "n log n",
    avg: "n log n",
    worst: "n log n",
    note: "Von Neumann, 1945. Split, recurse, zip back together. Guaranteed n log n.",
    run: (a) => mergeSort(a, 0, a.n - 1),
  },
  {
    id: "tim",
    name: "Tim (simplified)",
    short: "Tim",
    best: "n",
    avg: "n log n",
    worst: "n log n",
    note: "Insertion-sorted runs merged bottom-up, skipping merges that are already in order.",
    run: tim,
  },
  {
    id: "quick-hoare",
    name: "Quick (Hoare)",
    short: "Quick Hoare",
    best: "n log n",
    avg: "n log n",
    worst: "n²",
    note: "Hoare, 1959. Middle pivot, two pointers walking inward.",
    run: (a) => quickHoare(a, 0, a.n - 1),
  },
  {
    id: "quick-lomuto",
    name: "Quick (Lomuto)",
    short: "Quick Lomuto",
    best: "n log n",
    avg: "n log n",
    worst: "n²",
    note: "The textbook partition. Last-element pivot, so sorted input wrecks it.",
    run: (a) => quickLomuto(a, 0, a.n - 1),
  },
  {
    id: "heap",
    name: "Heap",
    best: "n log n",
    avg: "n log n",
    worst: "n log n",
    note: "Build a max-heap, pop the top to the end, repeat. O(1) extra memory.",
    run: heap,
  },
  {
    id: "radix-lsd",
    name: "Radix LSD (base 4)",
    short: "Radix LSD",
    best: "nk",
    avg: "nk",
    worst: "nk",
    note: "Zero comparisons. Bucket by the lowest digit first, then the next.",
    run: radixLSD,
  },
  {
    id: "radix-msd",
    name: "Radix MSD (base 4)",
    short: "Radix MSD",
    best: "nk",
    avg: "nk",
    worst: "nk",
    note: "Bucket by the top digit, then recurse into each bucket.",
    run: function* (a) {
      const max = yield* maxValue(a);
      let exp = 1;
      while (exp * BASE <= max) exp *= BASE;
      yield* radixMSD(a, 0, a.n, exp);
    },
  },
  {
    id: "bitonic",
    name: "Bitonic",
    best: "n log² n",
    avg: "n log² n",
    worst: "n log² n",
    note: "A sorting network: every comparison is fixed up front. Great on GPUs.",
    run: bitonic,
  },
  {
    id: "cycle",
    name: "Cycle",
    best: "n²",
    avg: "n²",
    worst: "n²",
    note: "Writes each element at most once. Fewest writes possible, for when writes hurt.",
    run: cycle,
  },
  {
    id: "pancake",
    name: "Pancake",
    best: "n²",
    avg: "n²",
    worst: "n²",
    note: "You can only flip the top of the stack. Bill Gates' one research paper.",
    run: pancake,
  },
  {
    id: "stooge",
    name: "Stooge",
    best: "n²·⁷¹",
    avg: "n²·⁷¹",
    worst: "n²·⁷¹",
    note: "Sort the first 2/3, the last 2/3, the first 2/3 again. Correct, somehow.",
    meme: true,
    run: (a) => stooge(a, 0, a.n - 1),
  },
  {
    id: "bogo",
    name: "Bogo",
    best: "n",
    avg: "n·n!",
    worst: "∞",
    note: "Shuffle until sorted. Wins on sorted input, never finishes otherwise.",
    meme: true,
    dnf: true,
    run: bogo,
  },
];
