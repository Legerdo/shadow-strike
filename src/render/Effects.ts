import * as Phaser from 'phaser';
import type { ViewCamera } from './projection';

type Graphics = Phaser.GameObjects.Graphics;

interface Particle {
  /** World anchor so particles stay attached to the arena while the camera moves. */
  wx: number;
  wy: number;
  /** Screen-space offset from the anchor. */
  ox: number;
  oy: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  life: number;
  max: number;
  size: number;
  color: number;
  kind: 'spark' | 'dot' | 'ring' | 'flash' | 'streak';
  rot: number;
}

interface FloatText {
  t: Phaser.GameObjects.Text;
  wx: number;
  wy: number;
  h: number;
  life: number;
  max: number;
  rise: number;
}

const MAX_PARTICLES = 420;

/** Lightweight particle / floating text system drawn with one Graphics object. */
export class Effects {
  private readonly g: Graphics;
  private readonly scene: Phaser.Scene;
  private readonly layer: Phaser.GameObjects.Layer;
  private particles: Particle[] = [];
  private texts: FloatText[] = [];

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.scene = scene;
    this.layer = layer;
    this.g = scene.add.graphics();
    layer.add(this.g);
  }

  clear(): void {
    this.particles = [];
    for (const t of this.texts) t.t.destroy();
    this.texts = [];
  }

  private add(p: Particle): void {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  /** Radial burst of sparks at a world point (h = height above floor). */
  sparks(wx: number, wy: number, h: number, dir: number, color: number, count: number, power = 1): void {
    for (let i = 0; i < count; i++) {
      const spread = Phaser.Math.FloatBetween(-1.1, 1.1);
      const a = (dir >= 0 ? 0 : Math.PI) + spread;
      const sp = Phaser.Math.FloatBetween(220, 620) * power;
      this.add({
        wx, wy, ox: 0, oy: -h,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
        gravity: 900, drag: 3.2,
        life: 0, max: Phaser.Math.FloatBetween(180, 360),
        size: Phaser.Math.FloatBetween(2, 4.5) * power, color, kind: 'spark', rot: 0,
      });
    }
  }

  dust(wx: number, wy: number, count: number, color = 0x9a93b8): void {
    for (let i = 0; i < count; i++) {
      const a = Phaser.Math.FloatBetween(Math.PI * 1.05, Math.PI * 1.95);
      const sp = Phaser.Math.FloatBetween(60, 200);
      this.add({
        wx, wy, ox: Phaser.Math.FloatBetween(-20, 20), oy: 0,
        vx: Math.cos(a) * sp * (Math.random() < 0.5 ? -1 : 1) * 1.6, vy: Math.sin(a) * sp * 0.4,
        gravity: 60, drag: 2.5,
        life: 0, max: Phaser.Math.FloatBetween(360, 620),
        size: Phaser.Math.FloatBetween(5, 11), color, kind: 'dot', rot: 0,
      });
    }
  }

  splash(wx: number, wy: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Phaser.Math.FloatBetween(Math.PI * 1.1, Math.PI * 1.9);
      const sp = Phaser.Math.FloatBetween(120, 320);
      this.add({
        wx, wy, ox: Phaser.Math.FloatBetween(-14, 14), oy: 0,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        gravity: 1100, drag: 1,
        life: 0, max: Phaser.Math.FloatBetween(250, 420),
        size: Phaser.Math.FloatBetween(1.5, 3), color: 0xa9c4ff, kind: 'dot', rot: 0,
      });
    }
  }

  ring(wx: number, wy: number, h: number, color: number, size: number, ms = 260): void {
    this.add({ wx, wy, ox: 0, oy: -h, vx: 0, vy: 0, gravity: 0, drag: 0, life: 0, max: ms, size, color, kind: 'ring', rot: 0 });
  }

  flash(wx: number, wy: number, h: number, color: number, size: number, ms = 110): void {
    this.add({ wx, wy, ox: 0, oy: -h, vx: 0, vy: 0, gravity: 0, drag: 0, life: 0, max: ms, size, color, kind: 'flash', rot: Math.random() * Math.PI });
  }

  /** Speed lines for big impacts. */
  streaks(wx: number, wy: number, h: number, dir: number, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.add({
        wx, wy, ox: 0, oy: -h + Phaser.Math.FloatBetween(-30, 30),
        vx: dir * Phaser.Math.FloatBetween(700, 1200), vy: 0,
        gravity: 0, drag: 5,
        life: 0, max: Phaser.Math.FloatBetween(140, 220),
        size: Phaser.Math.FloatBetween(18, 42), color, kind: 'streak', rot: 0,
      });
    }
  }

  text(wx: number, wy: number, h: number, msg: string, color: string, size = 22, ms = 800): void {
    const t = this.scene.add
      .text(0, 0, msg, {
        fontFamily: '"Arial Black", Impact, sans-serif',
        fontSize: `${size}px`,
        color,
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5);
    this.layer.add(t);
    this.texts.push({ t, wx, wy, h, life: 0, max: ms, rise: 46 });
    if (this.texts.length > 14) this.texts.shift()?.t.destroy();
  }

  /** frozen = hitstop: particles hold still, which sells the impact. */
  update(dtMs: number, cam: ViewCamera, frozen: boolean): void {
    const g = this.g;
    g.clear();
    const s = frozen ? 0 : dtMs / 1000;
    const alive: Particle[] = [];
    for (const p of this.particles) {
      if (!frozen || p.kind === 'flash' || p.kind === 'ring') p.life += dtMs;
      if (p.life >= p.max) continue;
      alive.push(p);
      p.vy += p.gravity * s;
      const k = Math.exp(-p.drag * s);
      p.vx *= k;
      p.vy *= k;
      p.ox += p.vx * s;
      p.oy += p.vy * s;
      const base = cam.project(p.wx, p.wy, 0);
      const x = base.x + p.ox * base.s;
      const y = base.y + p.oy * base.s;
      const u = p.life / p.max;
      const a = 1 - u;
      switch (p.kind) {
        case 'spark': {
          const len = Math.min(26, Math.hypot(p.vx, p.vy) * 0.03 + 3);
          const ang = Math.atan2(p.vy, p.vx);
          g.lineStyle(p.size, p.color, a);
          g.lineBetween(x, y, x - Math.cos(ang) * len, y - Math.sin(ang) * len);
          break;
        }
        case 'dot':
          g.fillStyle(p.color, a * 0.55);
          g.fillCircle(x, y, p.size * (0.6 + u * 0.8));
          break;
        case 'ring':
          g.lineStyle(4 * a + 1, p.color, a);
          g.strokeEllipse(x, y, p.size * (0.3 + u * 1.2) * 2, p.size * (0.3 + u * 1.2) * 1.4);
          break;
        case 'flash': {
          const r = p.size * (1 - u * 0.4);
          g.fillStyle(p.color, a * 0.95);
          for (let i = 0; i < 4; i++) {
            const ang = p.rot + (i * Math.PI) / 2;
            g.fillTriangle(
              x + Math.cos(ang) * r, y + Math.sin(ang) * r,
              x + Math.cos(ang + 1.3) * r * 0.22, y + Math.sin(ang + 1.3) * r * 0.22,
              x + Math.cos(ang - 1.3) * r * 0.22, y + Math.sin(ang - 1.3) * r * 0.22,
            );
          }
          g.fillStyle(0xffffff, a);
          g.fillCircle(x, y, r * 0.22);
          break;
        }
        case 'streak':
          g.lineStyle(2, p.color, a * 0.8);
          g.lineBetween(x, y, x - Math.sign(p.vx) * p.size, y);
          break;
      }
    }
    this.particles = alive;

    const keep: FloatText[] = [];
    for (const ft of this.texts) {
      ft.life += dtMs;
      if (ft.life >= ft.max) {
        ft.t.destroy();
        continue;
      }
      keep.push(ft);
      const u = ft.life / ft.max;
      const p = cam.project(ft.wx, ft.wy, ft.h + ft.rise * Math.sqrt(u));
      ft.t.setPosition(p.x, p.y);
      ft.t.setAlpha(u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
      ft.t.setScale(u < 0.12 ? 1.35 - (u / 0.12) * 0.35 : 1);
    }
    this.texts = keep;
  }
}
