import {
  ARENA_DEPTH,
  ARENA_WIDTH,
  COLLIDE_DEPTH,
  PUSH_MIN_SPEED,
  SEPARATION_DEPTH,
  WALL_SLAM_MIN_SPEED,
} from './constants';
import { CharState } from './types';
import type { Character } from './Character';
import type { WallSide } from './events';

export interface PhysicsWorld {
  endPush(c: Character): void;
  onWallSlam(c: Character, wall: WallSide, impact: number): void;
  onBodyCollision(mover: Character, other: Character, speed: number): void;
}

/**
 * Movement integration on gameplay coordinates: walking, damped external
 * velocity, arena bounds, push collisions and soft body separation.
 */
export class Physics {
  private readonly w: PhysicsWorld;

  constructor(world: PhysicsWorld) {
    this.w = world;
  }

  step(dt: number, chars: readonly Character[]): void {
    const s = dt / 1000;
    for (const c of chars) {
      if (c.state === CharState.Move) {
        const mx = c.walkVX * s;
        const my = c.walkVY * s;
        c.x += mx;
        c.y += my;
        c.walkDistance += Math.hypot(mx, my);
      }
      if (c.vx !== 0 || c.vy !== 0) {
        c.x += c.vx * s;
        c.y += c.vy * s;
        const k = Math.exp(-c.damping * s);
        c.vx *= k;
        c.vy *= k;
        if (Math.abs(c.vx) < 4) c.vx = 0;
        if (Math.abs(c.vy) < 4) c.vy = 0;
      }
      this.applyBounds(c);
      if (c.state === CharState.Pushed && Math.hypot(c.vx, c.vy) < PUSH_MIN_SPEED) this.w.endPush(c);
    }
    this.pushCollisions(chars);
    this.separate(chars);
    for (const c of chars) clampToArena(c);
  }

  private applyBounds(c: Character): void {
    const r = c.radius;
    let wall: WallSide | null = null;
    let impact = 0;
    if (c.x < r) {
      impact = -c.vx;
      c.x = r;
      wall = 'left';
    } else if (c.x > ARENA_WIDTH - r) {
      impact = c.vx;
      c.x = ARENA_WIDTH - r;
      wall = 'right';
    }
    if (c.y < 0) {
      if (!wall || -c.vy > impact) {
        impact = -c.vy;
        wall = 'back';
      }
      c.y = 0;
    } else if (c.y > ARENA_DEPTH) {
      c.y = ARENA_DEPTH;
      if (c.vy > 0) c.vy = 0;
    }
    if (!wall) return;
    if (c.state === CharState.Pushed && impact >= WALL_SLAM_MIN_SPEED) {
      this.w.onWallSlam(c, wall, impact);
      return;
    }
    if (wall === 'left' && c.vx < 0) c.vx = 0;
    if (wall === 'right' && c.vx > 0) c.vx = 0;
    if (wall === 'back' && c.vy < 0) c.vy = 0;
  }

  /** A pushed body that runs into a team-mate bowls it over. */
  private pushCollisions(chars: readonly Character[]): void {
    for (const c of chars) {
      if (c.state !== CharState.Pushed) continue;
      const speed = Math.abs(c.vx);
      const dir = Math.sign(c.vx);
      if (dir === 0) continue;
      for (const o of chars) {
        if (o === c || o.team !== c.team || !o.isSolid()) continue;
        const dx = o.x - c.x;
        if (Math.abs(o.y - c.y) > COLLIDE_DEPTH) continue;
        if (Math.abs(dx) > c.radius + o.radius) continue;
        if (Math.sign(dx) !== dir && Math.abs(dx) > 2) continue;
        this.w.onBodyCollision(c, o, speed);
        break;
      }
    }
  }

  /** Soft, mass-weighted body blocking for fighters that share a depth lane. */
  private separate(chars: readonly Character[]): void {
    for (let i = 0; i < chars.length; i++) {
      const a = chars[i];
      if (!a.isSolid()) continue;
      for (let j = i + 1; j < chars.length; j++) {
        const b = chars[j];
        if (!b.isSolid()) continue;
        const dy = b.y - a.y;
        if (Math.abs(dy) >= SEPARATION_DEPTH) continue;
        const dx = b.x - a.x;
        const minD = (a.radius + b.radius) * 0.9;
        if (Math.abs(dx) >= minD) continue;
        const overlap = minD - Math.abs(dx);
        const dir = dx === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dx);
        const total = a.mass + b.mass;
        a.x -= dir * overlap * (b.mass / total);
        b.x += dir * overlap * (a.mass / total);
        // Tiny depth nudge so fighters never stack perfectly.
        const ydir = dy === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(dy);
        const yPush = (SEPARATION_DEPTH - Math.abs(dy)) * 0.04;
        a.y -= ydir * yPush * (b.mass / total);
        b.y += ydir * yPush * (a.mass / total);
      }
    }
  }
}

export function clampToArena(c: Character): void {
  const r = c.radius;
  if (c.x < r) c.x = r;
  if (c.x > ARENA_WIDTH - r) c.x = ARENA_WIDTH - r;
  if (c.y < 0) c.y = 0;
  if (c.y > ARENA_DEPTH) c.y = ARENA_DEPTH;
}
