import {
  ARENA_DEPTH,
  ARENA_WIDTH,
  COLLIDE_DAMAGE,
  COLLIDE_STRUCTURE,
  COMBO_LINK_MS,
  COMBO_TIMEOUT_MS,
  FINISHER_HEAL,
  FINISHER_RANGE_X,
  FINISHER_RANGE_Y,
  FINISHER_SPACING,
  HITSTOP_MAX_MS,
  KNOCKBACK_DAMPING,
  KNOCKDOWN_LIE_MS,
  MAX_FRAME_MS,
  PUSH_MIN_SPEED,
  PUSH_STUMBLE_MS,
  SHORT_KNOCKDOWN_LIE_MS,
  SIM_STEP_MS,
  WALL_SLAM_DAMAGE,
  WALL_SLAM_STRUCTURE,
  WAVE_HEAL,
} from './constants';
import { ARCHETYPES } from './archetypes';
import { HEAVY_CHAIN, LIGHT_CHAIN, PLAYER_ATTACKS } from './attacks';
import { AttackTokens } from './AttackTokens';
import { Character } from './Character';
import type { CharacterWorld } from './Character';
import { CombatSystem } from './CombatSystem';
import type { CombatContext, HitOutcome } from './CombatSystem';
import { EnemyAI } from './EnemyAI';
import type { AIWorld } from './EnemyAI';
import type { GameEvent, WallSide } from './events';
import { Physics } from './Physics';
import type { PhysicsWorld } from './Physics';
import { PlayerController } from './PlayerController';
import type { InputFrame, PlayerWorld } from './PlayerController';
import { Rng } from './rng';
import { CharState } from './types';
import type { AttackData, EnemyKind } from './types';
import { DEFAULT_WAVES, WaveManager } from './WaveManager';
import type { WaveWorld } from './WaveManager';

export type WorldPhase = 'ready' | 'playing' | 'victory' | 'defeat';

export interface WorldOptions {
  seed?: number;
  waves?: readonly (readonly EnemyKind[])[];
}

export interface SpawnOptions {
  thinkDelay?: number;
  /** Not driven by the AI (used by tests). */
  passive?: boolean;
}

export interface WorldStats {
  kills: number;
  parries: number;
  blocks: number;
  avoids: number;
  dodges: number;
  finishers: number;
  wallSlams: number;
  maxCombo: number;
  hitsTaken: number;
  startedAt: number;
  endedAt: number;
}

function freshStats(): WorldStats {
  return {
    kills: 0,
    parries: 0,
    blocks: 0,
    avoids: 0,
    dodges: 0,
    finishers: 0,
    wallSlams: 0,
    maxCombo: 0,
    hitsTaken: 0,
    startedAt: 0,
    endedAt: 0,
  };
}

const LANDED: ReadonlySet<HitOutcome> = new Set<HitOutcome>(['hit', 'counter', 'kill', 'break', 'armored', 'wrongAvoid']);
const MAX_EVENTS = 2000;

/**
 * Owns the whole simulation. Advances in fixed steps so behaviour is identical
 * at any render frame rate. No rendering code lives here.
 */
export class GameWorld implements CharacterWorld, CombatContext, PlayerWorld, AIWorld, WaveWorld, PhysicsWorld {
  time = 0;
  phase: WorldPhase = 'ready';
  player!: Character;
  enemies: Character[] = [];
  hitstop = 0;
  finisherActive = false;
  combo = 0;
  lastComboHitAt = -Infinity;
  stats: WorldStats = freshStats();

  readonly rng: Rng;
  readonly tokens = new AttackTokens();
  readonly combat: CombatSystem;
  readonly physics: Physics;
  readonly ai: EnemyAI;
  readonly waves: WaveManager;
  readonly playerCtl: PlayerController;

  private all: Character[] = [];
  private events: GameEvent[] = [];
  private accumulator = 0;
  private nextId = 1;
  private attackUid = 1;

  constructor(opts: WorldOptions = {}) {
    this.rng = new Rng(opts.seed ?? 20261012);
    this.combat = new CombatSystem(this);
    this.physics = new Physics(this);
    this.ai = new EnemyAI(this);
    this.waves = new WaveManager(this, opts.waves ?? DEFAULT_WAVES);
    this.playerCtl = new PlayerController(this);
    this.reset();
  }

  /** Every fighter (player first). */
  get characters(): readonly Character[] {
    return this.all;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  reset(): void {
    this.time = 0;
    this.hitstop = 0;
    this.accumulator = 0;
    this.finisherActive = false;
    this.combo = 0;
    this.lastComboHitAt = -Infinity;
    this.stats = freshStats();
    this.tokens.clear();
    this.ai.clear();
    this.waves.reset();
    this.playerCtl.reset();
    this.nextId = 1;
    this.attackUid = 1;
    this.player = new Character(this.nextId++, ARCHETYPES.player, 'player', ARENA_WIDTH / 2, ARENA_DEPTH * 0.55);
    this.enemies = [];
    this.rebuild();
    this.events = [];
    this.phase = 'ready';
    this.emit({ type: 'reset' });
  }

  /** Start the three-wave run. */
  start(): void {
    this.reset();
    this.phase = 'playing';
    this.stats.startedAt = this.time;
    this.emit({ type: 'start' });
    this.waves.start();
  }

  restart(): void {
    this.start();
  }

  /** Playing phase without waves (tests and sandbox experiments). */
  startSandbox(): void {
    this.reset();
    this.phase = 'playing';
  }

  // ---------------------------------------------------------------------------
  // Stepping
  // ---------------------------------------------------------------------------

  update(frameMs: number, input?: InputFrame): void {
    if (input) this.handleInput(input);
    this.accumulator += Math.max(0, Math.min(frameMs, MAX_FRAME_MS));
    while (this.accumulator >= SIM_STEP_MS - 1e-9) {
      this.accumulator -= SIM_STEP_MS;
      this.step(SIM_STEP_MS);
    }
  }

  private handleInput(input: InputFrame): void {
    if (this.phase === 'ready') {
      if (input.pressed.includes('start')) this.start();
      return;
    }
    if ((this.phase === 'victory' || this.phase === 'defeat') && input.pressed.includes('restart')) {
      this.restart();
      return;
    }
    if (this.phase === 'playing') this.playerCtl.receive(input, this.time);
  }

  step(dt: number): void {
    if (this.hitstop > 0) {
      // Hitstop freezes simulation time entirely (timers, windows and buffers).
      this.hitstop = Math.max(0, this.hitstop - dt);
      return;
    }
    this.time += dt;
    if (this.phase === 'playing') {
      this.playerCtl.update();
      this.ai.update(dt);
    } else {
      this.ai.standDown();
    }
    const chars = this.all;
    for (const c of chars) c.update(dt, this);
    this.physics.step(dt, chars);
    this.combat.processAttacks(chars);
    if (this.combo > 0 && this.time - this.lastComboHitAt > COMBO_TIMEOUT_MS) this.combo = 0;
    if (this.phase === 'playing') {
      this.checkDefeat();
      if (this.phase === 'playing') this.waves.update(dt);
    }
  }

  private checkDefeat(): void {
    if (this.player.alive) return;
    this.phase = 'defeat';
    this.stats.endedAt = this.time;
    this.tokens.clear();
    this.emit({ type: 'defeat' });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  emit(e: GameEvent): void {
    if (e.type === 'death' && e.id !== this.player.id) this.stats.kills += 1;
    if (e.type === 'wallSlam') this.stats.wallSlams += 1;
    this.events.push(e);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  /** Hand pending events to the presentation layer. */
  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Read pending events without consuming them (tests). */
  peekEvents(): readonly GameEvent[] {
    return this.events;
  }

  addHitstop(ms: number): void {
    this.hitstop = Math.min(HITSTOP_MAX_MS, Math.max(this.hitstop, ms));
  }

  onContact(attacker: Character, defender: Character, outcome: HitOutcome): void {
    if (attacker === this.player && LANDED.has(outcome)) this.bumpCombo();
    if (defender === this.player) {
      switch (outcome) {
        case 'parried':
          this.stats.parries += 1;
          break;
        case 'blocked':
        case 'guardBreak':
          this.stats.blocks += 1;
          break;
        case 'avoided':
          this.stats.avoids += 1;
          break;
        case 'dodged':
          this.stats.dodges += 1;
          break;
        default:
          if (LANDED.has(outcome)) {
            this.stats.hitsTaken += 1;
            this.combo = 0;
          }
      }
    }
  }

  private bumpCombo(): void {
    this.combo += 1;
    this.lastComboHitAt = this.time;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    this.emit({ type: 'combo', count: this.combo });
  }

  // ---------------------------------------------------------------------------
  // Roster
  // ---------------------------------------------------------------------------

  getCharacter(id: number): Character | undefined {
    for (const c of this.all) if (c.id === id) return c;
    return undefined;
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number, opts: SpawnOptions = {}): Character {
    const e = new Character(this.nextId++, ARCHETYPES[kind], 'enemy', x, y);
    e.facing = x > this.player.x ? -1 : 1;
    e.spawnedAt = this.time;
    this.enemies.push(e);
    this.rebuild();
    if (!opts.passive) this.ai.register(e, opts.thinkDelay ?? 0);
    return e;
  }

  removeDeadEnemies(): void {
    const keep: Character[] = [];
    for (const e of this.enemies) {
      if (e.alive) keep.push(e);
      else this.ai.unregister(e.id);
    }
    this.enemies = keep;
    this.rebuild();
  }

  private rebuild(): void {
    this.all = [this.player, ...this.enemies];
  }

  // ---------------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------------

  nextAttackUid(): number {
    return this.attackUid++;
  }

  startPlayerAttack(kind: 'light' | 'heavy' | 'push', inputDir: number): void {
    const p = this.player;
    const now = this.time;
    let data: AttackData;
    if (kind === 'push') {
      data = PLAYER_ATTACKS.push;
      p.comboChain = null;
      p.comboIndex = -1;
    } else {
      const chain = kind === 'light' ? LIGHT_CHAIN : HEAVY_CHAIN;
      let idx = 0;
      if (p.comboChain === kind && now <= p.comboExpireAt) idx = (p.comboIndex + 1) % chain.length;
      data = chain[idx];
      p.comboChain = kind;
      p.comboIndex = idx;
    }
    p.comboExpireAt = now + data.startup + data.active + data.recovery + COMBO_LINK_MS;

    const target = this.selectTarget(inputDir);
    if (inputDir !== 0) p.facing = inputDir > 0 ? 1 : -1;
    else if (target && Math.abs(target.x - p.x) > 2) p.facing = target.x > p.x ? 1 : -1;

    const counter = now <= p.counterUntil;
    if (counter) p.counterUntil = -Infinity;
    p.startAttack(data, this.nextAttackUid(), now, counter, target ? target.id : -1);
    this.emit({
      type: 'attackStart',
      id: p.id,
      attackId: data.id,
      height: data.height,
      unblockable: data.unblockable,
      isPlayer: true,
      counter,
      x: p.x,
      y: p.y,
      h: 0,
    });
  }

  /** Direction-aware soft lock: prefer the input direction, then the facing side. */
  selectTarget(inputDir: number): Character | undefined {
    const p = this.player;
    let best: Character | undefined;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || !e.isTargetable()) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (Math.abs(dx) > 280 || Math.abs(dy) > 90) continue;
      const side = Math.abs(dx) < 1 ? p.facing : Math.sign(dx);
      if (inputDir !== 0 && side !== Math.sign(inputDir)) continue;
      let score = Math.abs(dx) + Math.abs(dy) * 2.5;
      if (inputDir === 0 && side !== p.facing) score += 90;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  findFinisherTarget(): Character | undefined {
    const p = this.player;
    let best: Character | undefined;
    let bestScore = Infinity;
    for (const e of this.enemies) {
      if (e.state !== CharState.StructureBreak) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (Math.abs(dx) > FINISHER_RANGE_X || Math.abs(dy) > FINISHER_RANGE_Y) continue;
      let score = Math.abs(dx) + Math.abs(dy) * 2;
      if (Math.sign(dx) !== p.facing) score += 30;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  startFinisher(target: Character): void {
    const p = this.player;
    p.facing = target.x >= p.x ? 1 : -1;
    p.setState(CharState.Finisher);
    p.finisherRole = 'attacker';
    p.finisherPartnerId = target.id;
    p.finisherHits = 0;
    p.vx = 0;
    p.vy = 0;
    p.counterUntil = -Infinity;

    target.setState(CharState.Finisher);
    target.finisherRole = 'victim';
    target.finisherPartnerId = p.id;
    target.facing = p.facing === 1 ? -1 : 1;
    target.vx = 0;
    target.vy = 0;

    let tx = p.x + p.facing * FINISHER_SPACING;
    const minX = target.radius;
    const maxX = ARENA_WIDTH - target.radius;
    if (tx < minX || tx > maxX) {
      tx = Math.max(minX, Math.min(maxX, tx));
      p.x = tx - p.facing * FINISHER_SPACING;
    }
    target.x = tx;
    target.y = p.y;
    this.tokens.release(target.id);
    this.finisherActive = true;
    this.emit({ type: 'finisherStart', attackerId: p.id, victimId: target.id, x: (p.x + tx) / 2, y: p.y, h: 100 });
  }

  onFinisherHit(attacker: Character, index: number, final: boolean): void {
    const now = this.time;
    const victim = this.getCharacter(attacker.finisherPartnerId);
    const at = victim ?? attacker;
    this.emit({
      type: 'finisherHit',
      attackerId: attacker.id,
      victimId: victim ? victim.id : -1,
      index,
      final,
      x: at.x,
      y: at.y,
      h: 100,
    });
    this.addHitstop(final ? 170 : 60);
    if (!victim || victim.state !== CharState.Finisher) {
      if (final) this.finisherActive = false;
      return;
    }
    victim.hitFlashUntil = now + 100;
    victim.lastHitAt = now;
    victim.lastHitHeavy = final;
    this.bumpCombo();
    if (!final) return;

    this.finisherActive = false;
    victim.health = Math.max(0, victim.health - victim.arch.finisherDamage);
    if (victim.health <= 0) {
      victim.die(now);
      victim.vx = attacker.facing * 460;
      victim.damping = 4;
      this.emit({ type: 'death', id: victim.id, kind: victim.kind, x: victim.x, y: victim.y, h: 0 });
    } else {
      victim.knockdown(now, KNOCKDOWN_LIE_MS);
      victim.structure = victim.maxStructure * 0.3;
      victim.lastStructureGainAt = now;
      victim.vx = attacker.facing * 320;
      victim.damping = KNOCKBACK_DAMPING;
      this.emit({ type: 'knockdown', id: victim.id, x: victim.x, y: victim.y, h: 0 });
    }
    attacker.health = Math.min(attacker.maxHealth, attacker.health + FINISHER_HEAL);
    this.stats.finishers += 1;
  }

  enemyStartAttack(e: Character, data: AttackData): void {
    e.startAttack(data, this.nextAttackUid(), this.time, false, this.player.id);
    this.emit({
      type: 'attackStart',
      id: e.id,
      attackId: data.id,
      height: data.height,
      unblockable: data.unblockable,
      isPlayer: false,
      counter: false,
      x: e.x,
      y: e.y,
      h: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Physics callbacks
  // ---------------------------------------------------------------------------

  endPush(c: Character): void {
    const byCollision = c.pushedByCollision;
    c.pushedByCollision = false;
    c.damping = KNOCKBACK_DAMPING;
    if (byCollision) {
      c.knockdown(this.time, SHORT_KNOCKDOWN_LIE_MS);
      this.emit({ type: 'knockdown', id: c.id, x: c.x, y: c.y, h: 0 });
    } else {
      c.recoil(PUSH_STUMBLE_MS, this.time, 'stumble');
    }
  }

  onWallSlam(c: Character, wall: WallSide, impact: number): void {
    const now = this.time;
    if (wall === 'left') c.vx = impact * 0.22;
    else if (wall === 'right') c.vx = -impact * 0.22;
    else c.vy = impact * 0.22;
    c.damping = KNOCKBACK_DAMPING;
    c.pushedByCollision = false;
    c.health = Math.max(0, c.health - WALL_SLAM_DAMAGE);
    c.lastHitAt = now;
    c.hitFlashUntil = now + 110;
    c.lastHitHeavy = true;
    this.emit({ type: 'wallSlam', id: c.id, wall, x: c.x, y: c.y, h: 90 });
    this.addHitstop(120);
    if (c.team === 'enemy') this.bumpCombo();
    if (c.health <= 0) {
      c.die(now);
      this.emit({ type: 'death', id: c.id, kind: c.kind, x: c.x, y: c.y, h: 0 });
      return;
    }
    if (c.addStructure(WALL_SLAM_STRUCTURE, now)) {
      c.breakStructure(now);
      this.emit({ type: 'structureBreak', id: c.id, x: c.x, y: c.y, h: 120 });
    } else {
      c.knockdown(now, SHORT_KNOCKDOWN_LIE_MS);
      this.emit({ type: 'knockdown', id: c.id, x: c.x, y: c.y, h: 0 });
    }
  }

  onBodyCollision(mover: Character, other: Character, speed: number): void {
    const now = this.time;
    const dir = Math.sign(mover.vx) || 1;
    this.emit({ type: 'bodyCollide', id: mover.id, otherId: other.id, x: (mover.x + other.x) / 2, y: (mover.y + other.y) / 2, h: 80 });
    this.addHitstop(100);
    if (mover.team === 'enemy') this.bumpCombo();

    mover.health = Math.max(0, mover.health - COLLIDE_DAMAGE);
    mover.hitFlashUntil = now + 100;
    mover.lastHitAt = now;
    mover.pushedByCollision = false;
    mover.vx = dir * speed * 0.12;
    mover.damping = KNOCKBACK_DAMPING;
    if (mover.health <= 0) {
      mover.die(now);
      this.emit({ type: 'death', id: mover.id, kind: mover.kind, x: mover.x, y: mover.y, h: 0 });
    } else {
      mover.knockdown(now, SHORT_KNOCKDOWN_LIE_MS);
      this.emit({ type: 'knockdown', id: mover.id, x: mover.x, y: mover.y, h: 0 });
    }

    other.health = Math.max(0, other.health - COLLIDE_DAMAGE);
    other.hitFlashUntil = now + 100;
    other.lastHitAt = now;
    other.lastHitHeavy = true;
    const transfer = (speed * 0.7) / Math.sqrt(other.mass);
    if (other.health <= 0) {
      other.die(now);
      other.vx = dir * transfer * 0.5;
      this.emit({ type: 'death', id: other.id, kind: other.kind, x: other.x, y: other.y, h: 0 });
      return;
    }
    if (other.addStructure(COLLIDE_STRUCTURE, now)) {
      other.breakStructure(now);
      this.emit({ type: 'structureBreak', id: other.id, x: other.x, y: other.y, h: 120 });
    } else if (transfer > PUSH_MIN_SPEED * 1.6) {
      other.startPushed(dir * transfer, 0, true);
    } else {
      other.knockdown(now, SHORT_KNOCKDOWN_LIE_MS);
      other.vx = dir * transfer;
      other.damping = KNOCKBACK_DAMPING;
      this.emit({ type: 'knockdown', id: other.id, x: other.x, y: other.y, h: 0 });
    }
  }

  // ---------------------------------------------------------------------------
  // Wave callbacks
  // ---------------------------------------------------------------------------

  onWaveCleared(_wave: number): void {
    const p = this.player;
    if (!p.alive) return;
    p.health = Math.min(p.maxHealth, p.health + WAVE_HEAL);
    p.structure = 0;
  }

  onAllWavesComplete(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'victory';
    this.stats.endedAt = this.time;
    this.tokens.clear();
    this.emit({ type: 'victory' });
  }

  // ---------------------------------------------------------------------------
  // Introspection / debug (used by HUD, tests and the browser smoke test)
  // ---------------------------------------------------------------------------

  aliveEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n += 1;
    return n;
  }

  attackingEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (e.isAttacking) n += 1;
    return n;
  }

  snapshot(): WorldSnapshot {
    const p = this.player;
    return {
      phase: this.phase,
      time: Math.round(this.time),
      wave: this.waves.waveNumber,
      wavePhase: this.waves.phase,
      combo: this.combo,
      tokens: this.tokens.count,
      stats: { ...this.stats },
      player: charSnapshot(p),
      enemies: this.enemies.map(charSnapshot),
    };
  }

  debugKillAllEnemies(): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.die(this.time);
      this.emit({ type: 'death', id: e.id, kind: e.kind, x: e.x, y: e.y, h: 0 });
    }
  }

  debugSetPlayerHealth(hp: number): void {
    this.player.health = Math.max(0, Math.min(this.player.maxHealth, hp));
    if (this.player.health <= 0 && this.player.alive) this.player.die(this.time);
  }
}

export interface CharSnapshot {
  id: number;
  kind: string;
  state: string;
  x: number;
  y: number;
  facing: number;
  health: number;
  structure: number;
  maxHealth: number;
  maxStructure: number;
}

export interface WorldSnapshot {
  phase: WorldPhase;
  time: number;
  wave: number;
  wavePhase: string;
  combo: number;
  tokens: number;
  stats: WorldStats;
  player: CharSnapshot;
  enemies: CharSnapshot[];
}

function charSnapshot(c: Character): CharSnapshot {
  return {
    id: c.id,
    kind: c.kind,
    state: c.state,
    x: Math.round(c.x * 10) / 10,
    y: Math.round(c.y * 10) / 10,
    facing: c.facing,
    health: Math.round(c.health * 10) / 10,
    structure: Math.round(c.structure * 10) / 10,
    maxHealth: c.maxHealth,
    maxStructure: c.maxStructure,
  };
}
