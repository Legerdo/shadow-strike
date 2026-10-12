import type { CharacterKind } from '../game/types';

export type HeadStyle = 'kai' | 'thug' | 'viper' | 'brute';

/** Visual identity of a fighter type (render-only; gameplay stats live in archetypes). */
export interface Look {
  scale: number;
  /** Neon rim / outline colour. */
  rim: number;
  skin: number;
  top: number;
  pants: number;
  upperArm: number;
  foreArm: number;
  fist: number;
  shoe: number;
  hair: number;
  accent: number;
  eye: number;
  hipW: number;
  shoulderW: number;
  thigh: readonly [number, number];
  shin: readonly [number, number];
  upper: readonly [number, number];
  fore: readonly [number, number];
  fistR: number;
  head: HeadStyle;
  belly: number;
  ribbon: { color: number; segments: number; length: number; width: number } | null;
  label: string;
}

export const LOOKS: Readonly<Record<CharacterKind, Look>> = {
  player: {
    scale: 1.12,
    rim: 0x3ef2ff,
    skin: 0xc58f6e,
    top: 0x1d3140,
    pants: 0x16161f,
    upperArm: 0x1d3140,
    foreArm: 0xc58f6e,
    fist: 0xf2efe6,
    shoe: 0x2a2a33,
    hair: 0x0d0d12,
    accent: 0xff3b4f,
    eye: 0xffffff,
    hipW: 22,
    shoulderW: 27,
    thigh: [13, 10],
    shin: [10, 7],
    upper: [10, 8],
    fore: [8, 6.5],
    fistR: 5.2,
    head: 'kai',
    belly: 0,
    ribbon: { color: 0xff3b4f, segments: 7, length: 8, width: 3.6 },
    label: 'KAI',
  },
  normal: {
    scale: 1.12,
    rim: 0xff3fd2,
    skin: 0x9a6d55,
    top: 0x3b1d4c,
    pants: 0x262631,
    upperArm: 0x3b1d4c,
    foreArm: 0x3b1d4c,
    fist: 0x9a6d55,
    shoe: 0x121216,
    hair: 0x1c1c22,
    accent: 0xffd23f,
    eye: 0xffe2a8,
    hipW: 24,
    shoulderW: 29,
    thigh: [14, 11],
    shin: [11, 8],
    upper: [11, 9],
    fore: [9, 7.5],
    fistR: 5.6,
    head: 'thug',
    belly: 0,
    ribbon: null,
    label: 'THUG',
  },
  agile: {
    scale: 1.08,
    rim: 0xff8a2a,
    skin: 0xb98465,
    top: 0x5c1322,
    pants: 0x121216,
    upperArm: 0x5c1322,
    foreArm: 0x5c1322,
    fist: 0x101012,
    shoe: 0x0c0c0e,
    hair: 0x0a0a0c,
    accent: 0xf1f1f6,
    eye: 0xff2a2a,
    hipW: 20,
    shoulderW: 25,
    thigh: [12, 9],
    shin: [9, 6.5],
    upper: [9, 7],
    fore: [7, 6],
    fistR: 4.8,
    head: 'viper',
    belly: 0,
    ribbon: { color: 0x0a0a0c, segments: 6, length: 8, width: 5 },
    label: 'VIPER',
  },
  heavy: {
    scale: 1.32,
    rim: 0xffc233,
    skin: 0x8f6249,
    top: 0x2f3324,
    pants: 0x33291e,
    upperArm: 0x8f6249,
    foreArm: 0x8f6249,
    fist: 0x5a3d2c,
    shoe: 0x161616,
    hair: 0x24170e,
    accent: 0xe8b030,
    eye: 0xffd080,
    hipW: 30,
    shoulderW: 38,
    thigh: [17, 13],
    shin: [13, 10],
    upper: [15, 12],
    fore: [12, 10.5],
    fistR: 7,
    head: 'brute',
    belly: 15,
    ribbon: null,
    label: 'BRUTE',
  },
};

export const SIGNAL_COLORS = {
  high: 0xff7a1a,
  low: 0x18e0ff,
  mid: 0xffffff,
} as const;

export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(((a >> 16) & 0xff) * (1 - k) + ((b >> 16) & 0xff) * k);
  const g = Math.round(((a >> 8) & 0xff) * (1 - k) + ((b >> 8) & 0xff) * k);
  const bl = Math.round((a & 0xff) * (1 - k) + (b & 0xff) * k);
  return (r << 16) | (g << 8) | bl;
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
