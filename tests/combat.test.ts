import { describe, expect, it } from 'vitest';
import { PLAYER_ATTACKS } from '../src/game/attacks';
import { attackReaches } from '../src/game/CombatSystem';
import { STUN_CHAIN_LIMIT } from '../src/game/constants';
import { CharState } from '../src/game/types';
import { advanceSim, advanceUntil, eventsOf, placePlayer, press, sandbox, spawnPassive } from './helpers';

describe('hit detection', () => {
  it('does not damage an enemy outside the attack reach', () => {
    const w = sandbox();
    const p = placePlayer(w, 500, 150, 1);
    const jab = PLAYER_ATTACKS.light1;
    // Beyond reach + lunge + body radius, with margin.
    const e = spawnPassive(w, 'normal', p.x + jab.reach + jab.lunge + 23 + 30, 150);
    press(w, ['light']);
    advanceSim(w, 500);
    expect(e.health).toBe(e.maxHealth);
    expect(eventsOf(w, 'hit')).toHaveLength(0);
    expect(eventsOf(w, 'whiff').length).toBeGreaterThan(0);
  });

  it('damages an enemy inside the attack reach (control case)', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'normal', 560, 150);
    press(w, ['light']);
    advanceSim(w, 400);
    expect(e.health).toBe(e.maxHealth - PLAYER_ATTACKS.light1.damage);
  });

  it('misses an enemy that is close on screen but on a different depth lane', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    // Same X distance as the control case, but 60 units deeper (beyond depth band + assist).
    const far = spawnPassive(w, 'normal', 560, 210);
    press(w, ['light']);
    advanceSim(w, 400);
    expect(far.health).toBe(far.maxHealth);
    expect(eventsOf(w, 'hit')).toHaveLength(0);

    // A small depth offset inside the band still connects.
    const w2 = sandbox();
    placePlayer(w2, 500, 150, 1);
    const near = spawnPassive(w2, 'normal', 560, 165);
    press(w2, ['light']);
    advanceSim(w2, 400);
    expect(near.health).toBeLessThan(near.maxHealth);
  });

  it('pure reach test respects facing, reach and depth', () => {
    const att = { x: 0, y: 100, facing: 1 };
    const data = { reach: 70, depth: 26 };
    expect(attackReaches(att, { x: 80, y: 100, facing: -1, radius: 22 }, data)).toBe(true);
    expect(attackReaches(att, { x: 120, y: 100, facing: -1, radius: 22 }, data)).toBe(false); // too far
    expect(attackReaches(att, { x: -60, y: 100, facing: 1, radius: 22 }, data)).toBe(false); // behind
    expect(attackReaches(att, { x: 60, y: 140, facing: -1, radius: 22 }, data)).toBe(false); // other lane
    expect(attackReaches(att, { x: 60, y: 120, facing: -1, radius: 22 }, data)).toBe(true);
  });

  it('a single attack instance hits each target only once', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'normal', 560, 150);
    e.x = 560;
    press(w, ['light']);
    // Step through the whole move in small increments; the target stays in range throughout.
    for (let i = 0; i < 80; i++) {
      advanceSim(w, 5);
      e.vx = 0; // keep the target inside the hitbox for the whole active window
      e.x = 560;
    }
    const hits = eventsOf(w, 'hit').filter((h) => h.targetId === e.id);
    expect(hits).toHaveLength(1);
    expect(e.health).toBe(e.maxHealth - PLAYER_ATTACKS.light1.damage);
  });

  it('enemies never damage each other', () => {
    const w = sandbox();
    placePlayer(w, 200, 50, 1);
    const a = spawnPassive(w, 'normal', 600, 150, 1);
    const b = spawnPassive(w, 'normal', 660, 150, -1);
    w.enemyStartAttack(a, a.arch.plans[0].attacks[0]);
    advanceSim(w, 900);
    expect(b.health).toBe(b.maxHealth);
  });
});

describe('combos and input buffer', () => {
  it('chains the three-hit light combo from buffered presses', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'heavy', 565, 150);
    press(w, ['light']);
    advanceSim(w, 100);
    press(w, ['light']); // pressed during L1 active -> buffered
    advanceUntil(w, () => w.player.attack?.data.id === 'p_l2', 600);
    advanceSim(w, 100);
    press(w, ['light']);
    advanceUntil(w, () => w.player.attack?.data.id === 'p_l3', 800);
    const started = eventsOf(w, 'attackStart')
      .filter((s) => s.isPlayer)
      .map((s) => s.attackId);
    expect(started).toEqual(['p_l1', 'p_l2', 'p_l3']);
    expect(e.health).toBeLessThan(e.maxHealth);
  });

  it('heavy chain goes palm -> spinning kick', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    spawnPassive(w, 'heavy', 570, 150);
    press(w, ['heavy']);
    advanceSim(w, 250);
    press(w, ['heavy']);
    advanceUntil(w, () => w.player.attack?.data.id === 'p_h2', 1200);
    const started = eventsOf(w, 'attackStart')
      .filter((s) => s.isPlayer)
      .map((s) => s.attackId);
    expect(started).toEqual(['p_h1', 'p_h2']);
  });

  it('prevents infinite stun chains', () => {
    const w = sandbox();
    const e = spawnPassive(w, 'normal', 700, 150);
    const durations: number[] = [];
    for (let i = 0; i < STUN_CHAIN_LIMIT + 1; i++) {
      durations.push(e.applyHitStun(300, w.time));
      advanceSim(w, 50);
    }
    // Diminishing durations, then immunity.
    for (let i = 1; i < STUN_CHAIN_LIMIT; i++) expect(durations[i]).toBeLessThan(durations[i - 1]);
    expect(durations[STUN_CHAIN_LIMIT]).toBe(0);
    expect(e.applyHitStun(300, w.time)).toBe(0);
  });

  it('a real light-attack loop cannot keep an enemy staggered forever', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    const t = spawnPassive(w, 'normal', 560, 150);
    t.health = 10_000;
    let immuneSeen = false;
    for (let i = 0; i < 40; i++) {
      press(w, ['light']);
      advanceSim(w, 90);
      t.x = 560;
      t.vx = 0;
      if (w.time < t.stunImmuneUntil) immuneSeen = true;
    }
    expect(immuneSeen).toBe(true);
  });

  it('runs at the same speed regardless of render frame rate', () => {
    const run = (frameMs: number) => {
      const w = sandbox();
      placePlayer(w, 300, 100, 1);
      while (w.time < 1000) {
        w.update(frameMs, { up: false, down: true, left: false, right: true, guard: false, pressed: [] });
      }
      return { vx: (w.player.x - 300) / w.time, vy: (w.player.y - 100) / w.time };
    };
    const a = run(1000 / 60);
    const b = run(1000 / 144);
    const c = run(1000 / 30);
    expect(a.vx).toBeGreaterThan(0.15);
    expect(Math.abs(a.vx - b.vx)).toBeLessThan(1e-3);
    expect(Math.abs(a.vy - b.vy)).toBeLessThan(1e-3);
    expect(Math.abs(a.vx - c.vx)).toBeLessThan(1e-3);
  });

  it('same attack timeline at 30, 60 and 144 fps produces the same outcome', () => {
    const run = (frameMs: number) => {
      const w = sandbox();
      placePlayer(w, 500, 150, 1);
      const e = spawnPassive(w, 'normal', 562, 150);
      w.update(frameMs, { up: false, down: false, left: false, right: false, guard: false, pressed: ['heavy'] });
      while (w.time < 1500) w.update(frameMs, { up: false, down: false, left: false, right: false, guard: false, pressed: [] });
      return { hp: e.health, lost: e.maxHealth - e.health, structure: Math.round(e.structure), state: w.player.state };
    };
    const a = run(1000 / 30);
    expect(run(1000 / 60)).toEqual(a);
    expect(run(1000 / 144)).toEqual(a);
    expect(a.lost).toBe(PLAYER_ATTACKS.heavy1.damage);
  });

  it('player state machine returns to Idle after an attack', () => {
    const w = sandbox();
    placePlayer(w, 500, 150, 1);
    press(w, ['heavy']);
    expect(w.player.state).toBe(CharState.AttackStartup);
    advanceSim(w, 1200);
    expect(w.player.state).toBe(CharState.Idle);
  });
});
