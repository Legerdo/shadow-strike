import type * as Phaser from 'phaser';
import type { Limb } from '../game/types';
import type { Skeleton, V2 } from '../anim/Pose';
import type { Look } from './looks';
import { shade } from './looks';

type Graphics = Phaser.GameObjects.Graphics;

interface Cap {
  a: V2;
  b: V2;
  wa: number;
  wb: number;
  color: number;
  /** Front-layer limb: gets an inner contour so it reads against the torso. */
  sep: boolean;
}

export interface DrawOptions {
  rim: number;
  rimAlpha: number;
  flash: boolean;
  frontLimb: Limb | null;
  /** Local-space ribbon points (headband tails / ponytail), drawn behind the body. */
  ribbon: readonly V2[] | null;
}

const OUT = 2.1;
const SEP = 1.3;

export function capsule(g: Graphics, a: V2, b: V2, wa: number, wb: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const ha = wa * 0.5;
  const hb = wb * 0.5;
  g.beginPath();
  g.moveTo(a.x + nx * ha, a.y + ny * ha);
  g.lineTo(b.x + nx * hb, b.y + ny * hb);
  g.lineTo(b.x - nx * hb, b.y - ny * hb);
  g.lineTo(a.x - nx * ha, a.y - ny * ha);
  g.closePath();
  g.fillPath();
  g.fillCircle(a.x, a.y, ha);
  g.fillCircle(b.x, b.y, hb);
}

function toeOf(knee: V2, foot: V2, len: number): V2 {
  const dx = foot.x - knee.x;
  const dy = foot.y - knee.y;
  const l = Math.hypot(dx, dy) || 1;
  // Toes point "forward" relative to the shin (shin direction rotated -90deg).
  return { x: foot.x + (dy / l) * len, y: foot.y - (dx / l) * len };
}

function headAxes(sk: Skeleton): { fwd: V2; up: V2 } {
  const a = sk.headAngle;
  return { fwd: { x: Math.cos(a), y: Math.sin(a) }, up: { x: Math.sin(a), y: -Math.cos(a) } };
}

function at(o: V2, fwd: V2, up: V2, f: number, u: number): V2 {
  return { x: o.x + fwd.x * f + up.x * u, y: o.y + fwd.y * f + up.y * u };
}

/** Build the ordered list of body capsules (back to front). */
function buildCaps(sk: Skeleton, look: Look, frontLimb: Limb | null): Cap[] {
  const dark = 0.68;
  const toeF = toeOf(sk.kneeF, sk.footF, 10);
  const toeB = toeOf(sk.kneeB, sk.footB, 10);
  const shoulderMid = { x: (sk.shoulderF.x + sk.shoulderB.x) / 2, y: (sk.shoulderF.y + sk.shoulderB.y) / 2 };

  const legB: Cap[] = [
    { a: sk.hipB, b: sk.kneeB, wa: look.thigh[0], wb: look.thigh[1], color: shade(look.pants, dark), sep: false },
    { a: sk.kneeB, b: sk.footB, wa: look.shin[0], wb: look.shin[1], color: shade(look.pants, dark), sep: false },
    { a: sk.footB, b: toeB, wa: 7, wb: 5, color: shade(look.shoe, dark), sep: false },
  ];
  const armB: Cap[] = [
    { a: sk.shoulderB, b: sk.elbowB, wa: look.upper[0], wb: look.upper[1], color: shade(look.upperArm, dark), sep: false },
    { a: sk.elbowB, b: sk.handB, wa: look.fore[0], wb: look.fore[1], color: shade(look.foreArm, dark), sep: false },
    { a: sk.handB, b: sk.handB, wa: look.fistR * 2, wb: look.fistR * 2, color: shade(look.fist, 0.8), sep: false },
  ];
  const torso: Cap[] = [{ a: sk.pelvis, b: shoulderMid, wa: look.hipW, wb: look.shoulderW, color: look.top, sep: false }];
  if (look.belly > 0) {
    const mid = { x: sk.pelvis.x * 0.55 + shoulderMid.x * 0.45 + Math.cos(sk.torsoAngle) * 6, y: sk.pelvis.y * 0.55 + shoulderMid.y * 0.45 + Math.sin(sk.torsoAngle) * 6 };
    torso.push({ a: mid, b: mid, wa: look.belly * 2, wb: look.belly * 2, color: shade(look.top, 1.1), sep: false });
  }
  const legF: Cap[] = [
    { a: sk.hipF, b: sk.kneeF, wa: look.thigh[0], wb: look.thigh[1], color: look.pants, sep: true },
    { a: sk.kneeF, b: sk.footF, wa: look.shin[0], wb: look.shin[1], color: look.pants, sep: true },
    { a: sk.footF, b: toeF, wa: 7, wb: 5, color: look.shoe, sep: true },
  ];
  const armF: Cap[] = [
    { a: sk.shoulderF, b: sk.elbowF, wa: look.upper[0], wb: look.upper[1], color: look.upperArm, sep: true },
    { a: sk.elbowF, b: sk.handF, wa: look.fore[0], wb: look.fore[1], color: look.foreArm, sep: true },
    { a: sk.handF, b: sk.handF, wa: look.fistR * 2, wb: look.fistR * 2, color: look.fist, sep: true },
  ];

  let order: Cap[][];
  if (frontLimb === 'handB') order = [legB, torso, legF, armF, armB];
  else if (frontLimb === 'footB') order = [armB, torso, legF, legB, armF];
  else order = [legB, armB, torso, legF, armF];
  // Mark promoted back limbs so they get a contour too.
  if (frontLimb === 'handB') for (const c of armB) c.sep = true;
  if (frontLimb === 'footB') for (const c of legB) c.sep = true;
  return order.flat();
}

/**
 * Draw a fighter silhouette: neon rim pass, fill pass, then details.
 * Coordinates are local (the Graphics object carries position, scale and facing mirror).
 */
export function drawFighter(g: Graphics, sk: Skeleton, look: Look, o: DrawOptions): void {
  const caps = buildCaps(sk, look, o.frontLimb);
  const headR = 11;
  const { fwd, up } = headAxes(sk);

  // Ribbon behind everything.
  if (look.ribbon && o.ribbon && o.ribbon.length > 1) {
    const pts = o.ribbon;
    for (let pass = 0; pass < 2; pass++) {
      g.fillStyle(pass === 0 ? o.rim : o.flash ? 0xffffff : look.ribbon.color, pass === 0 ? o.rimAlpha * 0.7 : 1);
      for (let i = 0; i < pts.length - 1; i++) {
        const t0 = 1 - i / (pts.length - 1);
        const t1 = 1 - (i + 1) / (pts.length - 1);
        const w0 = look.ribbon.width * (0.45 + 0.55 * t0) + (pass === 0 ? 2 : 0);
        const w1 = look.ribbon.width * (0.45 + 0.55 * t1) + (pass === 0 ? 2 : 0);
        capsule(g, pts[i], pts[i + 1], w0, w1);
      }
    }
  }

  // Pass 1: rim outline around the full silhouette.
  g.fillStyle(o.rim, o.rimAlpha);
  for (const c of caps) capsule(g, c.a, c.b, c.wa + OUT * 2, c.wb + OUT * 2);
  g.fillCircle(sk.head.x, sk.head.y, headR + OUT);

  // Pass 2: fills (front limbs get a thin dark contour first).
  let headDrawn = false;
  const headIndex = caps.length - 3; // head sits under the front arm
  for (let i = 0; i < caps.length; i++) {
    if (i === headIndex && !headDrawn) {
      drawHead(g, sk, look, o.flash, fwd, up);
      headDrawn = true;
    }
    const c = caps[i];
    if (c.sep) {
      g.fillStyle(0x050509, 0.9);
      capsule(g, c.a, c.b, c.wa + SEP * 2, c.wb + SEP * 2);
    }
    g.fillStyle(o.flash ? 0xffffff : c.color, 1);
    capsule(g, c.a, c.b, c.wa, c.wb);
  }
  if (!headDrawn) drawHead(g, sk, look, o.flash, fwd, up);

  // Pass 3: costume details.
  if (!o.flash) drawDetails(g, sk, look);
}

function drawHead(g: Graphics, sk: Skeleton, look: Look, flash: boolean, fwd: V2, up: V2): void {
  const h = sk.head;
  const r = 11;
  const col = (c: number) => (flash ? 0xffffff : c);
  switch (look.head) {
    case 'kai': {
      const hair = at(h, fwd, up, -2.2, 1.8);
      g.fillStyle(col(look.hair), 1);
      g.fillCircle(hair.x, hair.y, r);
      const face = at(h, fwd, up, 1.6, -0.6);
      g.fillStyle(col(look.skin), 1);
      g.fillCircle(face.x, face.y, r * 0.84);
      g.fillStyle(col(look.accent), 1);
      capsule(g, at(h, fwd, up, -r * 0.95, r * 0.32), at(h, fwd, up, r * 0.85, r * 0.3), 4.4, 3.6);
      break;
    }
    case 'thug': {
      g.fillStyle(col(look.skin), 1);
      g.fillCircle(h.x, h.y, r);
      g.fillStyle(col(look.hair), 1);
      const cap = at(h, fwd, up, -1.2, r * 0.42);
      g.fillCircle(cap.x, cap.y, r * 0.86);
      g.fillStyle(col(0x0e0e12), 1);
      capsule(g, at(h, fwd, up, -r * 0.9, r * 0.12), at(h, fwd, up, r * 1.15, r * 0.1), 3.4, 3);
      break;
    }
    case 'viper': {
      g.fillStyle(col(look.hair), 1);
      const hair = at(h, fwd, up, -2.5, 1.5);
      g.fillCircle(hair.x, hair.y, r);
      g.fillStyle(col(look.accent), 1);
      const mask = at(h, fwd, up, 1.8, -0.4);
      g.fillCircle(mask.x, mask.y, r * 0.84);
      break;
    }
    case 'brute': {
      g.fillStyle(col(look.skin), 1);
      g.fillCircle(h.x, h.y, r * 1.05);
      g.fillStyle(col(look.hair), 1);
      capsule(g, at(h, fwd, up, r * 0.15, -r * 0.62), at(h, fwd, up, r * 0.9, -r * 0.3), 8, 6);
      break;
    }
  }
}

function drawDetails(g: Graphics, sk: Skeleton, look: Look): void {
  const { fwd, up } = headAxes(sk);
  const h = sk.head;
  const r = 11;

  // Eye glint: tells the facing direction at a glance.
  const eyeA = at(h, fwd, up, r * 0.38, r * 0.05);
  const eyeB = at(h, fwd, up, r * 0.72, r * 0.02);
  g.fillStyle(look.eye, 1);
  capsule(g, eyeA, eyeB, look.head === 'viper' ? 2.6 : 2.1, look.head === 'viper' ? 2.2 : 1.6);

  // Belt / sash across the hips.
  const ta = sk.torsoAngle;
  const nx = Math.cos(ta);
  const ny = Math.sin(ta);
  const hw = look.hipW * 0.5;
  const ax = sk.pelvis.x - nx * hw;
  const ay = sk.pelvis.y - ny * hw;
  const bx = sk.pelvis.x + nx * hw;
  const by = sk.pelvis.y + ny * hw;
  const beltY = -Math.cos(ta) * 4;
  const beltX = Math.sin(ta) * 4;
  g.fillStyle(look.head === 'kai' ? look.accent : look.head === 'brute' ? 0x3a2a1a : 0x101014, 1);
  capsule(g, { x: ax + beltX, y: ay + beltY }, { x: bx + beltX, y: by + beltY }, 5, 5);
  if (look.head === 'kai') {
    // Sash tail hanging from the back of the belt.
    g.fillStyle(look.accent, 1);
    capsule(g, { x: ax + beltX, y: ay + beltY }, { x: ax + beltX - 5, y: ay + beltY + 13 }, 4, 2.4);
  }

  if (look.head === 'brute') {
    // Gold chain across the chest.
    const sm = { x: (sk.shoulderF.x + sk.shoulderB.x) / 2, y: (sk.shoulderF.y + sk.shoulderB.y) / 2 };
    const c1 = { x: sm.x - nx * 10 + Math.sin(ta) * -2, y: sm.y - ny * 10 + 6 };
    const c2 = { x: sm.x + Math.sin(ta) * -12 + nx * 2, y: sm.y + 15 };
    const c3 = { x: sm.x + nx * 12, y: sm.y + ny * 12 + 6 };
    g.fillStyle(look.accent, 1);
    capsule(g, c1, c2, 2.4, 2.4);
    capsule(g, c2, c3, 2.4, 2.4);
  }
  if (look.head === 'thug') {
    // Hoodie stripe.
    g.fillStyle(look.accent, 0.85);
    const sm = { x: (sk.shoulderF.x + sk.shoulderB.x) / 2, y: (sk.shoulderF.y + sk.shoulderB.y) / 2 };
    capsule(g, { x: sm.x * 0.8 + sk.pelvis.x * 0.2 + nx * 5, y: sm.y * 0.8 + sk.pelvis.y * 0.2 + ny * 5 }, { x: sm.x * 0.35 + sk.pelvis.x * 0.65 + nx * 5, y: sm.y * 0.35 + sk.pelvis.y * 0.65 + ny * 5 }, 2.6, 2.6);
  }
}

/** Single-colour silhouette (afterimages). */
export function drawSilhouette(g: Graphics, sk: Skeleton, look: Look, color: number): void {
  const caps = buildCaps(sk, look, null);
  g.fillStyle(color, 1);
  for (const c of caps) capsule(g, c.a, c.b, c.wa, c.wb);
  g.fillCircle(sk.head.x, sk.head.y, 11);
}

/** Local anchor for the ribbon (back of the head). */
export function ribbonAnchor(sk: Skeleton): V2 {
  const { fwd, up } = headAxes(sk);
  return at(sk.head, fwd, up, -10, 3.5);
}

export function limbTip(sk: Skeleton, limb: Limb): V2 {
  switch (limb) {
    case 'handF':
      return sk.handF;
    case 'handB':
      return sk.handB;
    case 'footF':
      return sk.footF;
    case 'footB':
      return sk.footB;
  }
}
