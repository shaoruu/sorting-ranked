export type Op =
  | { t: "cmp"; i: number; j: number }
  | { t: "swap"; i: number; j: number }
  | { t: "write"; i: number }
  | { t: "read"; i: number };

export type Step<T = void> = Generator<Op, T, undefined>;
export type Sorter = Step<void>;

// Every yielded op is one step. Steps are the race clock, so finish order is the ranking.
// Holding a single value (a key, a pivot) is free; copying into a buffer costs a read per element.
export class Arr {
  readonly a: number[];
  steps = 0;
  cmps = 0;
  writes = 0;

  constructor(a: number[]) {
    this.a = a;
  }

  get n() {
    return this.a.length;
  }

  get(i: number) {
    return this.a[i];
  }

  *cmp(i: number, j: number): Step<number> {
    this.steps++;
    this.cmps++;
    yield { t: "cmp", i, j };
    return this.a[i] - this.a[j];
  }

  // For values held outside the array; i and j are only what gets highlighted
  *cmpv(x: number, y: number, i: number, j = i): Step<number> {
    this.steps++;
    this.cmps++;
    yield { t: "cmp", i, j };
    return x - y;
  }

  *swap(i: number, j: number): Step {
    this.steps++;
    this.writes += 2;
    const t = this.a[i];
    this.a[i] = this.a[j];
    this.a[j] = t;
    yield { t: "swap", i, j };
  }

  *set(i: number, v: number): Step {
    this.steps++;
    this.writes++;
    this.a[i] = v;
    yield { t: "write", i };
  }

  *read(i: number): Step<number> {
    this.steps++;
    yield { t: "read", i };
    return this.a[i];
  }
}
