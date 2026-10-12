import { MAX_ATTACK_TOKENS } from './constants';

/**
 * Limits how many enemies may commit to an attack at the same time.
 * An enemy must hold a token from the moment it engages until its attack
 * string fully recovers; everyone else repositions.
 */
export class AttackTokens {
  readonly max: number;
  private readonly holders = new Set<number>();

  constructor(max = MAX_ATTACK_TOKENS) {
    this.max = max;
  }

  request(id: number): boolean {
    if (this.holders.has(id)) return true;
    if (this.holders.size >= this.max) return false;
    this.holders.add(id);
    return true;
  }

  release(id: number): void {
    this.holders.delete(id);
  }

  has(id: number): boolean {
    return this.holders.has(id);
  }

  get count(): number {
    return this.holders.size;
  }

  clear(): void {
    this.holders.clear();
  }
}
