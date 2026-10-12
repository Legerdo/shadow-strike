import * as Phaser from 'phaser';
import { ARENA_DEPTH, ARENA_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from '../game/constants';
import { Rng } from '../game/rng';
import { BACK_SCALE, FLOOR_BOTTOM, FLOOR_TOP, HALF_W } from './projection';
import type { ViewCamera } from './projection';

type Graphics = Phaser.GameObjects.Graphics;

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  layer: 0 | 1;
}

interface Sign {
  x: number;
  y: number;
  w: number;
  h: number;
  color: number;
  text: string;
  flicker: number;
}

const SKY_FACTOR = 0.15;
const CITY_FACTOR = 0.35;
const WALL_FACTOR = BACK_SCALE;

/**
 * Rainy neon underground arena. Static layers are drawn once and scrolled with
 * parallax; animated details (rain, flicker, puddle glints) redraw each frame.
 */
export class Arena {
  private readonly sky: Graphics;
  private readonly city: Graphics;
  private readonly wall: Graphics;
  private readonly floor: Graphics;
  private readonly live: Graphics;
  private readonly front: Graphics;
  private readonly rainFront: Graphics;
  private readonly signTexts: Phaser.GameObjects.Text[] = [];
  private readonly signs: Sign[] = [];
  private readonly drops: Drop[] = [];
  private readonly rng = new Rng(77);
  private lightning = 0;
  private nextLightning = 6000;

  constructor(scene: Phaser.Scene, back: Phaser.GameObjects.Layer, fore: Phaser.GameObjects.Layer) {
    this.sky = scene.add.graphics();
    this.city = scene.add.graphics();
    this.wall = scene.add.graphics();
    this.floor = scene.add.graphics();
    this.live = scene.add.graphics();
    back.add([this.sky, this.city, this.wall, this.floor]);
    this.drawSky();
    this.drawCity();
    this.drawWall(scene, back);
    back.add(this.live);
    this.front = scene.add.graphics();
    this.rainFront = scene.add.graphics();
    fore.add([this.front, this.rainFront]);
    for (let i = 0; i < 170; i++) {
      this.drops.push({
        x: this.rng.range(0, VIEW_WIDTH),
        y: this.rng.range(0, VIEW_HEIGHT),
        len: this.rng.range(10, 26),
        speed: this.rng.range(900, 1400),
        layer: this.rng.chance(0.35) ? 1 : 0,
      });
    }
  }

  /** Width (screen px) a layer needs so it covers the view at both camera extremes. */
  private static span(factor: number): number {
    return (ARENA_WIDTH - VIEW_WIDTH) * factor + VIEW_WIDTH + 40;
  }

  private drawSky(): void {
    const g = this.sky;
    const w = Arena.span(SKY_FACTOR);
    const bands = 18;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      const r = Math.round(8 + 30 * t);
      const gg = Math.round(6 + 6 * t);
      const b = Math.round(22 + 26 * t);
      g.fillStyle((r << 16) | (gg << 8) | b, 1);
      g.fillRect(-w / 2, (FLOOR_TOP * i) / bands, w, FLOOR_TOP / bands + 1);
    }
    // Moon haze.
    g.fillStyle(0xb3a0ff, 0.05);
    g.fillCircle(-180, 90, 120);
    g.fillStyle(0xd8ccff, 0.12);
    g.fillCircle(-180, 90, 34);
  }

  private drawCity(): void {
    const g = this.city;
    const w = Arena.span(CITY_FACTOR);
    let x = -w / 2;
    while (x < w / 2) {
      const bw = this.rng.range(50, 120);
      const bh = this.rng.range(110, 300);
      const top = FLOOR_TOP - 40 - bh;
      g.fillStyle(0x0d0b1c, 1);
      g.fillRect(x, top, bw, bh + 60);
      // Windows.
      for (let wy = top + 10; wy < FLOOR_TOP - 50; wy += 14) {
        for (let wx = x + 6; wx < x + bw - 8; wx += 12) {
          if (!this.rng.chance(0.22)) continue;
          const c = this.rng.chance(0.5) ? 0xffb35c : this.rng.chance(0.5) ? 0x5cf0ff : 0xff5cc8;
          g.fillStyle(c, this.rng.range(0.15, 0.5));
          g.fillRect(wx, wy, 5, 7);
        }
      }
      if (this.rng.chance(0.3)) {
        g.fillStyle(0xff2050, 0.8);
        g.fillCircle(x + bw / 2, top - 4, 2.5);
      }
      x += bw + this.rng.range(2, 14);
    }
  }

  private drawWall(scene: Phaser.Scene, back: Phaser.GameObjects.Layer): void {
    const g = this.wall;
    const w = Arena.span(WALL_FACTOR);
    const top = FLOOR_TOP - 250;
    // Chain-link fence and concrete pillars along the back wall.
    g.fillStyle(0x14111f, 1);
    g.fillRect(-w / 2, FLOOR_TOP - 60, w, 60);
    g.lineStyle(1, 0x4d4466, 0.35);
    for (let x = -w / 2; x < w / 2; x += 16) {
      g.lineBetween(x, top + 60, x + 120, FLOOR_TOP - 60);
      g.lineBetween(x + 120, top + 60, x, FLOOR_TOP - 60);
    }
    g.lineStyle(3, 0x5a5277, 0.7);
    g.lineBetween(-w / 2, top + 60, w / 2, top + 60);
    g.lineBetween(-w / 2, FLOOR_TOP - 60, w / 2, FLOOR_TOP - 60);
    for (let x = -w / 2 + 40; x < w / 2; x += 260) {
      g.fillStyle(0x1b1729, 1);
      g.fillRect(x, top, 34, FLOOR_TOP - top);
      g.fillStyle(0x2a2440, 1);
      g.fillRect(x, top, 6, FLOOR_TOP - top);
      // Hanging lamp.
      g.lineStyle(2, 0x2a2440, 1);
      g.lineBetween(x + 147, top - 40, x + 147, top + 20);
      g.fillStyle(0xffe9b0, 0.9);
      g.fillTriangle(x + 135, top + 30, x + 159, top + 30, x + 147, top + 18);
      g.fillStyle(0xffe9b0, 0.05);
      g.fillTriangle(x + 147, top + 25, x + 60, FLOOR_TOP + 20, x + 234, FLOOR_TOP + 20);
    }
    // Neon signs (original names).
    const words = [
      { text: '夜拳', color: 0xff3fd2 },
      { text: 'PIT 09', color: 0x3ef2ff },
      { text: '影', color: 0xffc233 },
      { text: 'NO RULES', color: 0xff3b4f },
      { text: '龍門', color: 0x7dff6a },
    ];
    let sx = -w / 2 + 120;
    words.forEach((wd, i) => {
      const s: Sign = { x: sx, y: top + 6 + (i % 2) * 28, w: 0, h: 0, color: wd.color, text: wd.text, flicker: this.rng.range(0, 1000) };
      const txt = scene.add
        .text(s.x, s.y, wd.text, {
          fontFamily: '"Arial Black", Impact, sans-serif',
          fontSize: wd.text.length <= 2 ? '44px' : '30px',
          color: '#ffffff',
        })
        .setOrigin(0.5, 0)
        .setTint(wd.color);
      txt.setShadow(0, 0, `#${wd.color.toString(16).padStart(6, '0')}`, 18, true, true);
      s.w = txt.width;
      s.h = txt.height;
      back.add(txt);
      this.signTexts.push(txt);
      this.signs.push(s);
      sx += w / words.length;
    });
  }

  /** Called every frame: parallax positions, floor, rain and flicker. */
  update(cam: ViewCamera, dtMs: number, real: number): void {
    this.sky.x = cam.layerX(ARENA_WIDTH / 2, SKY_FACTOR);
    this.city.x = cam.layerX(ARENA_WIDTH / 2, CITY_FACTOR);
    this.wall.x = cam.layerX(ARENA_WIDTH / 2, WALL_FACTOR);
    this.signTexts.forEach((t, i) => {
      const s = this.signs[i];
      t.x = this.wall.x + s.x;
      const f = Math.sin(real * 0.004 + s.flicker) + Math.sin(real * 0.031 + s.flicker * 3);
      t.setAlpha(f < -1.6 ? 0.25 : 0.95);
    });

    this.nextLightning -= dtMs;
    if (this.nextLightning <= 0) {
      this.lightning = 1;
      this.nextLightning = this.rng.range(7000, 14000);
    }
    this.lightning = Math.max(0, this.lightning - dtMs / 380);

    this.drawFloor(cam, real);
    this.drawRain(dtMs);
  }

  private drawFloor(cam: ViewCamera, real: number): void {
    const g = this.floor;
    g.clear();
    const corners = [cam.project(0, 0), cam.project(ARENA_WIDTH, 0), cam.project(ARENA_WIDTH, ARENA_DEPTH), cam.project(0, ARENA_DEPTH)];
    // Out-of-bounds floor beyond the arena.
    g.fillStyle(0x0a0910, 1);
    g.fillRect(0, FLOOR_TOP, VIEW_WIDTH, VIEW_HEIGHT - FLOOR_TOP);
    // Wet concrete with depth gradient.
    const strips = 12;
    for (let i = 0; i < strips; i++) {
      const y0 = (ARENA_DEPTH * i) / strips;
      const y1 = (ARENA_DEPTH * (i + 1)) / strips;
      const a = cam.project(0, y0);
      const b = cam.project(ARENA_WIDTH, y0);
      const c = cam.project(ARENA_WIDTH, y1);
      const d = cam.project(0, y1);
      const t = i / strips;
      const r = Math.round(20 + 14 * t);
      const gg = Math.round(18 + 10 * t);
      const bl = Math.round(34 + 14 * t);
      g.fillStyle((r << 16) | (gg << 8) | bl, 1);
      g.fillPoints([a, b, c, d], true);
    }
    // Floor tiles in perspective.
    g.lineStyle(1, 0x3c3557, 0.45);
    for (let x = 0; x <= ARENA_WIDTH; x += 120) {
      const a = cam.project(x, 0);
      const b = cam.project(x, ARENA_DEPTH);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = 0; y <= ARENA_DEPTH; y += 60) {
      const a = cam.project(0, y);
      const b = cam.project(ARENA_WIDTH, y);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
    // Painted fight ring.
    const ring: { x: number; y: number }[] = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const p = cam.project(ARENA_WIDTH / 2 + Math.cos(a) * 330, ARENA_DEPTH / 2 + Math.sin(a) * 120);
      ring.push(p);
    }
    g.lineStyle(4, 0xff3b4f, 0.35);
    g.strokePoints(ring, true);
    // Neon reflections in puddles.
    const glints = [
      { x: 260, y: 90, w: 140, c: 0xff3fd2 },
      { x: 760, y: 200, w: 200, c: 0x3ef2ff },
      { x: 1250, y: 120, w: 160, c: 0xffc233 },
      { x: 520, y: 260, w: 120, c: 0xff3b4f },
    ];
    for (const gl of glints) {
      const p = cam.project(gl.x, gl.y);
      const shimmer = 0.1 + 0.05 * Math.sin(real * 0.003 + gl.x);
      g.fillStyle(gl.c, shimmer);
      g.fillEllipse(p.x, p.y, gl.w * p.s, 16 * p.s);
    }
    // Arena edges: back wall line and side walls.
    g.lineStyle(3, 0x8a6bff, 0.6);
    g.lineBetween(corners[0].x, corners[0].y, corners[1].x, corners[1].y);
    const side = (x: number, color: number) => {
      const a = cam.project(x, 0);
      const b = cam.project(x, ARENA_DEPTH);
      const top0 = cam.project(x, 0, 230);
      const top1 = cam.project(x, ARENA_DEPTH, 230);
      g.fillStyle(0x0f0c1a, 0.92);
      const dir = x === 0 ? -1 : 1;
      g.fillPoints([a, b, top1, top0], true);
      g.fillStyle(0x0f0c1a, 1);
      g.fillPoints([a, { x: a.x + dir * 400, y: a.y }, { x: b.x + dir * 400, y: b.y }, b], true);
      g.fillPoints([top0, a, b, top1, { x: top1.x + dir * 400, y: top1.y }, { x: top0.x + dir * 400, y: top0.y }], true);
      g.lineStyle(4, color, 0.85);
      g.lineBetween(a.x, a.y, b.x, b.y);
      g.lineStyle(2, color, 0.5);
      g.lineBetween(top0.x, top0.y, top1.x, top1.y);
      g.lineBetween(a.x, a.y, top0.x, top0.y);
      g.lineBetween(b.x, b.y, top1.x, top1.y);
    };
    side(0, 0xff3fd2);
    side(ARENA_WIDTH, 0x3ef2ff);

    // Live layer: lightning wash.
    const l = this.live;
    l.clear();
    if (this.lightning > 0) {
      l.fillStyle(0xcfd8ff, 0.18 * this.lightning);
      l.fillRect(0, 0, VIEW_WIDTH, FLOOR_TOP);
    }

    // Foreground: dark vignette strip and ropes nearest to the camera.
    const f = this.front;
    f.clear();
    f.fillStyle(0x000000, 0.35);
    f.fillRect(0, FLOOR_BOTTOM + 14, VIEW_WIDTH, VIEW_HEIGHT - FLOOR_BOTTOM);
    const postFactor = 1.25;
    for (let x = 0; x <= ARENA_WIDTH; x += 390) {
      const sx = HALF_W + (x - cam.x) * postFactor;
      if (sx < -60 || sx > VIEW_WIDTH + 60) continue;
      f.fillStyle(0x07060c, 1);
      f.fillRect(sx - 9, FLOOR_BOTTOM - 10, 18, VIEW_HEIGHT - FLOOR_BOTTOM + 20);
      f.fillStyle(0xff3b4f, 0.7);
      f.fillRect(sx - 9, FLOOR_BOTTOM - 10, 18, 4);
    }
  }

  private drawRain(dtMs: number): void {
    const g = this.rainFront;
    g.clear();
    const s = dtMs / 1000;
    for (const d of this.drops) {
      d.y += d.speed * s;
      d.x -= d.speed * 0.18 * s;
      if (d.y > VIEW_HEIGHT) {
        d.y = this.rng.range(-40, 0);
        d.x = this.rng.range(0, VIEW_WIDTH + 120);
      }
      const near = d.layer === 1;
      g.lineStyle(near ? 1.6 : 1, near ? 0xbfd2ff : 0x8fa0d0, near ? 0.32 : 0.18);
      g.lineBetween(d.x, d.y, d.x + d.len * 0.18, d.y - d.len);
    }
  }
}
