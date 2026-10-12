import { describe, expect, it } from 'vitest';
import { ENEMY_ATTACKS, PLAYER_ATTACKS } from '../src/game/attacks';
import { COLLIDE_DAMAGE, FINISHER_DURATION_MS, WALL_SLAM_DAMAGE } from '../src/game/constants';
import { CharState } from '../src/game/types';
import { advanceSim, advanceUntil, eventsOf, placePlayer, press, sandbox, spawnPassive } from './helpers';

describe('structure and finisher', () => {
  it('structure and health are tracked independently', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'normal', 560, 150);
    press(w, ['heavy']);
    advanceSim(w, 700);
    expect(e.health).toBe(e.maxHealth - PLAYER_ATTACKS.heavy1.damage);
    expect(e.structure).toBeCloseTo(PLAYER_ATTACKS.heavy1.structure, 5);
  });

  it('filling an enemy structure breaks it and enables a lethal finisher', () => {
    const w = sandbox();
    const p = placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'normal', 560, 150);
    e.addStructure(e.maxStructure - 2, w.time);
    press(w, ['light']);
    advanceUntil(w, () => e.state === CharState.StructureBreak, 500);
    expect(e.state).toBe(CharState.StructureBreak);
    expect(eventsOf(w, 'structureBreak')).toHaveLength(1);
    expect(e.health).toBeGreaterThan(0);

    press(w, ['finisher']);
    advanceUntil(w, () => p.state === CharState.Finisher, 400);
    expect(p.state).toBe(CharState.Finisher);
    expect(e.state).toBe(CharState.Finisher);
    advanceSim(w, FINISHER_DURATION_MS + 100);
    expect(e.state).toBe(CharState.Dead);
    expect(p.state).toBe(CharState.Idle);
    expect(w.stats.finishers).toBe(1);
    expect(eventsOf(w, 'finisherHit').filter((f) => f.final)).toHaveLength(1);
  });

  it('finisher input does nothing when no enemy is structure-broken', () => {
    const w = sandbox();
    const p = placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'normal', 560, 150);
    press(w, ['finisher']);
    advanceSim(w, 300);
    expect(p.state).not.toBe(CharState.Finisher);
    expect(e.health).toBe(e.maxHealth);
  });

  it('heavy enemies survive their first finisher', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'heavy', 565, 150);
    e.breakStructure(w.time);
    press(w, ['finisher']);
    advanceSim(w, FINISHER_DURATION_MS + 200);
    expect(e.alive).toBe(true);
    expect(e.health).toBeLessThan(e.maxHealth);
    expect(e.state).toBe(CharState.Knockdown);
  });

  it('a structure-broken enemy stops attacking (AI suspended)', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    const e = w.spawnEnemy('normal', 570, 150, { thinkDelay: 0 });
    e.breakStructure(w.time);
    let attacked = false;
    for (let i = 0; i < 200; i++) {
      advanceSim(w, 10);
      if (e.state === CharState.StructureBreak && e.isAttacking) attacked = true;
      if (e.state !== CharState.StructureBreak) break;
    }
    expect(attacked).toBe(false);
  });

  it('player structure break temporarily disables guard', () => {
    const w = sandbox();
    const p = placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'normal', 575, 150, -1);
    p.addStructure(p.maxStructure - 3, w.time);
    press(w, ['guard'], { guard: true });
    advanceSim(w, 300, { guard: true });
    w.enemyStartAttack(e, ENEMY_ATTACKS.thugJab);
    advanceUntil(w, () => p.state === CharState.StructureBreak, 1000, { guard: true });
    expect(p.state).toBe(CharState.StructureBreak);
    expect(eventsOf(w, 'guardBreak')).toHaveLength(1);
    // Guard input is ignored while broken.
    press(w, ['guard'], { guard: true });
    advanceSim(w, 100, { guard: true });
    expect(p.state).toBe(CharState.StructureBreak);
    // ...and it recovers to a partially filled gauge.
    advanceUntil(w, () => p.state !== CharState.StructureBreak, 3000, { guard: true });
    expect(p.structure).toBeLessThan(p.maxStructure);
  });

  it('structure regenerates once pressure stops', () => {
    const w = sandbox();
    const e = spawnPassive(w, 'normal', 700, 150);
    e.addStructure(50, w.time);
    advanceSim(w, e.arch.structureRegenDelay - 100);
    expect(e.structure).toBeCloseTo(50, 5);
    advanceSim(w, 2000);
    expect(e.structure).toBeLessThan(50);
  });
});

describe('push, walls and collisions', () => {
  it('pushing a staggered enemy into a wall deals extra damage and knocks it down', () => {
    const w = sandbox();
    placePlayer(w, 215, 150, -1);
    const e = spawnPassive(w, 'normal', 145, 150, 1);
    e.recoil(1500, w.time); // staggered
    press(w, ['push']);
    advanceUntil(w, () => eventsOf(w, 'wallSlam').length > 0, 1200);
    expect(eventsOf(w, 'pushLaunch')).toHaveLength(1);
    expect(eventsOf(w, 'wallSlam')).toHaveLength(1);
    expect(e.health).toBe(e.maxHealth - WALL_SLAM_DAMAGE);
    advanceSim(w, 50);
    expect(e.state).toBe(CharState.Knockdown);
    // ...and it gets back up afterwards.
    advanceUntil(w, () => e.state === CharState.Idle, 3000);
    expect(e.state).toBe(CharState.Idle);
  });

  it('enemies are actually pushed over time, not teleported', () => {
    const w = sandbox();
    placePlayer(w, 700, 150, 1);
    const e = spawnPassive(w, 'normal', 765, 150, -1);
    e.recoil(1500, w.time);
    press(w, ['push']);
    advanceUntil(w, () => e.state === CharState.Pushed, 600);
    const xs: number[] = [];
    for (let i = 0; i < 6; i++) {
      advanceSim(w, 20);
      xs.push(e.x);
    }
    for (let i = 1; i < xs.length; i++) {
      const stepDist = xs[i] - xs[i - 1];
      expect(stepDist).toBeGreaterThan(0);
      expect(stepDist).toBeLessThan(40);
    }
  });

  it('a pushed enemy bowls over another enemy and both fall', () => {
    const w = sandbox();
    placePlayer(w, 530, 150, 1);
    const a = spawnPassive(w, 'normal', 595, 150, -1);
    const b = spawnPassive(w, 'normal', 760, 152, -1);
    a.recoil(1500, w.time);
    press(w, ['push']);
    advanceUntil(w, () => eventsOf(w, 'bodyCollide').length > 0, 1500);
    expect(eventsOf(w, 'bodyCollide')).toHaveLength(1);
    expect(a.health).toBe(a.maxHealth - COLLIDE_DAMAGE);
    expect(b.health).toBe(b.maxHealth - COLLIDE_DAMAGE);
    const ok = advanceUntil(w, () => a.state === CharState.Knockdown && b.state === CharState.Knockdown, 800);
    expect(ok).toBe(true);
  });

  it('shoving a non-staggered enemy only creates space and builds structure', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'normal', 565, 150, -1);
    press(w, ['push']);
    advanceSim(w, 400);
    expect(eventsOf(w, 'shove')).toHaveLength(1);
    expect(e.state).not.toBe(CharState.Pushed);
    expect(e.structure).toBeGreaterThan(0);
    expect(e.health).toBe(e.maxHealth);
  });
});
