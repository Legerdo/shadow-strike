import { MIN_GUARD_MS } from './constants';
import { InputBuffer } from './InputBuffer';
import type { BufferEntry, BufferedAction } from './InputBuffer';
import { CharState } from './types';
import type { Character } from './Character';
import type { GameEvent } from './events';

/** Edge-triggered actions coming from the device layer. */
export type InputAction =
  | 'light'
  | 'heavy'
  | 'guard'
  | 'dodge'
  | 'push'
  | 'finisher'
  | 'up'
  | 'down'
  | 'start'
  | 'restart';

/** Device-independent input snapshot for one render frame. */
export interface InputFrame {
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly guard: boolean;
  readonly pressed: readonly InputAction[];
}

export const EMPTY_INPUT: InputFrame = Object.freeze({
  up: false,
  down: false,
  left: false,
  right: false,
  guard: false,
  pressed: Object.freeze([]) as readonly InputAction[],
});

export interface PlayerWorld {
  readonly time: number;
  readonly player: Character;
  startPlayerAttack(kind: 'light' | 'heavy' | 'push', inputDir: number): void;
  findFinisherTarget(): Character | undefined;
  startFinisher(target: Character): void;
  emit(e: GameEvent): void;
}

/** Defensive actions first: they are the time-critical ones. */
const PRIORITY: readonly BufferedAction[] = [
  'finisher',
  'avoidHigh',
  'avoidLow',
  'dodge',
  'guardPress',
  'push',
  'heavy',
  'light',
];

type ExecResult = 'done' | 'wait' | 'drop';

/** Extra time an early combo press survives after the cancel point opens. */
const COMBO_GRACE_MS = 120;

/** Translates buffered input into player FSM transitions. */
export class PlayerController {
  readonly buffer = new InputBuffer();
  held = { up: false, down: false, left: false, right: false, guard: false };
  private readonly world: PlayerWorld;

  constructor(world: PlayerWorld) {
    this.world = world;
  }

  reset(): void {
    this.buffer.clear();
    this.held = { up: false, down: false, left: false, right: false, guard: false };
  }

  /** Record held keys and buffer edge-triggered actions with the current sim time. */
  receive(frame: InputFrame, now: number): void {
    this.held = { up: frame.up, down: frame.down, left: frame.left, right: frame.right, guard: frame.guard };
    for (const a of frame.pressed) {
      switch (a) {
        case 'guard':
          // Space + S = duck under high attacks, Space + W = hop over low attacks.
          if (frame.down && !frame.up) this.buffer.push('avoidHigh', now);
          else if (frame.up && !frame.down) this.buffer.push('avoidLow', now);
          else this.buffer.push('guardPress', now);
          break;
        case 'down':
          if (frame.guard) this.buffer.push('avoidHigh', now);
          break;
        case 'up':
          if (frame.guard) this.buffer.push('avoidLow', now);
          break;
        case 'light':
        case 'heavy':
        case 'push':
          // Combo follow-ups stay queued until the current move reaches its cancel point.
          this.buffer.push(a, now, this.cancelOpensAt(now) + COMBO_GRACE_MS);
          break;
        case 'finisher':
          this.buffer.push(a, now, this.cancelOpensAt(now) + COMBO_GRACE_MS);
          break;
        case 'dodge':
          this.buffer.push(a, now);
          break;
        default:
          break;
      }
    }
  }

  /** Sim time at which the player's current attack can chain into the next one. */
  private cancelOpensAt(now: number): number {
    const p = this.world.player;
    const a = p.attack;
    if (!a) return now;
    const d = a.data;
    let elapsed: number;
    switch (p.state) {
      case CharState.AttackStartup:
        elapsed = p.stateTime;
        break;
      case CharState.AttackActive:
        elapsed = d.startup + p.stateTime;
        break;
      case CharState.AttackRecovery:
        elapsed = d.startup + d.active + p.stateTime;
        break;
      default:
        return now;
    }
    return now + Math.max(0, d.startup + d.active + d.cancelAt - elapsed);
  }

  private get moveX(): number {
    return (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
  }

  private get moveY(): number {
    return (this.held.down ? 1 : 0) - (this.held.up ? 1 : 0);
  }

  update(): void {
    const w = this.world;
    const p = w.player;
    const now = w.time;
    if (!p.alive) return;
    this.buffer.expire(now);

    // Guard release (taps are held for MIN_GUARD_MS so a tap can still parry).
    if (
      p.state === CharState.Guard &&
      !this.held.guard &&
      now >= p.blockstunUntil &&
      now >= p.guardPressedAt + MIN_GUARD_MS
    ) {
      p.releaseGuard();
    }

    for (const action of PRIORITY) {
      const entry = this.buffer.peek(action);
      if (!entry) continue;
      const result = this.tryExecute(action, entry);
      if (result === 'drop') {
        this.buffer.drop(entry);
        continue;
      }
      if (result === 'done') {
        this.buffer.consume(entry);
        break;
      }
    }

    // Holding guard (not a fresh press): guard without a parry window.
    if ((p.state === CharState.Idle || p.state === CharState.Move) && this.held.guard) {
      p.enterGuard(now, false);
    }

    // Free movement. While guard is held, W/S are reserved for avoids, so no walking.
    if (p.state === CharState.Idle || p.state === CharState.Move) {
      const mx = this.moveX;
      const my = this.moveY;
      if (mx !== 0 || my !== 0) {
        p.walk(mx, my);
        if (mx !== 0) p.facing = mx > 0 ? 1 : -1;
      } else {
        p.stopWalk();
      }
    }
  }

  private tryExecute(action: BufferedAction, entry: BufferEntry): ExecResult {
    const w = this.world;
    const p = w.player;
    const now = w.time;
    switch (action) {
      case 'finisher': {
        if (!p.canAct(now)) return 'wait';
        const target = w.findFinisherTarget();
        if (!target) return 'drop';
        w.startFinisher(target);
        return 'done';
      }
      case 'avoidHigh':
      case 'avoidLow': {
        if (!p.canAct(now)) return 'wait';
        const height = action === 'avoidHigh' ? 'high' : 'low';
        p.startAvoid(height);
        w.emit({ type: 'avoidStart', id: p.id, height, x: p.x, y: p.y, h: 0 });
        return 'done';
      }
      case 'dodge': {
        if (!p.canAct(now) || now < p.dodgeCooldownUntil) return 'wait';
        p.startDodge(this.moveX, this.moveY, now);
        w.emit({ type: 'dodge', id: p.id, x: p.x, y: p.y, h: 0 });
        return 'done';
      }
      case 'guardPress': {
        if (!p.canAct(now)) return 'wait';
        p.enterGuard(now, true, true, entry.time);
        return 'done';
      }
      case 'push':
      case 'heavy':
      case 'light': {
        if (!p.canAct(now)) return 'wait';
        w.startPlayerAttack(action, this.moveX);
        return 'done';
      }
      default:
        return 'drop';
    }
  }
}
