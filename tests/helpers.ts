import { SIM_STEP_MS } from '../src/game/constants';
import { GameWorld } from '../src/game/GameWorld';
import type { WorldOptions } from '../src/game/GameWorld';
import { EMPTY_INPUT } from '../src/game/PlayerController';
import type { InputAction, InputFrame } from '../src/game/PlayerController';
import type { Character } from '../src/game/Character';
import type { EnemyKind } from '../src/game/types';
import type { GameEvent } from '../src/game/events';

export type Held = Partial<Omit<InputFrame, 'pressed'>>;

export function frame(held: Held = {}, pressed: InputAction[] = []): InputFrame {
  return { ...EMPTY_INPUT, ...held, pressed };
}

/** A world in the playing phase with no waves: tests place fighters by hand. */
export function sandbox(opts: WorldOptions = {}): GameWorld {
  const w = new GameWorld({ seed: 1, ...opts });
  w.startSandbox();
  return w;
}

export function placePlayer(w: GameWorld, x: number, y: number, facing: 1 | -1 = 1): Character {
  const p = w.player;
  p.x = x;
  p.y = y;
  p.facing = facing;
  return p;
}

/** Enemy that is not driven by the AI. */
export function spawnPassive(w: GameWorld, kind: EnemyKind, x: number, y: number, facing: 1 | -1 = -1): Character {
  const e = w.spawnEnemy(kind, x, y, { passive: true });
  e.facing = facing;
  return e;
}

/** Feed one simulation step with the given held keys and new presses. */
export function press(w: GameWorld, actions: InputAction[], held: Held = {}): void {
  w.update(SIM_STEP_MS, frame(held, actions));
}

/** Advance simulation time by `ms` (hitstop-aware: loops until sim time moved). */
export function advanceSim(w: GameWorld, ms: number, held: Held = {}): void {
  const target = w.time + ms;
  let guard = 0;
  while (w.time < target - 1e-6 && guard < 100000) {
    w.update(SIM_STEP_MS, frame(held));
    guard += 1;
  }
}

/** Advance until a predicate holds (or fail after maxMs of sim time). */
export function advanceUntil(w: GameWorld, pred: () => boolean, maxMs = 5000, held: Held = {}): boolean {
  const limit = w.time + maxMs;
  let guard = 0;
  while (!pred()) {
    if (w.time > limit || guard > 100000) return false;
    w.update(SIM_STEP_MS, frame(held));
    guard += 1;
  }
  return true;
}

export function eventsOf<T extends GameEvent['type']>(w: GameWorld, type: T): Extract<GameEvent, { type: T }>[] {
  return w.peekEvents().filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);
}
