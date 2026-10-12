import * as Phaser from 'phaser';
import { Sfx } from '../audio/Sfx';
import { FINISHER_RANGE_X, FINISHER_RANGE_Y, VIEW_HEIGHT, VIEW_WIDTH } from '../game/constants';
import type { GameEvent } from '../game/events';
import { GameWorld } from '../game/GameWorld';
import type { Character } from '../game/Character';
import { PLAYER_ATTACKS } from '../game/attacks';
import { CharState } from '../game/types';
import { KeyboardInput } from '../input/KeyboardInput';
import { Arena } from '../render/Arena';
import { Effects } from '../render/Effects';
import { FighterView } from '../render/FighterView';
import type { SharedGfx } from '../render/FighterView';
import { LOOKS, SIGNAL_COLORS } from '../render/looks';
import { HALF_H, HALF_W, ViewCamera } from '../render/projection';
import { Hud } from '../ui/Hud';

const KIND_NAMES: Record<string, string> = { normal: 'THUG', agile: 'VIPER', heavy: 'BRUTE' };

/**
 * Presentation + level flow. The rules live in GameWorld; this scene feeds it
 * input, advances it with real frame time and turns its events into feedback.
 */
export class GameScene extends Phaser.Scene {
  world!: GameWorld;
  private input2!: KeyboardInput;
  private sfx!: Sfx;
  private view!: ViewCamera;
  private arena!: Arena;
  private effects!: Effects;
  private hud!: Hud;
  private shared!: SharedGfx;
  private fightersLayer!: Phaser.GameObjects.Layer;
  private overlayLayer!: Phaser.GameObjects.Layer;
  private views = new Map<number, FighterView>();
  private real = 0;
  private victoryAt = -1;
  private zoom = 1;
  private focusX = HALF_W;
  private focusY = HALF_H;
  private vignette!: Phaser.GameObjects.Graphics;
  private finisherFx = 0;

  constructor() {
    super('game');
  }

  create(): void {
    this.world = new GameWorld({ seed: (Date.now() & 0xffff) ^ 0x5a5a });
    this.view = new ViewCamera();
    this.sfx = new Sfx();
    this.input2 = new KeyboardInput(window);
    this.input2.onKey((code) => {
      this.sfx.unlock();
      if (code === 'KeyM') this.hud.setMuted(this.sfx.toggleMute());
    });

    // Layer order (back to front).
    const back = this.add.layer();
    const shadowLayer = this.add.layer();
    this.fightersLayer = this.add.layer();
    const trailLayer = this.add.layer();
    const fxLayer = this.add.layer();
    const fore = this.add.layer();
    this.overlayLayer = this.add.layer(); // telegraphs + bars: always above effects
    const uiLayer = this.add.layer();

    this.arena = new Arena(this, back, fore);
    const shadows = this.add.graphics();
    shadowLayer.add(shadows);
    const trails = this.add.graphics();
    trailLayer.add(trails);
    const overlay = this.add.graphics();
    this.overlayLayer.add(overlay);
    this.shared = { shadows, trails, overlay };
    this.effects = new Effects(this, fxLayer);
    this.vignette = this.add.graphics();
    uiLayer.add(this.vignette);
    this.hud = new Hud(this, uiLayer);
    this.hud.setMuted(false);

    // Separate UI camera so screen shake / finisher zoom never move the HUD.
    const main = this.cameras.main;
    main.setBackgroundColor('#05040a');
    main.ignore(uiLayer);
    const uiCam = this.cameras.add(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    uiCam.ignore([back, shadowLayer, this.fightersLayer, trailLayer, fxLayer, fore, this.overlayLayer]);

    this.view.snap(this.world.player.x);
    this.syncViews();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input2.destroy();
      this.sfx.destroy();
    });

    // Debug / automation hook (read-only snapshot + world handle for smoke tests).
    (window as unknown as { __SHADOW_STRIKE__: unknown }).__SHADOW_STRIKE__ = {
      world: this.world,
      snapshot: () => this.world.snapshot(),
      fps: () => this.game.loop.actualFps,
    };
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100);
    this.real += dt;
    const w = this.world;
    const frame = this.input2.poll();
    w.update(dt, frame);

    for (const e of w.drainEvents()) this.handleEvent(e);
    this.syncViews();

    // Camera: follow the player, biased towards the action.
    const p = w.player;
    let target = p.x + p.facing * 60;
    if (w.phase === 'ready') target = p.x;
    this.view.update(dt, target);
    this.arena.update(this.view, dt, this.real);

    const victoryMs = this.victoryAt >= 0 ? this.real - this.victoryAt : -1;
    const ctx = { time: w.time, real: this.real, dt, hitstop: w.hitstop > 0, victoryMs, cam: this.view };
    this.shared.shadows.clear();
    this.shared.trails.clear();
    this.shared.overlay.clear();
    const finTarget = w.phase === 'playing' ? w.findFinisherTarget() : undefined;
    for (const v of this.views.values()) {
      v.prompt = this.promptFor(v.c, finTarget);
      v.update(ctx, this.shared);
    }
    this.fightersLayer.sort('depth');

    this.effects.update(dt, this.view, w.hitstop > 0);
    this.updateFinisherCamera(dt);
    this.hud.update(w, dt, this.real);
  }

  private promptFor(e: Character, finTarget: Character | undefined): 'finish' | 'push' | null {
    if (e.team !== 'enemy') return null;
    if (e.state === CharState.StructureBreak) {
      const p = this.world.player;
      const near = Math.abs(e.x - p.x) <= FINISHER_RANGE_X && Math.abs(e.y - p.y) <= FINISHER_RANGE_Y;
      return near || e === finTarget ? 'finish' : null;
    }
    if (e.state === CharState.HitStun && e.stateDuration >= 380) {
      const p = this.world.player;
      const push = PLAYER_ATTACKS.push;
      if (Math.abs(e.x - p.x) - e.radius <= push.reach + push.lunge && Math.abs(e.y - p.y) <= push.depth) return 'push';
    }
    return null;
  }

  private syncViews(): void {
    const chars = this.world.characters;
    const ids = new Set<number>();
    for (const c of chars) {
      ids.add(c.id);
      const existing = this.views.get(c.id);
      if (existing && existing.c !== c) {
        existing.destroy();
        this.views.delete(c.id);
      }
      if (!this.views.has(c.id)) this.views.set(c.id, new FighterView(this, this.fightersLayer, this.overlayLayer, c));
    }
    for (const [id, v] of this.views) {
      if (!ids.has(id)) {
        v.destroy();
        this.views.delete(id);
      }
    }
  }

  private updateFinisherCamera(dt: number): void {
    const w = this.world;
    const target = w.finisherActive ? 1.16 : 1;
    const k = 1 - Math.exp(-dt / (w.finisherActive ? 70 : 160));
    this.zoom += (target - this.zoom) * k;
    this.finisherFx += ((w.finisherActive ? 1 : 0) - this.finisherFx) * k;
    const main = this.cameras.main;
    main.setZoom(this.zoom);
    // Keep the focus point inside the drawable area at the current zoom.
    const maxShiftX = HALF_W * (1 - 1 / this.zoom);
    const maxShiftY = HALF_H * (1 - 1 / this.zoom);
    const sx = Phaser.Math.Clamp(this.focusX - HALF_W, -maxShiftX, maxShiftX);
    const sy = Phaser.Math.Clamp(this.focusY - HALF_H, -maxShiftY, maxShiftY);
    main.setScroll(sx, sy);

    const v = this.vignette;
    v.clear();
    if (this.finisherFx > 0.01) {
      const a = this.finisherFx;
      v.fillStyle(0x000000, 0.85 * a);
      v.fillRect(0, 0, VIEW_WIDTH, 70 * a);
      v.fillRect(0, VIEW_HEIGHT - 70 * a, VIEW_WIDTH, 70 * a);
    }
  }

  private shake(ms: number, intensity: number): void {
    this.cameras.main.shake(ms, intensity, true);
  }

  // ---------------------------------------------------------------------------
  // Game events -> feedback
  // ---------------------------------------------------------------------------

  private handleEvent(e: GameEvent): void {
    const fx = this.effects;
    const w = this.world;
    const isPlayer = (id: number) => id === w.player.id;
    switch (e.type) {
      case 'hit': {
        const byPlayer = isPlayer(e.attackerId);
        const color = byPlayer ? (e.counter ? 0xffe14a : 0xc8fbff) : 0xff3b4f;
        fx.sparks(e.x, e.y, e.h, e.dir, color, e.heavy ? 16 : 9, e.heavy ? 1.3 : 1);
        fx.flash(e.x, e.y, e.h, color, e.heavy ? 46 : 30);
        if (e.heavy) fx.streaks(e.x, e.y, e.h, e.dir, color, 5);
        this.sfx.play(e.counter ? 'counter' : e.heavy ? 'hitHeavy' : 'hit');
        if (byPlayer) {
          if (e.tag === 'counter') fx.text(e.x, e.y, e.h + 30, 'COUNTER', '#ffe14a', 22);
          else if (e.tag === 'interrupt') fx.text(e.x, e.y, e.h + 30, 'INTERRUPT', '#7ff6ff', 18);
          else if (e.tag === 'armored') fx.text(e.x, e.y, e.h + 30, 'ARMOR', '#ffc233', 16);
          this.shake(e.heavy ? 130 : 70, e.heavy ? 0.006 : 0.0025);
        } else {
          if (e.tag === 'unblockable') fx.text(e.x, e.y, e.h + 30, 'UNBLOCKABLE', '#ff7a1a', 18);
          this.shake(150, e.heavy ? 0.01 : 0.006);
          this.cameras.main.flash(90, 120, 0, 20, false);
        }
        break;
      }
      case 'block':
        fx.sparks(e.x, e.y, e.h, -e.dir, 0x7fd8ff, 7, 0.8);
        fx.ring(e.x, e.y, e.h, 0x7fd8ff, 22, 200);
        this.sfx.play('block');
        if (isPlayer(e.targetId)) fx.text(e.x, e.y, e.h + 26, 'GUARD', '#7fd8ff', 16, 500);
        break;
      case 'parry':
        fx.flash(e.x, e.y, e.h, 0xffffff, 64, 160);
        fx.ring(e.x, e.y, e.h, 0xffffff, 46, 320);
        fx.sparks(e.x, e.y, e.h, -e.dir, 0xffffff, 14, 1.2);
        this.sfx.play('parry');
        this.shake(90, 0.004);
        fx.text(e.x, e.y, e.h + 34, isPlayer(e.targetId) ? 'PARRY!' : 'PARRIED', isPlayer(e.targetId) ? '#ffffff' : '#ff9a9a', 26);
        break;
      case 'avoid': {
        const col = SIGNAL_COLORS[e.height];
        fx.ring(e.x, e.y, e.h, col, 36, 300);
        this.sfx.play('avoid');
        if (isPlayer(e.targetId)) fx.text(e.x, e.y, e.h + 40, e.height === 'high' ? 'DUCKED!' : 'JUMPED!', e.height === 'high' ? '#ff9a4a' : '#7ff6ff', 24);
        break;
      }
      case 'wrongAvoid':
        this.sfx.play('wrong');
        if (isPlayer(e.targetId)) fx.text(e.x, e.y, e.h + 50, 'WRONG WAY!', '#ff3b4f', 22);
        break;
      case 'dodged':
        if (isPlayer(e.targetId)) fx.text(e.x, e.y, 120, 'EVADE', '#3ef2ff', 18, 500);
        break;
      case 'dodge':
        fx.dust(e.x, e.y, 5);
        fx.splash(e.x, e.y, 6);
        this.sfx.play('dodge');
        break;
      case 'avoidStart':
        this.sfx.play('dodge');
        break;
      case 'guardBreak':
        fx.flash(e.x, e.y, e.h, 0xffc233, 60, 200);
        fx.text(e.x, e.y, e.h + 40, 'GUARD BREAK', '#ffc233', 24);
        this.sfx.play('guardBreak');
        this.shake(200, 0.01);
        break;
      case 'structureBreak': {
        const c = w.getCharacter(e.id);
        fx.ring(e.x, e.y, 100, 0xffc233, 70, 450);
        fx.flash(e.x, e.y, 110, 0xffe14a, 70, 220);
        this.sfx.play('break');
        this.shake(160, 0.007);
        if (c && c.team === 'enemy') fx.text(e.x, e.y, 200, 'BROKEN!  [E]', '#ffe14a', 26, 1100);
        else fx.text(e.x, e.y, 200, 'POSTURE BROKEN', '#ffc233', 22, 1000);
        break;
      }
      case 'structureRecover':
        break;
      case 'attackStart':
        if (e.isPlayer) {
          const heavy = e.attackId === 'p_h1' || e.attackId === 'p_h2' || e.attackId === 'p_l3';
          this.sfx.play(heavy ? 'whooshHeavy' : 'whoosh');
          if (e.counter) fx.ring(e.x, e.y, 100, 0xffe14a, 30, 220);
        } else if (e.unblockable) {
          this.sfx.play(e.height === 'high' ? 'telegraphHigh' : 'telegraphLow');
        }
        break;
      case 'whiff':
        break;
      case 'pushLaunch':
        fx.streaks(e.x, e.y, e.h, e.dir, 0x7ff6ff, 8);
        fx.ring(e.x, e.y, e.h, 0x7ff6ff, 40, 260);
        this.sfx.play('push');
        this.shake(110, 0.006);
        break;
      case 'shove':
        fx.ring(e.x, e.y, e.h, 0xc8fbff, 24, 200);
        this.sfx.play('block');
        break;
      case 'wallSlam':
        fx.sparks(e.x, e.y, e.h, e.wall === 'left' ? 1 : -1, 0xffffff, 20, 1.4);
        fx.flash(e.x, e.y, e.h, 0xffffff, 80, 180);
        fx.dust(e.x, e.y, 10);
        fx.text(e.x, e.y, 190, 'WALL SLAM!', '#ff3fd2', 28, 1000);
        this.sfx.play('wall');
        this.shake(260, 0.016);
        break;
      case 'bodyCollide':
        fx.sparks(e.x, e.y, e.h, 1, 0xffd23f, 12, 1.1);
        fx.sparks(e.x, e.y, e.h, -1, 0xffd23f, 12, 1.1);
        fx.flash(e.x, e.y, e.h, 0xffd23f, 70, 180);
        fx.text(e.x, e.y, 190, 'COLLISION!', '#ffd23f', 26, 1000);
        this.sfx.play('collide');
        this.shake(220, 0.012);
        break;
      case 'knockdown':
        break;
      case 'land':
        fx.dust(e.x, e.y, 9);
        fx.splash(e.x, e.y, 12);
        this.sfx.play('thud');
        this.shake(80, 0.003);
        break;
      case 'getUp':
        break;
      case 'finisherStart': {
        const p = this.view.project(e.x, e.y, e.h);
        this.focusX = p.x;
        this.focusY = p.y;
        fx.ring(e.x, e.y, e.h, 0xffe14a, 60, 300);
        break;
      }
      case 'finisherHit':
        fx.sparks(e.x, e.y, e.h, w.player.facing, 0xffe14a, e.final ? 26 : 12, e.final ? 1.6 : 1.1);
        fx.flash(e.x, e.y, e.h, e.final ? 0xffffff : 0xffe14a, e.final ? 110 : 50, e.final ? 260 : 140);
        if (e.final) {
          fx.streaks(e.x, e.y, e.h, w.player.facing, 0xffe14a, 12);
          fx.ring(e.x, e.y, e.h, 0xffffff, 90, 420);
          fx.text(e.x, e.y, 210, 'FINISH!', '#ffe14a', 40, 1200);
          this.sfx.play('finisherFinal');
          this.shake(320, 0.018);
        } else {
          this.sfx.play('finisher');
          this.shake(90, 0.006);
        }
        break;
      case 'death': {
        if (e.id !== w.player.id) this.sfx.play('death');
        break;
      }
      case 'combo':
        break;
      case 'waveStart': {
        const names = e.kinds.map((k) => KIND_NAMES[k] ?? k).join(' · ');
        this.hud.showBanner(e.wave === e.total ? 'FINAL WAVE' : `WAVE ${e.wave}`, names, e.wave === e.total ? '#ff3b4f' : '#3ef2ff', 1900);
        this.sfx.play('wave');
        break;
      }
      case 'waveClear':
        if (e.wave < e.total) this.hud.showBanner('WAVE CLEAR', '체력 회복 +20', '#ffe14a', 1700);
        break;
      case 'victory':
        this.victoryAt = this.real;
        this.sfx.play('victory');
        break;
      case 'defeat':
        this.sfx.play('defeat');
        this.cameras.main.flash(300, 160, 0, 0, false);
        break;
      case 'reset':
      case 'start':
        this.effects.clear();
        this.hud.reset();
        this.victoryAt = -1;
        this.view.snap(w.player.x);
        if (e.type === 'start') this.sfx.play('ui');
        break;
    }
  }
}

// Ensure looks are referenced for tree-shaking sanity checks (all fighters must have a look).
export const LOOK_KINDS = Object.keys(LOOKS);
