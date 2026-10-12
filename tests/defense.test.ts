import { describe, expect, it } from 'vitest';
import { ENEMY_ATTACKS } from '../src/game/attacks';
import { CharState } from '../src/game/types';
import type { AttackData } from '../src/game/types';
import type { GameWorld } from '../src/game/GameWorld';
import type { Character } from '../src/game/Character';
import { advanceSim, eventsOf, placePlayer, press, sandbox, spawnPassive } from './helpers';

interface Duel {
  w: GameWorld;
  p: Character;
  e: Character;
}

/** Player at x=500 facing right, passive thug at x=575 facing left, same depth lane. */
function duel(kind: 'normal' | 'agile' | 'heavy' = 'normal'): Duel {
  const w = sandbox();
  const p = placePlayer(w, 500, 150, 1);
  const e = spawnPassive(w, kind, 575, 150, -1);
  return { w, p, e };
}

/** Enemy starts `data`; returns sim time at which the active window opens. */
function enemyAttack(d: Duel, data: AttackData): number {
  d.w.enemyStartAttack(d.e, data);
  return d.w.time + data.startup;
}

describe('guard and parry', () => {
  it('a fresh guard press just before impact parries and raises the attacker structure', () => {
    const d = duel();
    const atk = ENEMY_ATTACKS.thugJab;
    const activeAt = enemyAttack(d, atk);
    advanceSim(d.w, activeAt - d.w.time - 90); // 90 ms before the hit
    press(d.w, ['guard'], { guard: true });
    advanceSim(d.w, 250, { guard: true });

    expect(eventsOf(d.w, 'parry')).toHaveLength(1);
    expect(d.p.health).toBe(d.p.maxHealth);
    expect(d.e.structure).toBeGreaterThan(0);
    expect(d.p.structure).toBe(0);
    expect(d.w.stats.parries).toBe(1);
  });

  it('a successful parry staggers the attacker and opens a counter window', () => {
    const d = duel();
    const activeAt = enemyAttack(d, ENEMY_ATTACKS.thugJab);
    advanceSim(d.w, activeAt - d.w.time - 80);
    press(d.w, ['guard'], { guard: true });
    advanceSim(d.w, 100, { guard: true });
    expect(d.e.state).toBe(CharState.HitStun);
    expect(d.w.time).toBeLessThan(d.p.counterUntil);
  });

  it('holding guard blocks: no health loss, but the defender structure rises', () => {
    const d = duel();
    press(d.w, ['guard'], { guard: true });
    advanceSim(d.w, 400, { guard: true }); // parry window long gone
    const activeAt = enemyAttack(d, ENEMY_ATTACKS.thugJab);
    advanceSim(d.w, activeAt - d.w.time + 150, { guard: true });

    expect(eventsOf(d.w, 'block')).toHaveLength(1);
    expect(eventsOf(d.w, 'parry')).toHaveLength(0);
    expect(d.p.health).toBe(d.p.maxHealth);
    expect(d.p.structure).toBeGreaterThan(0);
    expect(d.e.structure).toBe(0);
  });

  it('mashing guard does not grant a parry window (anti auto-parry)', () => {
    const d = duel();
    const activeAt = enemyAttack(d, ENEMY_ATTACKS.thugJab);
    // First tap far too early, then a re-press inside the lockout right before the hit.
    advanceSim(d.w, activeAt - d.w.time - 300);
    press(d.w, ['guard'], { guard: true });
    advanceSim(d.w, 160, { guard: true });
    advanceSim(d.w, 40); // released
    press(d.w, ['guard'], { guard: true });
    advanceSim(d.w, 250, { guard: true });

    expect(eventsOf(d.w, 'parry')).toHaveLength(0);
    expect(eventsOf(d.w, 'block')).toHaveLength(1);
    expect(d.e.structure).toBe(0);
    expect(d.p.health).toBe(d.p.maxHealth);
  });

  it('unblockable attacks go through guard', () => {
    const d = duel();
    press(d.w, ['guard'], { guard: true });
    const activeAt = enemyAttack(d, ENEMY_ATTACKS.thugHaymaker);
    advanceSim(d.w, activeAt - d.w.time + 150, { guard: true });
    expect(d.p.health).toBeLessThan(d.p.maxHealth);
    expect(eventsOf(d.w, 'block')).toHaveLength(0);
  });
});

describe('directional avoids', () => {
  function avoidVs(attack: AttackData, keys: { down?: boolean; up?: boolean }) {
    const d = duel();
    const activeAt = enemyAttack(d, attack);
    advanceSim(d.w, activeAt - d.w.time - 120);
    press(d.w, ['guard'], { guard: true, ...keys });
    const stateAfterPress = d.p.state;
    advanceSim(d.w, 300, { guard: true, ...keys });
    return { ...d, stateAfterPress };
  }

  it('Space+S ducks under a HIGH attack: no damage, attacker loses structure', () => {
    const r = avoidVs(ENEMY_ATTACKS.thugHaymaker, { down: true });
    expect(r.stateAfterPress).toBe(CharState.AvoidHigh);
    expect(r.p.health).toBe(r.p.maxHealth);
    expect(eventsOf(r.w, 'avoid')).toHaveLength(1);
    expect(r.e.structure).toBeGreaterThan(0);
  });

  it('Space+W hops over a LOW attack: no damage', () => {
    const r = avoidVs(ENEMY_ATTACKS.thugSweep, { up: true });
    expect(r.stateAfterPress).toBe(CharState.AvoidLow);
    expect(r.p.health).toBe(r.p.maxHealth);
    expect(eventsOf(r.w, 'avoid')).toHaveLength(1);
  });

  it('ducking under a LOW attack fails and is punished harder than a plain hit', () => {
    const r = avoidVs(ENEMY_ATTACKS.thugSweep, { down: true });
    expect(eventsOf(r.w, 'avoid')).toHaveLength(0);
    expect(eventsOf(r.w, 'wrongAvoid')).toHaveLength(1);
    const plain = ENEMY_ATTACKS.thugSweep.damage;
    expect(r.p.maxHealth - r.p.health).toBeGreaterThan(plain);
  });

  it('hopping into a HIGH attack fails', () => {
    const r = avoidVs(ENEMY_ATTACKS.thugHaymaker, { up: true });
    expect(eventsOf(r.w, 'avoid')).toHaveLength(0);
    expect(r.p.health).toBeLessThan(r.p.maxHealth);
  });

  it('avoids do nothing against MID attacks', () => {
    const r = avoidVs(ENEMY_ATTACKS.thugJab, { down: true });
    expect(eventsOf(r.w, 'avoid')).toHaveLength(0);
    expect(r.p.health).toBe(r.p.maxHealth - ENEMY_ATTACKS.thugJab.damage);
  });

  it('a successful avoid enables a counter attack with bonus damage', () => {
    const r = avoidVs(ENEMY_ATTACKS.thugHaymaker, { down: true });
    const before = r.e.health;
    press(r.w, ['light']);
    advanceSim(r.w, 300);
    const dealt = before - r.e.health;
    expect(eventsOf(r.w, 'hit').some((h) => h.attackerId === r.p.id && h.counter)).toBe(true);
    expect(dealt).toBeGreaterThan(6);
  });

  it('W/S pressed while guarding avoid instead of moving', () => {
    const d = duel();
    press(d.w, ['guard'], { guard: true });
    advanceSim(d.w, 50, { guard: true });
    const y0 = d.p.y;
    press(d.w, ['down'], { guard: true, down: true });
    expect(d.p.state).toBe(CharState.AvoidHigh);
    advanceSim(d.w, 700, { guard: true, down: true });
    expect(d.p.y).toBeCloseTo(y0, 5);
    expect(d.p.state).toBe(CharState.Guard);
  });
});

describe('dodge', () => {
  it('dodge invulnerability makes an attack whiff', () => {
    const d = duel();
    const activeAt = enemyAttack(d, ENEMY_ATTACKS.thugJab);
    advanceSim(d.w, activeAt - d.w.time - 40);
    press(d.w, ['dodge']); // no direction -> backstep
    advanceSim(d.w, 300);
    expect(d.p.health).toBe(d.p.maxHealth);
    expect(d.p.x).toBeLessThan(500);
  });

  it('dodging in a direction moves the player through the depth axis', () => {
    const d = duel();
    const y0 = d.p.y;
    press(d.w, ['dodge'], { up: true });
    expect(d.p.state).toBe(CharState.Dodge);
    advanceSim(d.w, 400); // keys released: only the dash moves the player
    expect(d.p.y).toBeLessThan(y0 - 60);
  });
});

describe('telegraphed attacks are committed', () => {
  it('a HIGH/LOW wind-up cannot be interrupted by a jab', () => {
    const d = duel();
    d.w.enemyStartAttack(d.e, ENEMY_ATTACKS.thugHaymaker);
    advanceSim(d.w, 100);
    press(d.w, ['light']);
    advanceSim(d.w, 200);
    expect(d.e.health).toBeLessThan(d.e.maxHealth); // the jab lands...
    expect(d.e.state).toBe(CharState.AttackStartup); // ...but the haymaker keeps coming
  });

  it('a MID wind-up is interrupted by a jab', () => {
    const d = duel();
    d.w.enemyStartAttack(d.e, ENEMY_ATTACKS.thugJab);
    advanceSim(d.w, 100);
    press(d.w, ['light']);
    advanceSim(d.w, 200);
    expect(d.e.state).toBe(CharState.HitStun);
  });
});
