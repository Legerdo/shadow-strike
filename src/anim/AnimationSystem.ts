import {
  AVOID_DURATION_MS,
  DODGE_DURATION_MS,
  FINISHER_DURATION_MS,
  KNOCKDOWN_FALL_MS,
  KNOCKDOWN_GETUP_MS,
  PARRY_STATE_MS,
} from '../game/constants';
import { CharState } from '../game/types';
import type { AttackAnim, CharacterKind, Limb } from '../game/types';
import type { Character } from '../game/Character';
import {
  clamp01,
  clonePose,
  easeInCubic,
  easeInOutQuad,
  easeOutBack,
  easeOutCubic,
  lerpPose,
  makePose,
  withPatch,
} from './Pose';
import type { Pose, PosePatch } from './Pose';

export interface AnimContext {
  /** Simulation time (freezes during hitstop, so poses freeze too). */
  time: number;
  /** Real milliseconds since the victory screen started (player celebrates), or -1. */
  victoryMs: number;
}

export interface AnimResult {
  pose: Pose;
  /** Extra height added at render time (hops, flying knee). */
  lift: number;
  /** Limb that must be drawn in front of the torso (crossing strikes). */
  frontLimb: Limb | null;
  /** 0..1 extension of the current strike (used by trails). */
  strike: number;
}

// ---------------------------------------------------------------------------
// Stances
// ---------------------------------------------------------------------------

const STANCES: Readonly<Record<CharacterKind, Pose>> = {
  player: makePose({ px: -2, py: -70, lean: 0.1, head: -0.06, hfx: 30, hfy: -110, hbx: 16, hby: -103, ffx: 22, ffy: 0, fbx: -24, fby: 0 }),
  normal: makePose({ px: 0, py: -72, lean: 0.06, head: 0.05, hfx: 27, hfy: -99, hbx: 12, hby: -95, ffx: 19, ffy: 0, fbx: -21, fby: 0 }),
  agile: makePose({ px: -2, py: -73, lean: 0.14, head: -0.08, hfx: 34, hfy: -116, hbx: 20, hby: -110, ffx: 24, ffy: -1, fbx: -26, fby: -2 }),
  heavy: makePose({ px: 0, py: -67, lean: 0.2, head: -0.14, hfx: 34, hfy: -95, hbx: -4, hby: -92, ffx: 26, ffy: 0, fbx: -28, fby: 0 }),
};

function stance(c: Character, t: number): Pose {
  const seed = c.id * 1.7;
  const p = clonePose(STANCES[c.kind]);
  const b = Math.sin(t * 0.0042 + seed);
  p.py += b * 1.3;
  p.lean += b * 0.012;
  p.hfy += b * 1.6;
  p.hby += b * 1.2;
  if (c.kind === 'agile') {
    const hop = Math.abs(Math.sin(t * 0.0078 + seed));
    p.py -= hop * 3;
  }
  return p;
}

// ---------------------------------------------------------------------------
// Attack clips: wind-up and strike key poses, interpolated per phase.
// ---------------------------------------------------------------------------

interface Clip {
  windup: PosePatch;
  strike: PosePatch;
  front?: Limb;
  lift?: number;
}

const CLIPS: Readonly<Record<AttackAnim, Clip>> = {
  jab: {
    windup: { px: -4, lean: 0.04, hfx: 20, hfy: -108, hbx: 14, hby: -104 },
    strike: { px: 6, lean: 0.24, hfx: 66, hfy: -112, hbx: 14, hby: -104, ffx: 30, fbx: -18 },
  },
  cross: {
    windup: { px: -6, lean: 0.0, hfx: 26, hfy: -110, hbx: 4, hby: -104 },
    strike: { px: 10, lean: 0.3, hfx: 18, hfy: -104, hbx: 68, hby: -112, ffx: 32, fbx: -14 },
    front: 'handB',
  },
  roundhouse: {
    windup: { px: -4, py: -74, lean: -0.12, ffx: 16, ffy: -46, fbx: -14, hfx: 26, hfy: -116, hbx: 12, hby: -110 },
    strike: { px: -6, py: -76, lean: -0.42, ffx: 76, ffy: -102, fbx: -8, hfx: 8, hfy: -114, hbx: -22, hby: -98 },
  },
  highkick: {
    windup: { px: -4, py: -75, lean: -0.16, ffx: 14, ffy: -54, fbx: -12, hfx: 28, hfy: -118, hbx: 14, hby: -112 },
    strike: { px: -8, py: -78, lean: -0.52, ffx: 72, ffy: -118, fbx: -6, hfx: 6, hfy: -116, hbx: -24, hby: -100 },
  },
  palm: {
    windup: { px: -10, py: -64, lean: -0.08, hfx: -8, hfy: -92, hbx: 26, hby: -108, ffx: 28, fbx: -30 },
    strike: { px: 14, py: -62, lean: 0.32, hfx: 76, hfy: -100, hbx: -2, hby: -96, ffx: 44, fbx: -28 },
  },
  backkick: {
    windup: { px: 4, py: -70, lean: 0.4, head: 0.25, ffx: 12, fbx: -8, fby: -26, hfx: 22, hfy: -104, hbx: 2, hby: -104 },
    strike: { px: -8, py: -74, lean: -0.55, head: -0.1, ffx: -6, ffy: 0, fbx: 82, fby: -84, hfx: -8, hfy: -112, hbx: -28, hby: -96 },
    front: 'footB',
  },
  push: {
    windup: { px: -6, lean: -0.06, hfx: 14, hfy: -106, hbx: 10, hby: -100 },
    strike: { px: 12, lean: 0.34, hfx: 64, hfy: -108, hbx: 60, hby: -98, ffx: 36, fbx: -20 },
  },
  haymaker: {
    windup: { px: -10, lean: -0.24, head: -0.1, hbx: -38, hby: -148, hfx: 22, hfy: -112 },
    strike: { px: 12, lean: 0.34, hbx: 62, hby: -124, hfx: 4, hfy: -100, ffx: 34, fbx: -16 },
    front: 'handB',
  },
  sweep: {
    windup: { px: -6, py: -44, lean: 0.44, head: -0.2, ffx: 14, fbx: -30, hfx: 28, hfy: -36, hbx: -8, hby: -46 },
    strike: { px: -2, py: -36, lean: 0.54, head: -0.25, ffx: 88, ffy: -4, fbx: -16, hfx: 12, hfy: -14, hbx: -22, hby: -56 },
  },
  hammer: {
    windup: { px: -6, py: -74, lean: -0.3, head: -0.2, hfx: 8, hfy: -174, hbx: -2, hby: -170 },
    strike: { px: 10, py: -62, lean: 0.6, head: 0.2, hfx: 68, hfy: -76, hbx: 62, hby: -80, ffx: 36, fbx: -26 },
  },
  stomp: {
    windup: { px: -2, py: -74, lean: -0.16, ffx: 18, ffy: -62, hfx: 34, hfy: -128, hbx: -22, hby: -126 },
    strike: { px: 6, py: -58, lean: 0.26, ffx: 62, ffy: 0, fbx: -26, hfx: 38, hfy: -86, hbx: -16, hby: -84 },
  },
  lariat: {
    windup: { px: -10, lean: -0.22, hbx: -54, hby: -120, hfx: 24, hfy: -100 },
    strike: { px: 14, lean: 0.26, hbx: 76, hby: -124, hfx: 10, hfy: -96, ffx: 42, fbx: -14 },
    front: 'handB',
  },
  knee: {
    windup: { px: -4, py: -72, lean: -0.1, ffx: 4, ffy: -12, hfx: 30, hfy: -122, hbx: 22, hby: -118 },
    strike: { px: 8, py: -84, lean: -0.18, ffx: 30, ffy: -64, fbx: -18, fby: -8, hfx: 36, hfy: -124, hbx: 26, hby: -126 },
    lift: 12,
  },
};

function attackPose(c: Character, st: Pose): AnimResult {
  const a = c.attack;
  if (!a) return { pose: st, lift: 0, frontLimb: null, strike: 0 };
  const d = a.data;
  const clip = CLIPS[d.anim];
  const windup = withPatch(st, clip.windup);
  const strikeP = withPatch(st, clip.strike);
  const t = c.stateTime;
  let pose: Pose;
  let strike = 0;
  if (c.state === CharState.AttackStartup) {
    const u = clamp01(t / d.startup);
    if (c.team === 'player') {
      pose = lerpPose(st, windup, easeOutCubic(u / 0.7));
      if (u > 0.7) pose = lerpPose(pose, strikeP, easeInCubic((u - 0.7) / 0.3) * 0.3);
    } else {
      // Enemies reach a readable wind-up early and hold it, coiled and trembling.
      pose = lerpPose(st, windup, easeOutCubic(u / 0.55));
      if (u > 0.55) {
        const k = (u - 0.55) / 0.45;
        const tremble = Math.sin(t * 0.09) * 0.9 * k;
        pose.px += tremble - k * 2;
        pose.hfy += tremble * 0.5;
        pose.hby -= tremble * 0.5;
      }
    }
  } else if (c.state === CharState.AttackActive) {
    const u = clamp01(t / Math.max(30, d.active * 0.5));
    strike = easeOutCubic(u);
    pose = lerpPose(windup, strikeP, strike);
  } else {
    const u = clamp01(t / d.recovery);
    const k = easeInOutQuad(clamp01((u - 0.18) / 0.82));
    pose = lerpPose(strikeP, st, k);
    strike = 1 - k;
  }
  const lift = (clip.lift ?? 0) * strike;
  const frontLimb = clip.front && c.state !== CharState.AttackStartup ? clip.front : null;
  return { pose, lift, frontLimb, strike };
}

// ---------------------------------------------------------------------------
// Other states
// ---------------------------------------------------------------------------

const LYING = makePose({ px: 0, py: -9, lean: 0.06, head: 0.25, hfx: -8, hfy: -89, hbx: -6, hby: -49, ffx: 6, ffy: 61, fbx: -2, fby: 58, rot: -1.5 });
const KNEEL = makePose({ px: -4, py: -42, lean: 0.42, head: -0.1, hfx: 26, hfy: -62, hbx: 6, hby: -56, ffx: 20, ffy: 0, fbx: -24, fby: 0, rot: 0 });

const HIT_HIGH: PosePatch = { px: -10, lean: -0.42, head: -0.5, hfx: 6, hfy: -122, hbx: -22, hby: -108, ffx: 22, fbx: -30 };
const HIT_MID: PosePatch = { px: -8, py: -64, lean: 0.52, head: 0.32, hfx: 24, hfy: -86, hbx: 8, hby: -80, ffx: 18, fbx: -28 };
const RECOIL: PosePatch = { px: -8, lean: -0.32, head: -0.2, hfx: -4, hfy: -132, hbx: -30, hby: -120, ffx: 24, fbx: -32 };

function walkPose(c: Character, st: Pose): Pose {
  const stride = c.kind === 'heavy' ? 36 : 30;
  const ph = (c.walkDistance / stride) * Math.PI;
  const s = Math.sin(ph);
  const co = Math.cos(ph);
  const p = clonePose(st);
  const fwd = Math.sign(c.walkVX) * c.facing;
  const amp = c.kind === 'heavy' ? 12 : 11;
  p.ffx += s * amp;
  p.ffy = Math.min(p.ffy, -Math.max(0, co) * 7);
  p.fbx -= s * amp;
  p.fby = Math.min(p.fby, -Math.max(0, -co) * 7);
  p.py += 1.5 - Math.abs(s) * 2.4;
  p.lean += 0.05 * fwd;
  p.px += 2 * fwd;
  p.hfy += Math.abs(s) * 1.5;
  return p;
}

function guardPose(c: Character, st: Pose, now: number): Pose {
  const g = withPatch(st, {
    px: st.px - 3, py: st.py + 3, lean: st.lean + 0.05, head: -0.12,
    hfx: 26, hfy: -122, hbx: 20, hby: -113, ffx: st.ffx + 2, fbx: st.fbx - 3,
  });
  const p = lerpPose(st, g, easeOutCubic(c.stateTime / 70));
  const since = now - c.lastBlockAt;
  if (since >= 0 && since < 180) {
    const r = 1 - since / 180;
    p.px -= 7 * r;
    p.lean -= 0.14 * r;
    p.head -= 0.1 * r;
  }
  return p;
}

function parryPose(c: Character, st: Pose): Pose {
  const t = c.stateTime;
  const guard = withPatch(st, { hfx: 26, hfy: -122, hbx: 20, hby: -113, head: -0.12 });
  const deflect = withPatch(st, { px: st.px - 2, lean: st.lean - 0.1, head: -0.12, hfx: 46, hfy: -140, hbx: 24, hby: -110 });
  if (t < 60) return lerpPose(guard, deflect, easeOutBack(t / 60));
  return lerpPose(deflect, st, easeInOutQuad((t - 60) / (PARRY_STATE_MS - 60)));
}

function inOut(t: number, inMs: number, total: number, outMs: number): number {
  if (t < inMs) return easeOutCubic(t / inMs);
  if (t > total - outMs) return 1 - easeInOutQuad((t - (total - outMs)) / outMs);
  return 1;
}

function knockdownPose(c: Character, st: Pose): Pose {
  const t = c.stateTime;
  const fall = KNOCKDOWN_FALL_MS;
  const lie = c.knockdownLie;
  if (t < fall) {
    const start = withPatch(st, { lean: -0.4, head: -0.3, hfx: 20, hfy: -130, hbx: -10, hby: -128 });
    return lerpPose(start, LYING, easeInCubic(t / fall) * 0.7 + (t / fall) * 0.3);
  }
  if (t < fall + lie) {
    const p = clonePose(LYING);
    p.lean += Math.sin(t * 0.01) * 0.02;
    return p;
  }
  const u = clamp01((t - fall - lie) / KNOCKDOWN_GETUP_MS);
  if (u < 0.55) return lerpPose(LYING, KNEEL, easeInOutQuad(u / 0.55));
  return lerpPose(KNEEL, st, easeOutCubic((u - 0.55) / 0.45));
}

function deadPose(c: Character, st: Pose): Pose {
  const t = c.stateTime;
  if (t < KNOCKDOWN_FALL_MS) {
    const start = withPatch(st, { lean: -0.45, head: -0.4, hfx: 24, hfy: -134, hbx: -12, hby: -128 });
    return lerpPose(start, LYING, easeInCubic(t / KNOCKDOWN_FALL_MS) * 0.7 + (t / KNOCKDOWN_FALL_MS) * 0.3);
  }
  return clonePose(LYING);
}

function dazedPose(c: Character, st: Pose, now: number): Pose {
  const seed = c.id * 2.3;
  const w1 = Math.sin(now * 0.0062 + seed);
  const w2 = Math.sin(now * 0.0047 + seed * 2);
  const dazed = withPatch(st, {
    px: -4 + w1 * 5, py: st.py + 7, lean: -0.06 + w2 * 0.14, head: 0.34 + w1 * 0.22,
    hfx: 14, hfy: -76 + w2 * 4, hbx: -10, hby: -70, ffx: st.ffx - 4, fbx: st.fbx + 2,
  });
  return lerpPose(st, dazed, easeOutCubic(c.stateTime / 220));
}

const FINISHER_KEYS: readonly { t: number; p: PosePatch }[] = [
  { t: 0, p: {} },
  { t: 150, p: { px: -4, lean: 0.0, hfx: 4, hfy: -124, hbx: 18, hby: -104 } },
  { t: 240, p: { px: 14, lean: 0.32, head: 0.1, hfx: 42, hfy: -124, hbx: 14, hby: -100, ffx: 34 } },
  { t: 400, p: { px: 4, ffx: 12, ffy: -10, hfx: 38, hfy: -124, hbx: 32, hby: -120 } },
  { t: 500, p: { px: 12, py: -80, lean: -0.1, ffx: 40, ffy: -62, fbx: -16, hfx: 46, hfy: -116, hbx: 40, hby: -110 } },
  { t: 700, p: { px: -12, py: -64, lean: -0.16, hfx: -10, hfy: -92, hbx: 30, hby: -108, ffx: 30, fbx: -32 } },
  { t: 820, p: { px: 20, py: -60, lean: 0.4, head: 0.1, hfx: 84, hfy: -104, hbx: -6, hby: -96, ffx: 52, fbx: -30 } },
  { t: 980, p: { px: 18, py: -62, lean: 0.36, hfx: 80, hfy: -104, hbx: -6, hby: -96, ffx: 50, fbx: -30 } },
  { t: FINISHER_DURATION_MS, p: {} },
];

function finisherAttackerPose(c: Character, st: Pose): Pose {
  const t = c.stateTime;
  for (let i = 0; i < FINISHER_KEYS.length - 1; i++) {
    const a = FINISHER_KEYS[i];
    const b = FINISHER_KEYS[i + 1];
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(1, b.t - a.t);
      const striking = i === 1 || i === 3 || i === 5;
      const k = striking ? easeOutCubic(u) : easeInOutQuad(u);
      return lerpPose(withPatch(st, a.p), withPatch(st, b.p), k);
    }
  }
  return st;
}

function finisherVictimPose(c: Character, st: Pose, now: number): { pose: Pose; lift: number } {
  const t = c.stateTime;
  const daze = dazedPose(c, st, now);
  if (t < 240) return { pose: daze, lift: 0 };
  if (t < 500) return { pose: lerpPose(daze, withPatch(st, HIT_HIGH), easeOutCubic((t - 240) / 50)), lift: 0 };
  if (t < 820) {
    const knee = withPatch(st, { py: -84, lean: 0.64, head: 0.42, hfx: 26, hfy: -90, hbx: 10, hby: -84, ffx: 16, ffy: -8, fbx: -20, fby: -4 });
    return { pose: lerpPose(withPatch(st, HIT_HIGH), knee, easeOutCubic((t - 500) / 60)), lift: 10 * easeOutCubic((t - 500) / 80) };
  }
  return { pose: withPatch(st, { lean: -0.6, head: -0.4, hfx: 40, hfy: -128, hbx: 30, hby: -140, ffx: 36, ffy: -18 }), lift: 8 };
}

/**
 * Map a fighter's FSM state to a pose. Pure function of game state + time,
 * so poses freeze naturally during hitstop.
 */
export function computePose(c: Character, ctx: AnimContext): AnimResult {
  const now = ctx.time;
  const st = stance(c, now);
  const t = c.stateTime;
  const res = (pose: Pose, lift = 0): AnimResult => ({ pose, lift, frontLimb: null, strike: 0 });

  switch (c.state) {
    case CharState.Idle: {
      if (c.team === 'player' && ctx.victoryMs >= 0) {
        const win = withPatch(st, { lean: -0.04, head: -0.25, hfx: 12, hfy: -174, hbx: 6, hby: -96 });
        return res(lerpPose(st, win, easeOutBack(ctx.victoryMs / 500)));
      }
      return res(st);
    }
    case CharState.Move:
      return res(walkPose(c, st));
    case CharState.AttackStartup:
    case CharState.AttackActive:
    case CharState.AttackRecovery:
      return attackPose(c, st);
    case CharState.Guard:
      return res(guardPose(c, st, now));
    case CharState.Parry:
      return res(parryPose(c, st));
    case CharState.AvoidHigh: {
      const duck = withPatch(st, { px: -8, py: -40, lean: 0.8, head: -0.35, hfx: 30, hfy: -74, hbx: 16, hby: -66, ffx: st.ffx + 8, fbx: st.fbx - 8 });
      return res(lerpPose(st, duck, inOut(t, 60, AVOID_DURATION_MS, 90)));
    }
    case CharState.AvoidLow: {
      const hop = withPatch(st, { px: 0, py: -82, lean: 0.04, head: -0.05, hfx: 30, hfy: -128, hbx: 12, hby: -122, ffx: 16, ffy: -40, fbx: -14, fby: -34 });
      const k = inOut(t, 60, AVOID_DURATION_MS, 110);
      const lift = 36 * (t < 360 ? easeOutCubic(t / 70) : 1 - easeInOutQuad((t - 360) / (AVOID_DURATION_MS - 360)));
      return res(lerpPose(st, hop, k), Math.max(0, lift));
    }
    case CharState.Dodge: {
      const rel = Math.sign(c.dodgeDirX * c.facing);
      const lean = rel > 0 ? 0.34 : rel < 0 ? -0.3 : 0.12;
      const dash = withPatch(st, { px: 4 * rel, py: -62, lean, ffx: 30, ffy: -6, fbx: -30, fby: -4, hfx: 24, hfy: -104, hbx: 12, hby: -98 });
      return res(lerpPose(st, dash, inOut(t, 60, DODGE_DURATION_MS, 80)));
    }
    case CharState.HitStun: {
      const patch = c.stunKind === 'recoil' ? RECOIL : c.lastHitHeight === 'high' ? HIT_HIGH : HIT_MID;
      const r = withPatch(st, patch);
      const dur = Math.max(c.stateDuration, 120);
      if (t < 50) return res(lerpPose(st, r, easeOutCubic(t / 50)));
      return res(lerpPose(r, st, easeInOutQuad((t - 50) / (dur - 50))));
    }
    case CharState.Pushed: {
      const fly = withPatch(st, { px: -6, py: -76, lean: -0.62, head: -0.35, hfx: 42, hfy: -128, hbx: 30, hby: -140, ffx: 36, ffy: -18, fbx: 10, fby: -6 });
      return res(lerpPose(st, fly, easeOutCubic(t / 90)), 6);
    }
    case CharState.Knockdown:
      return res(knockdownPose(c, st));
    case CharState.StructureBreak:
      return res(dazedPose(c, st, now));
    case CharState.Finisher: {
      if (c.finisherRole === 'attacker') return res(finisherAttackerPose(c, st));
      const v = finisherVictimPose(c, st, now);
      return res(v.pose, v.lift);
    }
    case CharState.Dead:
      return res(deadPose(c, st));
    default:
      return res(st);
  }
}
