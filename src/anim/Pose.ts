/**
 * Procedural skeleton: a pose is a handful of numbers (pelvis, torso lean,
 * hand and foot targets). Elbows and knees are solved with 2-bone IK, so
 * keyframes stay small and interpolate cleanly.
 *
 * Local space: origin on the floor under the fighter, +x = facing direction,
 * y grows downward (screen convention), units = pixels at scale 1.
 */
export interface Pose {
  px: number;
  py: number;
  /** Torso lean from vertical, radians (+ = forward). */
  lean: number;
  /** Head tilt relative to torso. */
  head: number;
  hfx: number;
  hfy: number;
  hbx: number;
  hby: number;
  ffx: number;
  ffy: number;
  fbx: number;
  fby: number;
  /** Whole-body rotation around the pelvis (falls, lying down). */
  rot: number;
}

export type PosePatch = Partial<Pose>;

export const POSE_KEYS: readonly (keyof Pose)[] = [
  'px', 'py', 'lean', 'head', 'hfx', 'hfy', 'hbx', 'hby', 'ffx', 'ffy', 'fbx', 'fby', 'rot',
];

export function makePose(p: PosePatch = {}): Pose {
  return {
    px: 0, py: -72, lean: 0, head: 0,
    hfx: 24, hfy: -108, hbx: 14, hby: -104,
    ffx: 20, ffy: 0, fbx: -22, fby: 0, rot: 0,
    ...p,
  };
}

export function clonePose(p: Pose): Pose {
  return { ...p };
}

export function withPatch(base: Pose, patch: PosePatch): Pose {
  return { ...base, ...patch };
}

export function lerpPose(a: Pose, b: Pose, t: number, out: Pose = makePose()): Pose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export interface BodyDims {
  thigh: number;
  shin: number;
  torso: number;
  neck: number;
  headR: number;
  upperArm: number;
  foreArm: number;
}

export const BASE_DIMS: BodyDims = {
  thigh: 38,
  shin: 38,
  torso: 46,
  neck: 6,
  headR: 11,
  upperArm: 26,
  foreArm: 25,
};

export interface V2 {
  x: number;
  y: number;
}

export interface Skeleton {
  pelvis: V2;
  chest: V2;
  head: V2;
  shoulderF: V2;
  shoulderB: V2;
  hipF: V2;
  hipB: V2;
  elbowF: V2;
  handF: V2;
  elbowB: V2;
  handB: V2;
  kneeF: V2;
  footF: V2;
  kneeB: V2;
  footB: V2;
  /** Absolute angle of the torso axis (radians from vertical, after rotation). */
  torsoAngle: number;
  headAngle: number;
}

/** Analytic two-bone IK. bend = +1 bends clockwise (elbows down), -1 counter-clockwise (knees forward). */
export function solveTwoBone(root: V2, target: V2, l1: number, l2: number, bend: number): [V2, V2] {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const base = Math.atan2(dy, dx);
  let d = Math.hypot(dx, dy);
  const maxD = l1 + l2 - 0.01;
  const minD = Math.abs(l1 - l2) + 0.5;
  d = Math.max(minD, Math.min(maxD, d));
  const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const ja = base + bend * a;
  const joint = { x: root.x + Math.cos(ja) * l1, y: root.y + Math.sin(ja) * l1 };
  const end = { x: root.x + Math.cos(base) * d, y: root.y + Math.sin(base) * d };
  return [joint, end];
}

function rotateAround(p: V2, c: V2, cos: number, sin: number): void {
  const x = p.x - c.x;
  const y = p.y - c.y;
  p.x = c.x + x * cos - y * sin;
  p.y = c.y + x * sin + y * cos;
}

export function solveSkeleton(pose: Pose, dims: BodyDims = BASE_DIMS): Skeleton {
  const pelvis = { x: pose.px, y: pose.py };
  const la = pose.lean;
  const sl = Math.sin(la);
  const cl = Math.cos(la);
  const chest = { x: pelvis.x + sl * dims.torso, y: pelvis.y - cl * dims.torso };
  const shoulderBase = { x: pelvis.x + sl * (dims.torso - 5), y: pelvis.y - cl * (dims.torso - 5) };
  const ha = la + pose.head;
  const head = {
    x: chest.x + Math.sin(ha) * (dims.neck + dims.headR),
    y: chest.y - Math.cos(ha) * (dims.neck + dims.headR),
  };
  const shoulderF = { x: shoulderBase.x + 3, y: shoulderBase.y + 1 };
  const shoulderB = { x: shoulderBase.x - 3, y: shoulderBase.y - 1 };
  const hipF = { x: pelvis.x + 3, y: pelvis.y };
  const hipB = { x: pelvis.x - 3, y: pelvis.y };
  const [elbowF, handF] = solveTwoBone(shoulderF, { x: pose.hfx, y: pose.hfy }, dims.upperArm, dims.foreArm, 1);
  const [elbowB, handB] = solveTwoBone(shoulderB, { x: pose.hbx, y: pose.hby }, dims.upperArm, dims.foreArm, 1);
  const [kneeF, footF] = solveTwoBone(hipF, { x: pose.ffx, y: pose.ffy }, dims.thigh, dims.shin, -1);
  const [kneeB, footB] = solveTwoBone(hipB, { x: pose.fbx, y: pose.fby }, dims.thigh, dims.shin, -1);

  const sk: Skeleton = {
    pelvis, chest, head, shoulderF, shoulderB, hipF, hipB,
    elbowF, handF, elbowB, handB, kneeF, footF, kneeB, footB,
    torsoAngle: la + pose.rot,
    headAngle: ha + pose.rot,
  };
  if (pose.rot !== 0) {
    const c = Math.cos(pose.rot);
    const s = Math.sin(pose.rot);
    const pts = [chest, head, shoulderF, shoulderB, hipF, hipB, elbowF, handF, elbowB, handB, kneeF, footF, kneeB, footB];
    for (const p of pts) rotateAround(p, pelvis, c, s);
  }
  return sk;
}

// ---- easing helpers -------------------------------------------------------
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3);
export const easeInOutQuad = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
};
export const easeOutBack = (t: number): number => {
  const x = clamp01(t);
  const c1 = 1.6;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
