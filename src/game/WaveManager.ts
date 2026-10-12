import { ARENA_DEPTH, ARENA_WIDTH, DEATH_SETTLE_MS, WAVE_CLEAR_MS, WAVE_INTRO_MS } from './constants';
import type { Character } from './Character';
import type { EnemyKind } from './types';
import type { GameEvent } from './events';

export const DEFAULT_WAVES: readonly (readonly EnemyKind[])[] = [
  ['normal', 'normal'],
  ['normal', 'normal', 'agile'],
  ['normal', 'agile', 'heavy'],
];

export type WavePhase = 'idle' | 'intro' | 'fight' | 'clear' | 'complete';

export interface WaveWorld {
  readonly time: number;
  readonly player: Character;
  readonly enemies: readonly Character[];
  spawnEnemy(kind: EnemyKind, x: number, y: number, opts?: { thinkDelay?: number }): Character;
  removeDeadEnemies(): void;
  onWaveCleared(wave: number): void;
  onAllWavesComplete(): void;
  emit(e: GameEvent): void;
}

/** Drives the three-wave encounter: intro -> fight -> clear -> next / complete. */
export class WaveManager {
  readonly waves: readonly (readonly EnemyKind[])[];
  index = -1;
  phase: WavePhase = 'idle';
  timer = 0;
  private readonly w: WaveWorld;

  constructor(world: WaveWorld, waves: readonly (readonly EnemyKind[])[] = DEFAULT_WAVES) {
    this.w = world;
    this.waves = waves;
  }

  get total(): number {
    return this.waves.length;
  }

  /** 1-based wave number for display (0 before the first wave). */
  get waveNumber(): number {
    return this.index + 1;
  }

  reset(): void {
    this.index = -1;
    this.phase = 'idle';
    this.timer = 0;
  }

  start(): void {
    this.beginWave(0);
  }

  update(dt: number): void {
    if (this.phase === 'idle' || this.phase === 'complete') return;
    this.timer += dt;
    switch (this.phase) {
      case 'intro':
        if (this.allDefeated()) this.clearWave();
        else if (this.timer >= WAVE_INTRO_MS) {
          this.phase = 'fight';
          this.timer = 0;
        }
        break;
      case 'fight':
        if (this.allDefeated()) this.clearWave();
        break;
      case 'clear':
        if (this.timer >= WAVE_CLEAR_MS) {
          if (this.index + 1 < this.waves.length) this.beginWave(this.index + 1);
          else {
            this.phase = 'complete';
            this.w.onAllWavesComplete();
          }
        }
        break;
      default:
        break;
    }
  }

  private allDefeated(): boolean {
    const list = this.w.enemies;
    if (list.length === 0) return false;
    const now = this.w.time;
    return list.every((e) => !e.alive && now - e.deathAt >= DEATH_SETTLE_MS);
  }

  private clearWave(): void {
    this.phase = 'clear';
    this.timer = 0;
    this.w.onWaveCleared(this.index + 1);
    this.w.emit({ type: 'waveClear', wave: this.index + 1, total: this.waves.length });
  }

  private beginWave(i: number): void {
    this.index = i;
    this.phase = 'intro';
    this.timer = 0;
    this.w.removeDeadEnemies();
    const kinds = this.waves[i];
    kinds.forEach((kind, k) => {
      const pos = this.spawnPoint(k, kinds.length);
      this.w.spawnEnemy(kind, pos.x, pos.y, { thinkDelay: 1100 + k * 500 });
    });
    this.w.emit({ type: 'waveStart', wave: i + 1, total: this.waves.length, kinds });
  }

  /** Alternate sides, always keeping a safe distance from the player. */
  private spawnPoint(k: number, n: number): { x: number; y: number } {
    const px = this.w.player.x;
    const far: 1 | -1 = px < ARENA_WIDTH / 2 ? 1 : -1;
    let side: 1 | -1 = k % 2 === 0 ? far : (-far as 1 | -1);
    const edgeX = (s: number) => (s > 0 ? ARENA_WIDTH - 70 : 70);
    if (Math.abs(edgeX(side) - px) < 420) side = far;
    const lane = n <= 1 ? 0.5 : 0.2 + (0.6 * k) / (n - 1);
    const x = edgeX(side) - side * (k >= 2 ? 90 : 0);
    return { x, y: ARENA_DEPTH * lane };
  }
}
