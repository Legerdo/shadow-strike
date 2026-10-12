import {
  AVOID_STRUCTURE_BASE,
  AVOID_STRUCTURE_MULT,
  BLOCKSTUN_MS,
  COUNTER_DAMAGE_MULT,
  COUNTER_WINDOW_MS,
  GUARD_PUSHBACK_MULT,
  GUARD_STRUCTURE_MULT,
  INTERRUPT_STRUCTURE_MULT,
  KNOCKBACK_DAMPING,
  KNOCKDOWN_LIE_MS,
  PARRY_RECOIL_MS,
  PARRY_STRUCTURE_BASE,
  PARRY_STRUCTURE_MULT,
  PUSH_SPEED,
  SHORT_KNOCKDOWN_LIE_MS,
  SHOVE_INTERRUPT_MS,
  SHOVE_SPEED,
  SHOVE_STRUCTURE,
  WRONG_AVOID_MULT,
} from './constants';
import { CharState } from './types';
import type { AttackData } from './types';
import type { AttackInstance, Character } from './Character';
import type { GameEvent, HitTag } from './events';

export type HitOutcome =
  | 'hit'
  | 'counter'
  | 'kill'
  | 'break'
  | 'armored'
  | 'blocked'
  | 'guardBreak'
  | 'parried'
  | 'avoided'
  | 'wrongAvoid'
  | 'dodged'
  | 'pushed'
  | 'shoved';

export interface CombatContext {
  readonly time: number;
  emit(e: GameEvent): void;
  addHitstop(ms: number): void;
  /** Notified after every resolved contact (used for combo counters and stats). */
  onContact(attacker: Character, defender: Character, outcome: HitOutcome): void;
}

interface Spatial {
  readonly x: number;
  readonly y: number;
  readonly facing: number;
}

/**
 * Pure geometric reach test on gameplay coordinates:
 *  - target must be in front of the attacker (attack direction),
 *  - forward distance to the target's body edge must be within reach,
 *  - depth (world Y) difference must be inside the attack's depth band.
 */
export function attackReaches(attacker: Spatial, target: Spatial & { readonly radius: number }, data: Pick<AttackData, 'reach' | 'depth'>): boolean {
  const forward = (target.x - attacker.x) * attacker.facing;
  if (forward < -target.radius * 0.5) return false;
  if (forward - target.radius > data.reach) return false;
  if (Math.abs(target.y - attacker.y) > data.depth) return false;
  return true;
}

export function canBeHitBy(attacker: Character, target: Character): boolean {
  return target !== attacker && target.team !== attacker.team && target.isTargetable();
}

/** Height (above floor) where an attack of the given height connects, for effects. */
function contactHeight(data: AttackData): number {
  if (data.height === 'high') return 128;
  if (data.height === 'low') return 26;
  return data.limb === 'footF' || data.limb === 'footB' ? 88 : 104;
}

export class CombatSystem {
  private readonly ctx: CombatContext;

  constructor(ctx: CombatContext) {
    this.ctx = ctx;
  }

  /** Check every active attack against every valid target (one hit per target per attack). */
  processAttacks(chars: readonly Character[]): void {
    for (const attacker of chars) {
      if (attacker.state !== CharState.AttackActive) continue;
      const inst = attacker.attack;
      if (!inst) continue;
      for (const target of chars) {
        if (attacker.state !== CharState.AttackActive) break;
        if (!canBeHitBy(attacker, target)) continue;
        if (inst.hitIds.has(target.id)) continue;
        if (!attackReaches(attacker, target, inst.data)) continue;
        inst.hitIds.add(target.id);
        inst.connected = true;
        const outcome = this.resolveHit(attacker, target, inst);
        this.ctx.onContact(attacker, target, outcome);
      }
    }
  }

  resolveHit(att: Character, def: Character, inst: AttackInstance): HitOutcome {
    const now = this.ctx.time;
    const d = inst.data;
    const point = { x: def.x - att.facing * def.radius * 0.5, y: def.y, h: contactHeight(d) };

    // 1. Invulnerability frames (dodge, get-up).
    if (def.isInvulnerable(now)) {
      this.ctx.emit({ type: 'dodged', targetId: def.id, ...point });
      return 'dodged';
    }

    // 2. Directional avoids only matter against high / low attacks.
    const avoid = def.avoidHeight();
    if (avoid && def.isAvoidActive() && d.height !== 'mid') {
      if (avoid === d.height) {
        def.avoidSucceeded = true;
        def.counterUntil = now + COUNTER_WINDOW_MS;
        const broke = att.addStructure(d.structure * AVOID_STRUCTURE_MULT + AVOID_STRUCTURE_BASE, now);
        if (broke) this.breakStructure(att);
        this.ctx.emit({ type: 'avoid', targetId: def.id, height: d.height, ...point });
        this.ctx.addHitstop(45);
        return 'avoided';
      }
      // Wrong direction: the fighter is committed and eats a counter hit.
      this.ctx.emit({ type: 'wrongAvoid', targetId: def.id, height: d.height, ...point });
      this.applyHit(att, def, inst, WRONG_AVOID_MULT, 'wrongAvoid', point);
      return 'wrongAvoid';
    }

    // 3. Push / shove.
    if (d.kind === 'push') return this.resolvePush(att, def, point);

    // 4. Guard and parry.
    if (def.isGuarding()) {
      def.facing = att.x >= def.x ? 1 : -1;
      if (d.unblockable) {
        return this.applyHit(att, def, inst, 1, 'unblockable', point);
      }
      if (def.isParryWindow(now)) return this.parry(att, def, inst, point);
      return this.block(att, def, inst, point);
    }

    // 5. Clean hit.
    if (inst.counter) return this.applyHit(att, def, inst, COUNTER_DAMAGE_MULT, 'counter', point);
    if (def.state === CharState.AttackStartup && !(def.team === 'enemy' && def.attack?.data.unblockable)) {
      return this.applyHit(att, def, inst, 1, 'interrupt', point);
    }
    return this.applyHit(att, def, inst, 1, 'normal', point);
  }

  private parry(att: Character, def: Character, inst: AttackInstance, point: { x: number; y: number; h: number }): HitOutcome {
    const now = this.ctx.time;
    const d = inst.data;
    def.onParrySuccess(now);
    def.counterUntil = now + COUNTER_WINDOW_MS;
    const broke = att.addStructure(d.structure * PARRY_STRUCTURE_MULT + PARRY_STRUCTURE_BASE, now);
    if (broke) {
      this.breakStructure(att);
    } else {
      att.recoil(PARRY_RECOIL_MS * att.arch.recoilMult, now);
      att.vx = -att.facing * 170;
      att.damping = KNOCKBACK_DAMPING;
    }
    this.ctx.emit({ type: 'parry', attackerId: att.id, targetId: def.id, dir: att.facing, ...point });
    this.ctx.addHitstop(75);
    return 'parried';
  }

  private block(att: Character, def: Character, inst: AttackInstance, point: { x: number; y: number; h: number }): HitOutcome {
    const now = this.ctx.time;
    const d = inst.data;
    if (def.state !== CharState.Guard) def.setState(CharState.Guard);
    const broke = def.addStructure(d.structure * GUARD_STRUCTURE_MULT, now);
    def.blockstunUntil = now + BLOCKSTUN_MS * (d.hitstop >= 100 ? 1.5 : 1);
    def.lastBlockAt = now;
    def.vx = att.facing * Math.max(90, d.knockback * GUARD_PUSHBACK_MULT) / def.mass;
    def.damping = KNOCKBACK_DAMPING;
    if (broke) {
      this.breakStructure(def);
      this.ctx.emit({ type: 'guardBreak', id: def.id, ...point });
      this.ctx.addHitstop(110);
      return 'guardBreak';
    }
    this.ctx.emit({ type: 'block', attackerId: att.id, targetId: def.id, dir: att.facing, ...point });
    this.ctx.addHitstop(35);
    return 'blocked';
  }

  private resolvePush(att: Character, def: Character, point: { x: number; y: number; h: number }): HitOutcome {
    const now = this.ctx.time;
    def.facing = att.x >= def.x ? 1 : -1;
    if (def.state === CharState.HitStun || def.state === CharState.StructureBreak) {
      const speed = PUSH_SPEED / Math.sqrt(def.mass);
      def.startPushed(att.facing * speed, (def.y - att.y) * 0.6, false);
      this.ctx.emit({ type: 'pushLaunch', id: def.id, dir: att.facing, ...point });
      this.ctx.addHitstop(90);
      return 'pushed';
    }
    // Not staggered: a shove that creates space, builds structure and interrupts wind-ups.
    const broke = def.addStructure(SHOVE_STRUCTURE, now);
    def.vx = (att.facing * SHOVE_SPEED) / def.mass;
    def.damping = KNOCKBACK_DAMPING;
    if (broke) {
      this.breakStructure(def);
    } else if (def.state === CharState.AttackStartup && !def.arch.armorOnStartup && !def.attack?.data.unblockable) {
      def.recoil(SHOVE_INTERRUPT_MS, now);
    } else if (def.state === CharState.Guard) {
      def.blockstunUntil = now + 200;
    }
    this.ctx.emit({ type: 'shove', id: def.id, dir: att.facing, ...point });
    this.ctx.addHitstop(40);
    return 'shoved';
  }

  /** Does the defender shrug off the stagger of this attack? */
  private hasArmor(def: Character, d: AttackData): boolean {
    if (def.state === CharState.AttackStartup) {
      if (def.arch.armorOnStartup) return true;
      // Telegraphed HIGH/LOW attacks are committed: they must be read and avoided, not mashed through.
      if (def.team === 'enemy' && def.attack?.data.unblockable) return true;
    }
    if (def.arch.flinchThreshold > 0 && d.hitstun < def.arch.flinchThreshold && def.state !== CharState.HitStun) return true;
    return false;
  }

  private breakStructure(c: Character): void {
    c.breakStructure(this.ctx.time);
    this.ctx.emit({ type: 'structureBreak', id: c.id, x: c.x, y: c.y, h: 120 });
  }

  private applyHit(
    att: Character,
    def: Character,
    inst: AttackInstance,
    mult: number,
    tag: HitTag,
    point: { x: number; y: number; h: number },
  ): HitOutcome {
    const now = this.ctx.time;
    const d = inst.data;
    const damage = Math.round(d.damage * mult * att.arch.damageMult);
    const structureGain = d.structure * mult * (tag === 'interrupt' ? INTERRUPT_STRUCTURE_MULT : 1);
    const heavy = d.hitstop >= 90;

    def.health = Math.max(0, def.health - damage);
    def.lastHitAt = now;
    def.hitFlashUntil = now + 90;
    def.lastHitHeight = d.height;
    def.lastHitHeavy = heavy;
    def.facing = att.x >= def.x ? 1 : -1;

    const emitHit = (finalTag: HitTag): void => {
      this.ctx.emit({
        type: 'hit',
        attackerId: att.id,
        targetId: def.id,
        damage,
        heavy,
        counter: mult > 1,
        dir: att.facing,
        tag: finalTag,
        ...point,
      });
    };

    if (def.health <= 0) {
      def.die(now);
      def.vx = att.facing * (d.knockback + 260);
      emitHit(tag);
      this.ctx.emit({ type: 'death', id: def.id, kind: def.kind, x: def.x, y: def.y, h: 0 });
      this.ctx.addHitstop(d.hitstop + 50);
      return 'kill';
    }

    if (def.state === CharState.StructureBreak) {
      // Already broken: damage only, the opening is preserved for the finisher.
      emitHit('broken');
      this.ctx.addHitstop(d.hitstop * 0.7);
      return 'hit';
    }

    if (def.addStructure(structureGain, now)) {
      this.breakStructure(def);
      emitHit(tag);
      this.ctx.addHitstop(d.hitstop + 60);
      return 'break';
    }

    const armored = this.hasArmor(def, d);
    let finalTag: HitTag = tag;
    if (d.knockdown && !armored) {
      def.knockdown(now, def.team === 'player' ? SHORT_KNOCKDOWN_LIE_MS : KNOCKDOWN_LIE_MS);
      def.vx = (att.facing * Math.max(160, d.knockback)) / def.mass;
      def.damping = KNOCKBACK_DAMPING;
      this.ctx.emit({ type: 'knockdown', id: def.id, x: def.x, y: def.y, h: 0 });
    } else if (!armored && d.hitstun > 0) {
      const stun = def.applyHitStun(d.hitstun * (mult > 1 ? 1.15 : 1), now);
      def.vx = (att.facing * d.knockback * (stun > 0 ? 1 : 0.4)) / def.mass;
      def.damping = KNOCKBACK_DAMPING;
    } else {
      finalTag = armored ? 'armored' : tag;
      def.vx = (att.facing * d.knockback * 0.25) / def.mass;
      def.damping = KNOCKBACK_DAMPING;
    }

    emitHit(finalTag);
    this.ctx.addHitstop(d.hitstop * (mult > 1 ? 1.25 : 1));
    if (finalTag === 'armored') return 'armored';
    return mult > 1 ? 'counter' : 'hit';
  }
}
