import { INPUT_BUFFER_MS } from './constants';

export type BufferedAction = 'light' | 'heavy' | 'push' | 'finisher' | 'dodge' | 'guardPress' | 'avoidHigh' | 'avoidLow';

export interface BufferEntry {
  readonly action: BufferedAction;
  readonly time: number;
  readonly expiresAt: number;
  readonly seq: number;
}

/**
 * Short-lived queue of pressed actions so inputs made slightly early
 * (during recovery or hitstop) still execute when the fighter can act.
 */
export class InputBuffer {
  readonly windowMs: number;
  private entries: BufferEntry[] = [];
  private seq = 0;

  constructor(windowMs = INPUT_BUFFER_MS) {
    this.windowMs = windowMs;
  }

  /**
   * Queue an action. `expiresAt` may be extended past the normal window, e.g.
   * a combo follow-up pressed early in a long attack stays queued until the
   * attack's cancel point.
   */
  push(action: BufferedAction, time: number, expiresAt = time + this.windowMs): void {
    const last = this.entries[this.entries.length - 1];
    // Collapse duplicates produced by the same physical chord (e.g. Space+S in one frame).
    if (last && last.action === action && time - last.time < 25) return;
    this.entries.push({ action, time, expiresAt: Math.max(expiresAt, time + this.windowMs), seq: this.seq++ });
  }

  expire(now: number): void {
    if (this.entries.length === 0) return;
    this.entries = this.entries.filter((e) => now <= e.expiresAt);
  }

  /** Oldest pending entry for an action. */
  peek(action: BufferedAction): BufferEntry | undefined {
    return this.entries.find((e) => e.action === action);
  }

  /** Remove the entry and everything pressed before it (stale intents). */
  consume(entry: BufferEntry): void {
    this.entries = this.entries.filter((e) => e.seq > entry.seq);
  }

  /** Remove only this entry. */
  drop(entry: BufferEntry): void {
    this.entries = this.entries.filter((e) => e.seq !== entry.seq);
  }

  has(action: BufferedAction): boolean {
    return this.entries.some((e) => e.action === action);
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
