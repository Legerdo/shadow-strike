import { ARENA_DEPTH, ARENA_WIDTH, PARRY_COUNTER_CANCEL_MS } from './constants';
import { CharState } from './types';
import type { AttackData } from './types';
import type { Character } from './Character';
import type { AttackTokens } from './AttackTokens';
import type { Rng } from './rng';
import type { GameEvent } from './events';

/** States in which the enemy has lost control and must drop its plan. */
const DISABLED: ReadonlySet<CharState> = new Set<CharState>([
  CharState.HitStun,
  CharState.Pushed,
  CharState.Knockdown,
  CharState.StructureBreak,
  CharState.Finisher,
  CharState.Dead,
]);

export type BrainMode = 'enter' | 'hover' | 'engage' | 'retreat' | 'recover';

/** Per-enemy decision state (separate from the character FSM). */
export class EnemyBrain {
  mode: BrainMode = 'enter';
  modeTime = 0;
  thinkDelay = 0;
  attackCooldown = 0;
  plan: readonly AttackData[] = [];
  planStep = 0;
  side: 1 | -1 = 1;
  depthOffset = 0;
  hoverDist = 220;
  strafePhase = 0;
  retreatTime = 400;
  reaction: 'guard' | 'dodge' | null = null;
  reactionTimer = 0;
  seenAttackUid = -1;
  guardTimer = 0;
  blockedHits = 0;
  lastBlockSeen = -Infinity;
  lastDisabled: CharState | null = null;
}

export interface AIWorld {
  readonly time: number;
  readonly player: Character;
  readonly enemies: readonly Character[];
  readonly tokens: AttackTokens;
  readonly finisherActive: boolean;
  readonly rng: Rng;
  enemyStartAttack(e: Character, data: AttackData): void;
  emit(e: GameEvent): void;
}

const ENGAGE_TIMEOUT_MS = 3600;
const ENGAGE_RANGE = 560;

export class EnemyAI {
  private readonly brains = new Map<number, EnemyBrain>();
  private readonly w: AIWorld;

  constructor(world: AIWorld) {
    this.w = world;
  }

  register(e: Character, thinkDelay: number): EnemyBrain {
    const w = this.w;
    const b = new EnemyBrain();
    b.thinkDelay = thinkDelay;
    b.attackCooldown = thinkDelay + w.rng.range(200, 900);
    b.side = e.x >= w.player.x ? 1 : -1;
    const slot = this.brains.size;
    const offsets = [-62, 62, 0, -100, 100];
    b.depthOffset = offsets[slot % offsets.length] + w.rng.range(-14, 14);
    b.hoverDist = w.rng.rangeOf(e.arch.hoverDistance);
    b.strafePhase = w.rng.range(0, Math.PI * 2);
    this.brains.set(e.id, b);
    return b;
  }

  unregister(id: number): void {
    this.brains.delete(id);
    this.w.tokens.release(id);
  }

  clear(): void {
    this.brains.clear();
  }

  brainOf(id: number): EnemyBrain | undefined {
    return this.brains.get(id);
  }

  update(dt: number): void {
    for (const e of this.w.enemies) {
      const b = this.brains.get(e.id);
      if (b) this.think(e, b, dt);
    }
  }

  /** Used outside of active play: everyone stands down. */
  standDown(): void {
    for (const e of this.w.enemies) {
      this.w.tokens.release(e.id);
      if (e.state === CharState.Move) e.stopWalk();
      if (e.state === CharState.Guard) e.releaseGuard();
    }
  }

  private think(e: Character, b: EnemyBrain, dt: number): void {
    const w = this.w;
    const p = w.player;
    const now = w.time;
    b.modeTime += dt;
    b.thinkDelay -= dt;
    b.attackCooldown -= dt;

    if (!e.alive) {
      w.tokens.release(e.id);
      return;
    }

    if (DISABLED.has(e.state)) {
      b.lastDisabled = e.state;
      w.tokens.release(e.id);
      b.plan = [];
      b.planStep = 0;
      b.reaction = null;
      b.mode = 'recover';
      b.modeTime = 0;
      b.attackCooldown = Math.max(b.attackCooldown, 550);
      return;
    }

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const toward: 1 | -1 = dx >= 0 ? 1 : -1;
    if (Math.abs(dx) > 40) b.side = e.x >= p.x ? 1 : -1;

    if (!p.alive) {
      w.tokens.release(e.id);
      if (e.state === CharState.Move) e.stopWalk();
      if (e.state === CharState.Guard) e.releaseGuard();
      return;
    }

    this.perceive(e, b);
    if (b.reaction) {
      b.reactionTimer -= dt;
      if (b.reactionTimer <= 0) this.react(e, b);
    }

    switch (e.state) {
      case CharState.AttackStartup:
      case CharState.AttackActive:
        return;
      case CharState.AttackRecovery: {
        const a = e.attack;
        if (a && b.planStep < b.plan.length && e.stateTime >= a.data.cancelAt) {
          if (Math.abs(dx) < 200 && Math.abs(dy) < 70 && p.isTargetable()) {
            e.facing = toward;
            w.enemyStartAttack(e, b.plan[b.planStep]);
            b.planStep += 1;
          } else {
            b.planStep = b.plan.length; // abort the rest of the string
          }
        }
        return;
      }
      case CharState.Guard: {
        if (e.lastBlockAt > b.lastBlockSeen) {
          b.lastBlockSeen = e.lastBlockAt;
          b.blockedHits += 1;
          b.guardTimer = Math.max(b.guardTimer, 260);
        }
        b.guardTimer -= dt;
        const counterReady = b.blockedHits >= 2 && now >= e.blockstunUntil;
        if (b.guardTimer <= 0 || counterReady) {
          e.releaseGuard();
          if (b.blockedHits > 0 && !w.finisherActive && w.tokens.request(e.id)) this.beginEngage(e, b, true);
          b.blockedHits = 0;
        }
        return;
      }
      case CharState.Parry: {
        if (e.stateTime >= PARRY_COUNTER_CANCEL_MS && !w.finisherActive && w.tokens.request(e.id)) {
          e.setState(CharState.Idle);
          this.beginEngage(e, b, true);
        }
        return;
      }
      case CharState.Dodge:
      case CharState.AvoidHigh:
      case CharState.AvoidLow:
        return;
      default:
        break;
    }

    // ---- Idle / Move: high level decisions ----
    if (b.mode === 'engage' && b.plan.length > 0 && b.planStep >= b.plan.length) this.finishPlan(e, b);
    if (b.mode === 'recover') {
      // Recovering from a stagger: don't stand there to be juggled. Guard up, or slip away.
      const wasStunned = b.lastDisabled === CharState.HitStun;
      b.lastDisabled = null;
      // Combo breaker: when stagger-immune, hit back immediately with the fastest string.
      if (wasStunned && now < e.stunImmuneUntil && !w.finisherActive && w.tokens.request(e.id)) {
        this.beginEngage(e, b, true);
        return;
      }
      if (wasStunned) {
        const A = e.arch;
        if (A.dodgeChance > 0 && w.rng.chance(A.dodgeChance + 0.2)) {
          const away = e.x >= p.x ? 1 : -1;
          e.startDodge(away, w.rng.chance(0.5) ? -0.7 : 0.7, now);
          w.emit({ type: 'dodge', id: e.id, x: e.x, y: e.y, h: 0 });
          b.mode = 'hover';
          b.modeTime = 0;
          return;
        }
        if (w.rng.chance(A.recoverGuardChance)) {
          e.enterGuard(now, true, w.rng.chance(A.parryChance + 0.15));
          b.guardTimer = w.rng.range(500, 900);
          b.blockedHits = 0;
          b.lastBlockSeen = e.lastBlockAt;
          b.mode = 'hover';
          b.modeTime = 0;
          return;
        }
      }
      b.mode = 'retreat';
      b.modeTime = 0;
      b.retreatTime = w.rng.range(250, 520);
    }
    if (b.mode === 'enter' && b.thinkDelay <= 0) b.mode = 'hover';

    if (Math.abs(dx) > 4) e.facing = toward;

    const playerOpen = p.isTargetable() && !w.finisherActive;
    if (b.mode === 'hover' && b.attackCooldown <= 0 && playerOpen && Math.hypot(dx, dy) < ENGAGE_RANGE) {
      if (w.tokens.request(e.id)) this.beginEngage(e, b, false);
      else b.attackCooldown = w.rng.range(250, 500);
    }

    switch (b.mode) {
      case 'enter':
        this.moveToSlot(e, b, dt, 0.9);
        break;
      case 'hover':
        this.moveToSlot(e, b, dt, 1);
        break;
      case 'retreat': {
        const away = e.x >= p.x ? 1 : -1;
        this.moveToward(e, e.x + away * 90, e.y + (b.depthOffset > 0 ? 20 : -20), 0.8);
        if (b.modeTime >= b.retreatTime) {
          b.mode = 'hover';
          b.modeTime = 0;
        }
        break;
      }
      case 'engage':
        this.engage(e, b, playerOpen);
        break;
      default:
        break;
    }
  }

  private beginEngage(e: Character, b: EnemyBrain, counter: boolean): void {
    b.mode = 'engage';
    b.modeTime = 0;
    b.planStep = 0;
    const plans = e.arch.plans;
    const chosen = counter ? plans[0] : this.w.rng.weighted(plans);
    b.plan = chosen ? chosen.attacks : [];
    if (b.plan.length === 0) this.finishPlan(e, b);
  }

  private finishPlan(e: Character, b: EnemyBrain): void {
    const w = this.w;
    w.tokens.release(e.id);
    b.plan = [];
    b.planStep = 0;
    b.mode = 'retreat';
    b.modeTime = 0;
    b.retreatTime = w.rng.range(300, 650);
    b.attackCooldown = w.rng.rangeOf(e.arch.attackCooldown);
    b.hoverDist = w.rng.rangeOf(e.arch.hoverDistance);
  }

  private engage(e: Character, b: EnemyBrain, playerOpen: boolean): void {
    const w = this.w;
    const p = w.player;
    const first = b.plan[b.planStep];
    if (!first) {
      this.finishPlan(e, b);
      return;
    }
    if (b.modeTime > ENGAGE_TIMEOUT_MS) {
      this.finishPlan(e, b);
      b.attackCooldown = 700;
      return;
    }
    const side = e.x >= p.x ? 1 : -1;
    const gap = Math.abs(p.x - e.x) - p.radius;
    const depthGap = Math.abs(p.y - e.y);
    if (playerOpen && gap <= first.reach - 6 && depthGap <= first.depth * 0.45) {
      e.facing = p.x >= e.x ? 1 : -1;
      w.enemyStartAttack(e, first);
      b.planStep += 1;
      return;
    }
    const want = Math.max(p.radius + e.radius - 4, first.reach + p.radius - 18);
    const tx = clampX(p.x + side * want, e.radius);
    this.moveToward(e, tx, p.y, e.arch.engageSpeedMult);
  }

  private moveToSlot(e: Character, b: EnemyBrain, dt: number, mult: number): void {
    const p = this.w.player;
    b.strafePhase += dt * 0.0011;
    const tx = clampX(p.x + b.side * b.hoverDist, e.radius);
    let ty = p.y + b.depthOffset + Math.sin(b.strafePhase) * 26;
    ty = Math.max(12, Math.min(ARENA_DEPTH - 12, ty));
    this.moveToward(e, tx, ty, mult);
  }

  /** Steering with simple separation so the crowd does not stack. Returns distance left. */
  private moveToward(e: Character, tx: number, ty: number, mult: number): number {
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.hypot(dx, dy);
    let rx = 0;
    let ry = 0;
    for (const o of this.w.enemies) {
      if (o === e || !o.alive) continue;
      const ox = e.x - o.x;
      const oy = (e.y - o.y) * 1.6;
      const d = Math.hypot(ox, oy);
      if (d < 78 && d > 1e-3) {
        const f = (78 - d) / 78;
        rx += (ox / d) * f;
        ry += (oy / d) * f;
      }
    }
    const repel = Math.hypot(rx, ry);
    if (dist < 8 && repel < 0.25) {
      e.stopWalk();
      return dist;
    }
    let mx = dist > 1e-6 ? dx / dist : 0;
    let my = dist > 1e-6 ? dy / dist : 0;
    mx += rx * 0.9;
    my += ry * 0.9;
    const slow = dist < 60 ? Math.max(0.35, dist / 60) : 1;
    e.walk(mx, my, mult * slow);
    return dist;
  }

  /** Notice a new player attack aimed at this enemy and schedule a (delayed) reaction. */
  private perceive(e: Character, b: EnemyBrain): void {
    const w = this.w;
    const p = w.player;
    const pa = p.attack;
    if (!pa || p.state !== CharState.AttackStartup || pa.uid === b.seenAttackUid) return;
    b.seenAttackUid = pa.uid;
    if (!(e.state === CharState.Idle || e.state === CharState.Move || e.state === CharState.Guard)) return;
    const forward = (e.x - p.x) * p.facing;
    if (forward < -10 || forward > pa.data.reach + 110 || Math.abs(e.y - p.y) > pa.data.depth + 34) return;

    const A = e.arch;
    const now = w.time;
    let reaction: 'guard' | 'dodge' | null = null;
    let delay = w.rng.rangeOf(A.reactionMs);
    if (now < e.stunImmuneUntil) {
      // Just escaped a long combo: snap the guard up.
      reaction = 'guard';
      delay = w.rng.range(40, 90);
    } else {
      const r = w.rng.next();
      if (r < A.dodgeChance) reaction = 'dodge';
      else if (r < A.dodgeChance + A.guardChance) reaction = 'guard';
    }
    if (!reaction) return;
    b.reaction = reaction;
    b.reactionTimer = delay;
  }

  private react(e: Character, b: EnemyBrain): void {
    const w = this.w;
    const reaction = b.reaction;
    b.reaction = null;
    if (!(e.state === CharState.Idle || e.state === CharState.Move || e.state === CharState.Guard)) return;
    const now = w.time;
    if (reaction === 'guard') {
      const parry = w.rng.chance(e.arch.parryChance);
      e.enterGuard(now, true, parry);
      b.guardTimer = w.rng.range(420, 760);
      b.blockedHits = 0;
      b.lastBlockSeen = e.lastBlockAt;
    } else if (reaction === 'dodge') {
      const away = e.x >= w.player.x ? 1 : -1;
      const side = w.rng.chance(0.5) ? -0.7 : 0.7;
      e.startDodge(away, side, now);
      w.emit({ type: 'dodge', id: e.id, x: e.x, y: e.y, h: 0 });
    }
  }
}

function clampX(x: number, r: number): number {
  return Math.max(r + 12, Math.min(ARENA_WIDTH - r - 12, x));
}
