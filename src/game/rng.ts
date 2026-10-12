/** Small deterministic PRNG (mulberry32) so simulations and tests are reproducible. */
export class Rng {
  private state: number;

  constructor(seed = 0x5eed) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  rangeOf(pair: readonly [number, number]): number {
    return this.range(pair[0], pair[1]);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  weighted<T extends { weight: number }>(items: readonly T[]): T | undefined {
    let total = 0;
    for (const it of items) total += it.weight;
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }
}
