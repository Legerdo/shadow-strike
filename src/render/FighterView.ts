import * as Phaser from 'phaser';
import { computePose } from '../anim/AnimationSystem';
import { solveSkeleton } from '../anim/Pose';
import type { Skeleton, V2 } from '../anim/Pose';
import type { Character } from '../game/Character';
import { CharState } from '../game/types';
import type { Limb } from '../game/types';
import { drawFighter, drawSilhouette, limbTip, ribbonAnchor } from './fighterDraw';
import { LOOKS, SIGNAL_COLORS, cssColor, mix } from './looks';
import type { Look } from './looks';
import type { ViewCamera } from './projection';

type Graphics = Phaser.GameObjects.Graphics;

export interface RenderCtx {
  /** Simulation time (frozen during hitstop). */
  time: number;
  /** Real time in ms. */
  real: number;
  /** Real frame delta in ms. */
  dt: number;
  hitstop: boolean;
  victoryMs: number;
  cam: ViewCamera;
}

/** Graphics shared by all fighters, cleared once per frame by the scene. */
export interface SharedGfx {
  shadows: Graphics;
  trails: Graphics;
  overlay: Graphics;
}

export type Prompt = 'finish' | 'push' | null;

interface Ghost {
  g: Graphics;
  life: number;
  max: number;
}

const GHOST_POOL = 5;
const TRAIL_MS = 120;

function star(g: Graphics, x: number, y: number, r: number, w: number, rot: number): void {
  for (let i = 0; i < 4; i++) {
    const a = rot + (i * Math.PI) / 2;
    const tx = x + Math.cos(a) * r;
    const ty = y + Math.sin(a) * r;
    const lx = x + Math.cos(a + Math.PI / 2) * w;
    const ly = y + Math.sin(a + Math.PI / 2) * w;
    const rx = x + Math.cos(a - Math.PI / 2) * w;
    const ry = y + Math.sin(a - Math.PI / 2) * w;
    g.fillTriangle(tx, ty, lx, ly, rx, ry);
  }
}

/** Renders one fighter: skeleton silhouette, shadow, trails, afterimages, telegraphs and bars. */
export class FighterView {
  readonly c: Character;
  prompt: Prompt = null;
  private readonly look: Look;
  private readonly g: Graphics;
  private readonly ghosts: Ghost[] = [];
  private ghostTimer = 0;
  private trail: { x: number; y: number; age: number }[] = [];
  private trailColor = 0xffffff;
  private readonly label: Phaser.GameObjects.Text;
  private readonly promptText: Phaser.GameObjects.Text;
  private lastPrompt: Prompt = null;
  private lastLabel = '';

  constructor(scene: Phaser.Scene, fighters: Phaser.GameObjects.Layer, overlay: Phaser.GameObjects.Layer, c: Character) {
    this.c = c;
    this.look = LOOKS[c.kind];
    for (let i = 0; i < GHOST_POOL; i++) {
      const g = scene.add.graphics();
      g.setVisible(false);
      fighters.add(g);
      this.ghosts.push({ g, life: 0, max: 1 });
    }
    this.g = scene.add.graphics();
    fighters.add(this.g);
    this.label = scene.add
      .text(0, 0, '', {
        fontFamily: '"Arial Black", Impact, sans-serif',
        fontSize: '15px',
        color: '#ffffff',
        align: 'center',
        stroke: '#000000',
        strokeThickness: 4,
        lineSpacing: -4,
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.promptText = scene.add
      .text(0, 0, '', {
        fontFamily: '"Arial Black", Impact, sans-serif',
        fontSize: '16px',
        color: '#ffe14a',
        backgroundColor: 'rgba(0,0,0,0.72)',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setVisible(false);
    overlay.add([this.label, this.promptText]);
  }

  destroy(): void {
    this.g.destroy();
    for (const gh of this.ghosts) gh.g.destroy();
    this.label.destroy();
    this.promptText.destroy();
  }

  update(ctx: RenderCtx, shared: SharedGfx): void {
    const c = this.c;
    const look = this.look;
    const anim = computePose(c, ctx);
    const sk = solveSkeleton(anim.pose);
    const height = c.h + anim.lift;
    const sp = ctx.cam.project(c.x, c.y, height);
    const sc = sp.s * look.scale;
    let ox = 0;
    if (ctx.hitstop && ctx.time - c.lastHitAt < 0.5) ox = Math.sin(ctx.real * 0.13) * 3.5;

    const g = this.g;
    g.clear();
    g.setPosition(sp.x + ox, sp.y);
    g.setScale(sc * c.facing, sc);
    g.setDepth(c.y * 10 + (c.team === 'player' ? 0.5 : 0));

    const toScreen = (p: V2): V2 => ({ x: g.x + p.x * sc * c.facing, y: g.y + p.y * sc });

    // ---- rim colour communicates state ----
    let rim = look.rim;
    const t = ctx.time;
    const atk = c.attack;
    if (c.team === 'enemy' && c.state === CharState.AttackStartup && atk && atk.data.unblockable) {
      const pulse = 0.5 + 0.5 * Math.sin(ctx.real * 0.03);
      rim = mix(look.rim, SIGNAL_COLORS[atk.data.height], 0.6 + 0.4 * pulse);
    }
    if (c.state === CharState.StructureBreak) rim = mix(0xffc233, 0xffffff, 0.5 + 0.5 * Math.sin(ctx.real * 0.02));
    if (c.team === 'player') {
      if (t < c.counterUntil) rim = 0xffe14a;
      if (c.isGuarding()) rim = c.isParryWindow(t) ? 0xffffff : 0x7fd8ff;
    }

    let alpha = 1;
    if (c.state === CharState.Dead) alpha = Math.max(0.28, Math.min(1, 1 - (t - c.deathAt - 1400) / 900));
    g.setAlpha(alpha);

    drawFighter(g, sk, look, {
      rim,
      rimAlpha: 0.92,
      flash: t < c.hitFlashUntil,
      frontLimb: anim.frontLimb,
      ribbon: this.ribbon(sk, ctx),
    });

    this.drawShadow(ctx, shared.shadows, height);
    this.updateTrail(ctx, shared.trails, sk, anim.strike, toScreen, sc);
    this.updateGhosts(ctx, sk);
    this.drawTelegraph(ctx, shared.overlay, sk, toScreen, sc);
    this.drawBars(ctx, shared.overlay);
  }

  private ribbon(sk: Skeleton, ctx: RenderCtx): V2[] | null {
    const r = this.look.ribbon;
    if (!r) return null;
    const c = this.c;
    const a = ribbonAnchor(sk);
    const speed = Math.abs(c.walkVX) + Math.abs(c.vx) + (c.state === CharState.Dodge ? 420 : 0);
    const lift = Math.min(1, speed / 300);
    const droop = 1.25 - lift * 0.95;
    const pts: V2[] = [a];
    let px = a.x;
    let py = a.y;
    for (let i = 1; i <= r.segments; i++) {
      const ang = droop + Math.sin(ctx.real * 0.011 + i * 0.9 + c.id) * 0.22 * (0.35 + lift);
      px -= Math.cos(ang) * r.length;
      py += Math.sin(ang) * r.length;
      pts.push({ x: px, y: py });
    }
    return pts;
  }

  private drawShadow(ctx: RenderCtx, sg: Graphics, height: number): void {
    const c = this.c;
    const fp = ctx.cam.project(c.x, c.y, 0);
    const lying = (c.state === CharState.Knockdown && c.knockdownPhase !== 'getup') || c.state === CharState.Dead;
    const base = c.radius * 2.5 * fp.s * (this.look.scale / 1.12);
    const w = base * (lying ? 2.1 : 1) * (1 - Math.min(0.4, height / 220));
    const a = 0.55 * (1 - Math.min(0.6, height / 90));
    const shift = lying ? -c.facing * 30 * fp.s : 0;
    sg.fillStyle(0x000000, a);
    sg.fillEllipse(fp.x + shift, fp.y, w, w * 0.3);
    if (c.alive) {
      sg.lineStyle(2, c.team === 'player' ? 0x3ef2ff : this.look.rim, c.team === 'player' ? 0.45 : 0.22);
      sg.strokeEllipse(fp.x, fp.y, base * 1.25, base * 0.38);
    }
  }

  private updateTrail(ctx: RenderCtx, tg: Graphics, sk: Skeleton, strike: number, toScreen: (p: V2) => V2, sc: number): void {
    const c = this.c;
    let limb: Limb | null = null;
    const a = c.attack;
    if (a && (c.state === CharState.AttackActive || (c.state === CharState.AttackRecovery && strike > 0.55))) {
      limb = a.data.limb;
      this.trailColor = c.team === 'player' ? 0xc8fbff : SIGNAL_COLORS[a.data.height];
    } else if (c.state === CharState.Finisher && c.finisherRole === 'attacker') {
      limb = c.stateTime > 400 && c.stateTime < 600 ? 'footF' : 'handF';
      this.trailColor = 0xffe14a;
    }
    if (limb && !ctx.hitstop) {
      const tp = toScreen(limbTip(sk, limb));
      this.trail.push({ x: tp.x, y: tp.y, age: 0 });
    }
    for (const p of this.trail) p.age += ctx.dt;
    this.trail = this.trail.filter((p) => p.age < TRAIL_MS);
    const n = this.trail.length;
    for (let i = 1; i < n; i++) {
      const p0 = this.trail[i - 1];
      const p1 = this.trail[i];
      const k = 1 - p1.age / TRAIL_MS;
      tg.lineStyle(Math.max(1, 10 * sc * k), this.trailColor, 0.55 * k);
      tg.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
  }

  private updateGhosts(ctx: RenderCtx, sk: Skeleton): void {
    const c = this.c;
    const ghosting =
      c.state === CharState.Dodge ||
      c.state === CharState.Pushed ||
      c.avoidSucceeded ||
      (c.state === CharState.Finisher && c.finisherRole === 'attacker');
    this.ghostTimer -= ctx.dt;
    if (ghosting && this.ghostTimer <= 0 && !ctx.hitstop) {
      let slot = this.ghosts[0];
      for (const gh of this.ghosts) if (gh.life < slot.life) slot = gh;
      const gg = slot.g;
      gg.clear();
      gg.setPosition(this.g.x, this.g.y);
      gg.setScale(this.g.scaleX, this.g.scaleY);
      gg.setDepth(this.g.depth - 0.2);
      const color = c.team === 'player' ? (c.state === CharState.Finisher ? 0xffe14a : 0x3ef2ff) : this.look.rim;
      drawSilhouette(gg, sk, this.look, color);
      slot.life = 220;
      slot.max = 220;
      this.ghostTimer = 38;
    }
    for (const gh of this.ghosts) {
      gh.life -= ctx.dt;
      if (gh.life <= 0) {
        gh.g.setVisible(false);
        continue;
      }
      gh.g.setVisible(true);
      gh.g.setAlpha((gh.life / gh.max) * 0.38);
    }
  }

  /** Attack wind-up signals: limb glint + timing ring for every attack, a labelled badge for HIGH/LOW. */
  private drawTelegraph(ctx: RenderCtx, o: Graphics, sk: Skeleton, toScreen: (p: V2) => V2, sc: number): void {
    const c = this.c;
    const a = c.attack;
    let labelText = '';
    if (c.team === 'enemy' && c.state === CharState.AttackStartup && a) {
      const d = a.data;
      const u = Math.max(0, Math.min(1, c.stateTime / d.startup));
      const col = SIGNAL_COLORS[d.height];
      const tip = toScreen(limbTip(sk, d.limb));

      // Danger zone in front of the attacker.
      if (d.height === 'low') {
        const p0 = ctx.cam.project(c.x + c.facing * (d.reach * 0.55 + 10), c.y, 0);
        o.fillStyle(col, 0.1 + 0.12 * u);
        o.fillEllipse(p0.x, p0.y, d.reach * 1.25 * p0.s, 26 * p0.s);
        o.lineStyle(2, col, 0.35 + 0.5 * u);
        o.strokeEllipse(p0.x, p0.y, d.reach * 1.25 * p0.s, 26 * p0.s);
      } else if (d.height === 'high') {
        const h = 132 * this.look.scale;
        const p0 = ctx.cam.project(c.x + c.facing * 20, c.y, h);
        const p1 = ctx.cam.project(c.x + c.facing * (d.reach + 30), c.y, h);
        o.lineStyle(5 * p0.s, col, 0.2 + 0.45 * u);
        o.lineBetween(p0.x, p0.y, p1.x, p1.y);
      }

      // Limb glint grows as the strike approaches.
      if (u > 0.3) {
        const k = (u - 0.3) / 0.7;
        const r = (7 + 12 * k) * sc;
        o.fillStyle(col, 0.95);
        star(o, tip.x, tip.y, r, r * 0.2, ctx.real * 0.006);
        o.fillStyle(0xffffff, 1);
        o.fillCircle(tip.x, tip.y, 2.8 * sc);
      }
      // Timing ring closes onto the limb exactly at the strike.
      o.lineStyle(2.5, col, 0.3 + 0.6 * u);
      o.strokeCircle(tip.x, tip.y, (9 + 48 * (1 - u)) * sc);

      if (d.unblockable) {
        const head = toScreen(sk.head);
        // Sit above the enemy's health/structure bars so nothing overlaps the warning.
        const barsTop = ctx.cam.project(c.x, c.y, 168 * this.look.scale).y;
        const iy = Math.min(head.y - 52 * sc, barsTop - 30);
        o.fillStyle(0x000000, 0.75);
        o.fillRoundedRect(head.x - 46, iy - 21, 92, 42, 8);
        o.lineStyle(3, col, 0.6 + 0.4 * Math.abs(Math.sin(ctx.real * 0.02)));
        o.strokeRoundedRect(head.x - 46, iy - 21, 92, 42, 8);
        labelText = d.height === 'high' ? 'HIGH ▼\nSPACE+S' : 'LOW ▲\nSPACE+W';
        this.label.setPosition(head.x, iy);
        this.label.setColor(cssColor(col));
      }
    }
    if (labelText !== this.lastLabel) {
      this.label.setText(labelText);
      this.lastLabel = labelText;
    }
    this.label.setVisible(labelText !== '');
  }

  private drawBars(ctx: RenderCtx, o: Graphics): void {
    const c = this.c;
    if (c.team !== 'enemy' || !c.alive || c.state === CharState.Finisher) {
      this.promptText.setVisible(false);
      return;
    }
    const top = ctx.cam.project(c.x, c.y, 168 * this.look.scale);
    const bw = c.kind === 'heavy' ? 78 : 58;
    const x0 = top.x - bw / 2;
    const y0 = top.y;
    o.fillStyle(0x000000, 0.65);
    o.fillRect(x0 - 2, y0 - 2, bw + 4, 14);
    o.fillStyle(0xff3b4f, 1);
    o.fillRect(x0, y0, bw * (c.health / c.maxHealth), 4);
    const st = c.structure / c.maxStructure;
    const broken = c.state === CharState.StructureBreak;
    const col = broken ? mix(0xffc233, 0xffffff, 0.5 + 0.5 * Math.sin(ctx.real * 0.025)) : st > 0.75 ? 0xffe066 : 0xe8a33a;
    o.fillStyle(col, 1);
    o.fillRect(top.x - (bw / 2) * st, y0 + 6, bw * st, 4);

    if (this.prompt) {
      if (this.prompt !== this.lastPrompt) {
        this.promptText.setText(this.prompt === 'finish' ? 'E  FINISH' : 'U  PUSH');
        this.promptText.setColor(this.prompt === 'finish' ? '#ffe14a' : '#7ff6ff');
      }
      const pulse = 1 + 0.08 * Math.sin(ctx.real * 0.015);
      this.promptText.setPosition(top.x, y0 - 22).setScale(pulse).setVisible(true);
    } else {
      this.promptText.setVisible(false);
    }
    this.lastPrompt = this.prompt;
  }
}
