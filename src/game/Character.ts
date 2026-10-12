import {
  AVOID_ACTIVE_END_MS,
  AVOID_ACTIVE_START_MS,
  AVOID_DURATION_MS,
  DODGE_COOLDOWN_MS,
  DODGE_DASH_MS,
  DODGE_DEPTH_SCALE,
  DODGE_DISTANCE,
  DODGE_DURATION_MS,
  DODGE_IFRAME_MS,
  FINISHER_DURATION_MS,
  FINISHER_HIT_TIMES,
  GETUP_INVULN_MS,
  KNOCKBACK_DAMPING,
  KNOCKDOWN_FALL_MS,
  KNOCKDOWN_GETUP_MS,
  KNOCKDOWN_LIE_MS,
  PARRY_COUNTER_CANCEL_MS,
  PARRY_REARM_MS,
  PARRY_STATE_MS,
  PARRY_WINDOW_MS,
  PUSH_DAMPING,
  STUN_CHAIN_GAP_MS,
  STUN_CHAIN_LIMIT,
  STUN_DECAY,
  STUN_IMMUNE_MS,
} from './constants';
import { CharState } from './types';
import type { AttackData, AttackHeight, CharacterKind, Team } from './types';
import type { Archetype } from './archetypes';
import type { GameEvent } from './events';

/** One execution of an attack. Each instance can hit a given target only once. */
export interface AttackInstance {
  readonly uid: number;
  readonly data: AttackData;
  readonly hitIds: Set<number>;
  readonly counter: boolean;
  readonly targetId: number;
  readonly startedAt: number;
  lungeLeft: number;
  connected: boolean;
}

/** The subset of the world a character needs while updating its own state. */
export interface CharacterWorld {
  readonly time: number;
  emit(e: GameEvent): void;
  getCharacter(id: number): Character | undefined;
  onFinisherHit(attacker: Character, index: number, final: boolean): void;
}

export type KnockdownPhase = 'fall' | 'down' | 'getup';
export type FinisherRole = 'attacker' | 'victim' | null;

const ATTACK_STATES: ReadonlySet<CharState> = new Set<CharState>([
  CharState.AttackStartup,
  CharState.AttackActive,
  CharState.AttackRecovery,
]);

export class Character {
  readonly id: number;
  readonly arch: Archetype;
  readonly team: Team;

  // ---- spatial (gameplay coordinates, independent from rendering) ----
  x: number;
  y: number;
  /** Height above the floor (knockdown bounce). */
  h = 0;
  /** External velocity: knockback, pushes. */
  vx = 0;
  vy = 0;
  damping = KNOCKBACK_DAMPING;
  /** Voluntary walking velocity (only applied in Move). */
  walkVX = 0;
  walkVY = 0;
  facing: 1 | -1 = 1;

  // ---- resources ----
  health: number;
  structure = 0;

  // ---- FSM ----
  state: CharState = CharState.Idle;
  prevState: CharState = CharState.Idle;
  stateTime = 0;
  stateDuration = 0;
  attack: AttackInstance | null = null;

  // ---- combo bookkeeping ----
  comboChain: 'light' | 'heavy' | null = null;
  comboIndex = -1;
  comboExpireAt = -Infinity;

  // ---- defence ----
  guardPressedAt = -Infinity;
  parryWindowUntil = -Infinity;
  parryLockoutUntil = -Infinity;
  blockstunUntil = -Infinity;
  lastBlockAt = -Infinity;
  lastParryAt = -Infinity;
  avoidSucceeded = false;
  counterUntil = -Infinity;
  invulnerableUntil = -Infinity;
  dodgeCooldownUntil = -Infinity;
  dodgeDirX = 0;
  dodgeDirY = 0;
  private dodgeProgress = 0;

  // ---- stagger control ----
  /** Why the fighter is in HitStun (presentation only). */
  stunKind: 'hit' | 'recoil' | 'stumble' = 'hit';
  stunChain = 0;
  lastStunEnd = -Infinity;
  stunImmuneUntil = -Infinity;

  knockdownPhase: KnockdownPhase = 'fall';
  knockdownLie = KNOCKDOWN_LIE_MS;
  pushedByCollision = false;

  lastStructureGainAt = -Infinity;
  brokenAt = -Infinity;

  finisherRole: FinisherRole = null;
  finisherPartnerId = -1;
  finisherHits = 0;

  // ---- presentation helpers (read by the renderer, never by rules) ----
  hitFlashUntil = -Infinity;
  lastHitAt = -Infinity;
  lastHitHeight: AttackHeight = 'mid';
  lastHitHeavy = false;
  walkDistance = 0;
  deathAt = -Infinity;
  spawnedAt = 0;

  constructor(id: number, arch: Archetype, team: Team, x: number, y: number) {
    this.id = id;
    this.arch = arch;
    this.team = team;
    this.x = x;
    this.y = y;
    this.health = arch.maxHealth;
  }

  get kind(): CharacterKind {
    return this.arch.kind;
  }
  get radius(): number {
    return this.arch.bodyRadius;
  }
  get mass(): number {
    return this.arch.mass;
  }
  get maxHealth(): number {
    return this.arch.maxHealth;
  }
  get maxStructure(): number {
    return this.arch.maxStructure;
  }
  get alive(): boolean {
    return this.state !== CharState.Dead;
  }
  get isAttacking(): boolean {
    return ATTACK_STATES.has(this.state);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /** Can the fighter start a new action right now? */
  canAct(now: number): boolean {
    switch (this.state) {
      case CharState.Idle:
      case CharState.Move:
        return true;
      case CharState.Guard:
        return now >= this.blockstunUntil;
      case CharState.AttackRecovery:
        return this.attack !== null && this.stateTime >= this.attack.data.cancelAt;
      case CharState.Parry:
        return this.stateTime >= PARRY_COUNTER_CANCEL_MS;
      case CharState.AvoidHigh:
      case CharState.AvoidLow:
        return this.avoidSucceeded || this.stateTime >= AVOID_DURATION_MS - 50;
      case CharState.Dodge:
        return this.stateTime >= DODGE_DURATION_MS - 60;
      default:
        return false;
    }
  }

  isTargetable(): boolean {
    switch (this.state) {
      case CharState.Dead:
      case CharState.Knockdown:
      case CharState.Finisher:
      case CharState.Pushed:
        return false;
      default:
        return true;
    }
  }

  /** Participates in body-blocking. */
  isSolid(): boolean {
    switch (this.state) {
      case CharState.Dead:
      case CharState.Knockdown:
      case CharState.Finisher:
      case CharState.Pushed:
        return false;
      default:
        return true;
    }
  }

  isInvulnerable(now: number): boolean {
    return now < this.invulnerableUntil;
  }

  isGuarding(): boolean {
    return this.state === CharState.Guard || this.state === CharState.Parry;
  }

  isParryWindow(now: number): boolean {
    return this.isGuarding() && now <= this.parryWindowUntil;
  }

  isAvoidActive(): boolean {
    return (
      (this.state === CharState.AvoidHigh || this.state === CharState.AvoidLow) &&
      this.stateTime >= AVOID_ACTIVE_START_MS &&
      this.stateTime <= AVOID_ACTIVE_END_MS
    );
  }

  /** Which attack height the current avoid evades ('high' = ducking, 'low' = hopping). */
  avoidHeight(): AttackHeight | null {
    if (this.state === CharState.AvoidHigh) return 'high';
    if (this.state === CharState.AvoidLow) return 'low';
    return null;
  }

  // ---------------------------------------------------------------------------
  // State changes
  // ---------------------------------------------------------------------------

  setState(next: CharState, duration = 0, carry = 0): void {
    this.prevState = this.state;
    this.state = next;
    this.stateTime = carry;
    this.stateDuration = duration;
    if (next !== CharState.Move) {
      this.walkVX = 0;
      this.walkVY = 0;
    }
    if (!ATTACK_STATES.has(next)) this.attack = null;
    if (next !== CharState.AvoidHigh && next !== CharState.AvoidLow) this.avoidSucceeded = false;
    if (next !== CharState.Knockdown) this.h = 0;
    if (next !== CharState.Finisher) {
      this.finisherRole = null;
      this.finisherPartnerId = -1;
    }
  }

  walk(dirX: number, dirY: number, mult = 1): void {
    if (this.state !== CharState.Idle && this.state !== CharState.Move) return;
    const len = Math.hypot(dirX, dirY);
    if (len < 1e-6) {
      this.stopWalk();
      return;
    }
    if (this.state !== CharState.Move) this.setState(CharState.Move);
    this.walkVX = (dirX / len) * this.arch.speedX * mult;
    this.walkVY = (dirY / len) * this.arch.speedY * mult;
  }

  stopWalk(): void {
    if (this.state === CharState.Move) this.setState(CharState.Idle);
    this.walkVX = 0;
    this.walkVY = 0;
  }

  startAttack(data: AttackData, uid: number, now: number, counter: boolean, targetId: number): AttackInstance {
    this.setState(CharState.AttackStartup);
    const inst: AttackInstance = {
      uid,
      data,
      hitIds: new Set<number>(),
      counter,
      targetId,
      startedAt: now,
      lungeLeft: data.lunge,
      connected: false,
    };
    this.attack = inst;
    return inst;
  }

  /**
   * Raise guard. `fresh` means the guard button was just pressed: only a fresh
   * press opens the parry window, and presses closer together than
   * PARRY_REARM_MS never get one (anti-mash).
   */
  enterGuard(now: number, fresh: boolean, parryAllowed = true, pressTime = now): void {
    if (this.state !== CharState.Guard) this.setState(CharState.Guard);
    if (!fresh) return;
    const t = Math.min(pressTime, now);
    this.guardPressedAt = t;
    if (parryAllowed && t >= this.parryLockoutUntil) this.parryWindowUntil = t + PARRY_WINDOW_MS;
    else this.parryWindowUntil = -Infinity;
    this.parryLockoutUntil = t + PARRY_REARM_MS;
  }

  releaseGuard(): void {
    if (this.state === CharState.Guard) this.setState(CharState.Idle);
  }

  onParrySuccess(now: number): void {
    this.setState(CharState.Parry, PARRY_STATE_MS);
    this.lastParryAt = now;
    // A successful deflect re-arms immediately so multi-hit strings can be chained.
    this.parryLockoutUntil = now;
    this.parryWindowUntil = Math.max(this.parryWindowUntil, now + 60);
  }

  startAvoid(height: 'high' | 'low'): void {
    this.setState(height === 'high' ? CharState.AvoidHigh : CharState.AvoidLow, AVOID_DURATION_MS);
    this.avoidSucceeded = false;
  }

  startDodge(dirX: number, dirY: number, now: number): void {
    let len = Math.hypot(dirX, dirY);
    if (len < 1e-6) {
      dirX = -this.facing;
      dirY = 0;
      len = 1;
    }
    this.dodgeDirX = dirX / len;
    this.dodgeDirY = dirY / len;
    this.dodgeProgress = 0;
    this.setState(CharState.Dodge, DODGE_DURATION_MS);
    this.invulnerableUntil = Math.max(this.invulnerableUntil, now + DODGE_IFRAME_MS);
  }

  /**
   * Apply hit stun with diminishing returns. After STUN_CHAIN_LIMIT consecutive
   * staggers the fighter becomes briefly stagger-immune (no infinite combos).
   * Returns the applied duration (0 = not staggered).
   */
  applyHitStun(duration: number, now: number): number {
    if (now < this.stunImmuneUntil) return 0;
    if (now > this.lastStunEnd + STUN_CHAIN_GAP_MS) this.stunChain = 0;
    this.stunChain += 1;
    if (this.stunChain > STUN_CHAIN_LIMIT) {
      this.stunChain = 0;
      this.stunImmuneUntil = now + STUN_IMMUNE_MS;
      return 0;
    }
    const d = duration * Math.pow(STUN_DECAY, this.stunChain - 1);
    this.setState(CharState.HitStun, d);
    this.stunKind = 'hit';
    this.lastStunEnd = now + d;
    return d;
  }

  /** Stagger that ignores the chain counter (parry recoil, push stumble). */
  recoil(duration: number, now: number, kind: 'recoil' | 'stumble' = 'recoil'): void {
    this.setState(CharState.HitStun, duration);
    this.stunKind = kind;
    this.lastStunEnd = now + duration;
  }

  knockdown(now: number, lieMs = KNOCKDOWN_LIE_MS): void {
    this.setState(CharState.Knockdown, KNOCKDOWN_FALL_MS + lieMs + KNOCKDOWN_GETUP_MS);
    this.knockdownPhase = 'fall';
    this.knockdownLie = lieMs;
    this.stunChain = 0;
    this.lastStunEnd = now;
  }

  breakStructure(now: number): void {
    this.structure = this.maxStructure;
    this.brokenAt = now;
    this.stunChain = 0;
    this.vx *= 0.3;
    this.vy *= 0.3;
    this.setState(CharState.StructureBreak, this.arch.breakDuration);
  }

  startPushed(vx: number, vy: number, byCollision: boolean): void {
    this.setState(CharState.Pushed);
    this.vx = vx;
    this.vy = vy;
    this.damping = PUSH_DAMPING;
    this.pushedByCollision = byCollision;
  }

  /** Returns true when the structure gauge is now full. */
  addStructure(amount: number, now: number): boolean {
    if (amount > 0) {
      this.structure = Math.min(this.maxStructure, this.structure + amount);
      this.lastStructureGainAt = now;
    }
    return this.structure >= this.maxStructure - 1e-6;
  }

  die(now: number): void {
    this.health = 0;
    this.deathAt = now;
    this.damping = 5;
    this.setState(CharState.Dead);
  }

  // ---------------------------------------------------------------------------
  // Per-step update (timers and FSM transitions only; physics lives elsewhere)
  // ---------------------------------------------------------------------------

  update(dt: number, w: CharacterWorld): void {
    const now = w.time;
    this.stateTime += dt;

    switch (this.state) {
      case CharState.AttackStartup:
        this.updateStartup(dt, w);
        break;
      case CharState.AttackActive: {
        const a = this.attack;
        if (!a) {
          this.setState(CharState.Idle);
          break;
        }
        if (this.stateTime >= a.data.active) {
          if (!a.connected) {
            w.emit({ type: 'whiff', id: this.id, heavy: a.data.hitstop >= 90, x: this.x, y: this.y, h: 90 });
          }
          this.setState(CharState.AttackRecovery, 0, this.stateTime - a.data.active);
        }
        break;
      }
      case CharState.AttackRecovery: {
        const a = this.attack;
        if (!a || this.stateTime >= a.data.recovery) this.setState(CharState.Idle);
        break;
      }
      case CharState.Parry:
        if (this.stateTime >= PARRY_STATE_MS) this.setState(CharState.Idle);
        break;
      case CharState.AvoidHigh:
      case CharState.AvoidLow:
        if (this.stateTime >= AVOID_DURATION_MS) this.setState(CharState.Idle);
        break;
      case CharState.Dodge:
        this.updateDodge(now);
        break;
      case CharState.HitStun:
        if (this.stateTime >= this.stateDuration) this.setState(CharState.Idle);
        break;
      case CharState.Knockdown:
        this.updateKnockdown(now, w);
        break;
      case CharState.StructureBreak:
        if (this.stateTime >= this.stateDuration) {
          this.structure = this.maxStructure * this.arch.breakResetRatio;
          this.lastStructureGainAt = now;
          this.setState(CharState.Idle);
          w.emit({ type: 'structureRecover', id: this.id, x: this.x, y: this.y, h: 0 });
        }
        break;
      case CharState.Finisher:
        if (this.finisherRole === 'attacker') this.updateFinisher(now, w);
        break;
      default:
        break;
    }

    this.regenStructure(dt, now);
  }

  private updateStartup(dt: number, w: CharacterWorld): void {
    const a = this.attack;
    if (!a) {
      this.setState(CharState.Idle);
      return;
    }
    const d = a.data;
    const target = a.targetId >= 0 ? w.getCharacter(a.targetId) : undefined;
    const trackTarget = target !== undefined && target.alive;

    if (a.lungeLeft > 0) {
      let step = Math.min(a.lungeLeft, (d.lunge * dt) / Math.max(1, d.startup));
      if (trackTarget) {
        const gap = (target.x - this.x) * this.facing - target.radius;
        if (gap < d.reach * 0.55) step = 0;
      }
      this.x += this.facing * step;
      a.lungeLeft -= step;
    }

    // Depth assist: only when the target is already roughly in the same lane.
    if (trackTarget && this.stateTime <= d.startup * this.arch.magnetPortion) {
      const dy = target.y - this.y;
      if (Math.abs(dy) <= d.depth * 2.2) {
        const m = Math.min(Math.abs(dy), (this.arch.magnetSpeed * dt) / 1000);
        this.y += Math.sign(dy) * m;
      }
    }

    if (this.stateTime >= d.startup) this.setState(CharState.AttackActive, 0, this.stateTime - d.startup);
  }

  private updateDodge(now: number): void {
    const u = Math.min(1, this.stateTime / DODGE_DASH_MS);
    const eased = 1 - (1 - u) * (1 - u);
    const delta = (eased - this.dodgeProgress) * DODGE_DISTANCE;
    this.dodgeProgress = eased;
    this.x += this.dodgeDirX * delta;
    this.y += this.dodgeDirY * delta * DODGE_DEPTH_SCALE;
    if (this.stateTime >= DODGE_DURATION_MS) {
      this.dodgeCooldownUntil = now + DODGE_COOLDOWN_MS;
      this.setState(CharState.Idle);
    }
  }

  private updateKnockdown(now: number, w: CharacterWorld): void {
    const t = this.stateTime;
    const fall = KNOCKDOWN_FALL_MS;
    const lie = this.knockdownLie;
    if (t < fall) {
      this.knockdownPhase = 'fall';
      const u = t / fall;
      this.h = Math.sin(Math.PI * u) * 22 * (1 - u * 0.5);
    } else if (t < fall + lie) {
      if (this.knockdownPhase !== 'down') {
        this.knockdownPhase = 'down';
        this.h = 0;
        w.emit({ type: 'land', id: this.id, x: this.x, y: this.y, h: 0 });
      }
    } else if (t < fall + lie + KNOCKDOWN_GETUP_MS) {
      if (this.knockdownPhase !== 'getup') {
        this.knockdownPhase = 'getup';
        w.emit({ type: 'getUp', id: this.id, x: this.x, y: this.y, h: 0 });
      }
    } else {
      this.setState(CharState.Idle);
      this.invulnerableUntil = Math.max(this.invulnerableUntil, now + GETUP_INVULN_MS);
    }
  }

  private updateFinisher(now: number, w: CharacterWorld): void {
    while (this.finisherHits < FINISHER_HIT_TIMES.length && this.stateTime >= FINISHER_HIT_TIMES[this.finisherHits]) {
      const index = this.finisherHits;
      this.finisherHits += 1;
      w.onFinisherHit(this, index, index === FINISHER_HIT_TIMES.length - 1);
    }
    if (this.stateTime >= FINISHER_DURATION_MS) {
      this.setState(CharState.Idle);
      this.invulnerableUntil = Math.max(this.invulnerableUntil, now + 300);
    }
  }

  private regenStructure(dt: number, now: number): void {
    if (this.structure <= 0) return;
    if (this.state === CharState.StructureBreak || this.state === CharState.Dead) return;
    if (now - this.lastStructureGainAt < this.arch.structureRegenDelay) return;
    this.structure = Math.max(0, this.structure - (this.arch.structureRegenRate * dt) / 1000);
  }
}
