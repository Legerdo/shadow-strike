import { describe, expect, it } from 'vitest';
import { ENEMY_ATTACKS } from '../src/game/attacks';
import { DEATH_SETTLE_MS, MAX_ATTACK_TOKENS, SIM_STEP_MS, WAVE_CLEAR_MS } from '../src/game/constants';
import { GameWorld } from '../src/game/GameWorld';
import { CharState } from '../src/game/types';
import { advanceSim, advanceUntil, eventsOf, frame, placePlayer, press, sandbox, spawnPassive } from './helpers';

const kinds = (w: GameWorld) => w.enemies.map((e) => e.kind);

function clearCurrentWave(w: GameWorld): void {
  w.debugKillAllEnemies();
  advanceSim(w, DEATH_SETTLE_MS + WAVE_CLEAR_MS + 200);
}

describe('wave progression', () => {
  it('starts from the title phase only when start is pressed', () => {
    const w = new GameWorld({ seed: 3 });
    expect(w.phase).toBe('ready');
    w.update(SIM_STEP_MS, frame({}, ['light']));
    expect(w.phase).toBe('ready');
    w.update(SIM_STEP_MS, frame({}, ['start']));
    expect(w.phase).toBe('playing');
    expect(w.waves.waveNumber).toBe(1);
  });

  it('runs wave 1 -> 2 -> 3 with the specified rosters, then victory', () => {
    const w = new GameWorld({ seed: 3 });
    w.start();
    expect(w.waves.waveNumber).toBe(1);
    expect(kinds(w)).toEqual(['normal', 'normal']);

    clearCurrentWave(w);
    expect(w.waves.waveNumber).toBe(2);
    expect(kinds(w)).toEqual(['normal', 'normal', 'agile']);
    expect(w.phase).toBe('playing');

    clearCurrentWave(w);
    expect(w.waves.waveNumber).toBe(3);
    expect(kinds(w)).toEqual(['normal', 'agile', 'heavy']);

    clearCurrentWave(w);
    expect(w.phase).toBe('victory');
    expect(eventsOf(w, 'victory')).toHaveLength(1);
    expect(eventsOf(w, 'waveStart').map((e) => e.wave)).toEqual([1, 2, 3]);
    expect(eventsOf(w, 'waveClear').map((e) => e.wave)).toEqual([1, 2, 3]);
    expect(w.stats.kills).toBe(8);
  });

  it('a wave does not clear while an enemy is still alive', () => {
    const w = new GameWorld({ seed: 3 });
    w.start();
    w.enemies[0].die(w.time);
    advanceSim(w, DEATH_SETTLE_MS + WAVE_CLEAR_MS + 200);
    expect(w.waves.waveNumber).toBe(1);
    expect(w.waves.phase === 'intro' || w.waves.phase === 'fight').toBe(true);
  });

  it('enemies spawn away from the player', () => {
    const w = new GameWorld({ seed: 3 });
    w.start();
    for (const e of w.enemies) expect(Math.abs(e.x - w.player.x)).toBeGreaterThan(300);
  });
});

describe('defeat, victory and restart', () => {
  it('real enemy damage can defeat the player, then R restarts from wave 1', () => {
    const w = sandbox();
    const p = placePlayer(w, 500, 150, 1);
    const e = spawnPassive(w, 'normal', 575, 150, -1);
    p.health = 5;
    w.enemyStartAttack(e, ENEMY_ATTACKS.thugJab);
    advanceUntil(w, () => w.phase === 'defeat', 1500);
    expect(w.phase).toBe('defeat');
    expect(p.state).toBe(CharState.Dead);
    expect(eventsOf(w, 'defeat')).toHaveLength(1);

    press(w, ['restart']);
    expect(w.phase).toBe('playing');
    expect(w.player).not.toBe(p);
    expect(w.player.health).toBe(w.player.maxHealth);
    expect(w.player.structure).toBe(0);
    expect(w.waves.waveNumber).toBe(1);
    expect(kinds(w)).toEqual(['normal', 'normal']);
    expect(w.stats.kills).toBe(0);
  });

  it('restart input is ignored while still playing', () => {
    const w = new GameWorld({ seed: 3 });
    w.start();
    w.enemies[0].health = 10;
    press(w, ['restart']);
    expect(w.enemies[0].health).toBe(10);
  });

  it('can restart after victory and play again', () => {
    const w = new GameWorld({ seed: 4 });
    w.start();
    clearCurrentWave(w);
    clearCurrentWave(w);
    clearCurrentWave(w);
    expect(w.phase).toBe('victory');
    press(w, ['restart']);
    expect(w.phase).toBe('playing');
    expect(w.waves.waveNumber).toBe(1);
    expect(w.enemies).toHaveLength(2);
    clearCurrentWave(w);
    expect(w.waves.waveNumber).toBe(2);
  });

  it('can restart after defeat a second time (repeatable)', () => {
    const w = new GameWorld({ seed: 5 });
    for (let run = 0; run < 2; run++) {
      if (run === 0) w.start();
      w.debugSetPlayerHealth(0);
      advanceSim(w, 50);
      expect(w.phase).toBe('defeat');
      press(w, ['restart']);
      expect(w.phase).toBe('playing');
      expect(w.player.alive).toBe(true);
    }
  });
});

describe('enemy AI and attack tokens', () => {
  it('never lets more than two enemies attack at the same time', () => {
    const w = sandbox({ seed: 9 });
    const p = placePlayer(w, 780, 150, 1);
    p.health = 1e9; // stress test: keep the player alive the whole time
    w.spawnEnemy('normal', 560, 100, { thinkDelay: 0 });
    w.spawnEnemy('normal', 1000, 200, { thinkDelay: 0 });
    w.spawnEnemy('agile', 600, 250, { thinkDelay: 0 });
    w.spawnEnemy('heavy', 980, 60, { thinkDelay: 0 });
    let maxAttacking = 0;
    let startedAttacks = 0;
    for (let i = 0; i < 30 * 120; i++) {
      w.update(SIM_STEP_MS, frame());
      const n = w.attackingEnemies();
      maxAttacking = Math.max(maxAttacking, n);
      expect(n).toBeLessThanOrEqual(MAX_ATTACK_TOKENS);
      expect(w.tokens.count).toBeLessThanOrEqual(MAX_ATTACK_TOKENS);
    }
    startedAttacks = eventsOf(w, 'attackStart').filter((a) => !a.isPlayer).length;
    expect(startedAttacks).toBeGreaterThan(10);
    expect(maxAttacking).toBeGreaterThanOrEqual(1);
  });

  it('enemies telegraph: high and low attacks are flagged unblockable', () => {
    for (const a of Object.values(ENEMY_ATTACKS)) {
      if (a.height !== 'mid') expect(a.unblockable).toBe(true);
      expect(a.startup).toBeGreaterThanOrEqual(200);
    }
  });

  it('AI approaches, attacks and damages an idle player', () => {
    const w = sandbox({ seed: 11 });
    const p = placePlayer(w, 780, 150, 1);
    w.spawnEnemy('normal', 1100, 150, { thinkDelay: 0 });
    advanceSim(w, 8000);
    expect(p.health).toBeLessThan(p.maxHealth);
  });
});
