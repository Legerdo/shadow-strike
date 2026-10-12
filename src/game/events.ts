import type { AttackHeight, EnemyKind } from './types';

/** Where something happened in world space (h = height above the floor). */
export interface WorldPoint {
  x: number;
  y: number;
  h: number;
}

/**
 * Events emitted by the simulation. The presentation layer (renderer, audio, HUD)
 * consumes them; game rules never depend on them.
 */
export type GameEvent =
  | ({ type: 'hit'; attackerId: number; targetId: number; damage: number; heavy: boolean; counter: boolean; dir: number; tag: HitTag } & WorldPoint)
  | ({ type: 'block'; attackerId: number; targetId: number; dir: number } & WorldPoint)
  | ({ type: 'parry'; attackerId: number; targetId: number; dir: number } & WorldPoint)
  | ({ type: 'avoid'; targetId: number; height: AttackHeight } & WorldPoint)
  | ({ type: 'wrongAvoid'; targetId: number; height: AttackHeight } & WorldPoint)
  | ({ type: 'dodged'; targetId: number } & WorldPoint)
  | ({ type: 'dodge'; id: number } & WorldPoint)
  | ({ type: 'avoidStart'; id: number; height: AttackHeight } & WorldPoint)
  | ({ type: 'guardBreak'; id: number } & WorldPoint)
  | ({ type: 'structureBreak'; id: number } & WorldPoint)
  | ({ type: 'structureRecover'; id: number } & WorldPoint)
  | ({ type: 'attackStart'; id: number; attackId: string; height: AttackHeight; unblockable: boolean; isPlayer: boolean; counter: boolean } & WorldPoint)
  | ({ type: 'whiff'; id: number; heavy: boolean } & WorldPoint)
  | ({ type: 'pushLaunch'; id: number; dir: number } & WorldPoint)
  | ({ type: 'shove'; id: number; dir: number } & WorldPoint)
  | ({ type: 'wallSlam'; id: number; wall: WallSide } & WorldPoint)
  | ({ type: 'bodyCollide'; id: number; otherId: number } & WorldPoint)
  | ({ type: 'knockdown'; id: number } & WorldPoint)
  | ({ type: 'land'; id: number } & WorldPoint)
  | ({ type: 'getUp'; id: number } & WorldPoint)
  | ({ type: 'finisherStart'; attackerId: number; victimId: number } & WorldPoint)
  | ({ type: 'finisherHit'; attackerId: number; victimId: number; index: number; final: boolean } & WorldPoint)
  | ({ type: 'death'; id: number; kind: string } & WorldPoint)
  | { type: 'combo'; count: number }
  | { type: 'waveStart'; wave: number; total: number; kinds: readonly EnemyKind[] }
  | { type: 'waveClear'; wave: number; total: number }
  | { type: 'victory' }
  | { type: 'defeat' }
  | { type: 'reset' }
  | { type: 'start' };

export type WallSide = 'left' | 'right' | 'back' | 'front';
export type HitTag = 'normal' | 'counter' | 'interrupt' | 'wrongAvoid' | 'unblockable' | 'armored' | 'broken';
export type GameEventType = GameEvent['type'];
