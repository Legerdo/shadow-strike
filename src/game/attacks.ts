import type { AttackData } from './types';

type AttackSpec = Omit<AttackData, 'kind' | 'unblockable' | 'knockdown' | 'hitstop' | 'lunge' | 'depth'> &
  Partial<Pick<AttackData, 'kind' | 'unblockable' | 'knockdown' | 'hitstop' | 'lunge' | 'depth'>>;

function attack(spec: AttackSpec): AttackData {
  return Object.freeze({
    kind: 'strike',
    unblockable: false,
    knockdown: false,
    hitstop: 60,
    lunge: 16,
    depth: 26,
    ...spec,
  });
}

// ---------------------------------------------------------------------------
// Player moves
// ---------------------------------------------------------------------------
export const PLAYER_ATTACKS = {
  light1: attack({
    id: 'p_l1', name: 'Lead Jab', anim: 'jab', limb: 'handF', height: 'mid',
    startup: 70, active: 60, recovery: 180, cancelAt: 70,
    reach: 70, damage: 6, structure: 7, hitstun: 300, knockback: 150, lunge: 18, hitstop: 55,
  }),
  light2: attack({
    id: 'p_l2', name: 'Rear Cross', anim: 'cross', limb: 'handB', height: 'mid',
    startup: 85, active: 60, recovery: 200, cancelAt: 80,
    reach: 76, damage: 7, structure: 8, hitstun: 320, knockback: 170, lunge: 22, hitstop: 60,
  }),
  light3: attack({
    id: 'p_l3', name: 'Crescent Kick', anim: 'roundhouse', limb: 'footF', height: 'mid',
    startup: 140, active: 80, recovery: 300, cancelAt: 170,
    reach: 94, depth: 30, damage: 10, structure: 13, hitstun: 520, knockback: 340, lunge: 26, hitstop: 85,
  }),
  heavy1: attack({
    id: 'p_h1', name: 'Iron Palm', anim: 'palm', limb: 'handF', height: 'mid',
    startup: 230, active: 80, recovery: 330, cancelAt: 170,
    reach: 82, depth: 28, damage: 12, structure: 22, hitstun: 560, knockback: 380, lunge: 32, hitstop: 95,
  }),
  heavy2: attack({
    id: 'p_h2', name: 'Spinning Back Kick', anim: 'backkick', limb: 'footB', height: 'mid',
    startup: 290, active: 90, recovery: 420, cancelAt: 250,
    reach: 104, depth: 30, damage: 16, structure: 30, hitstun: 700, knockback: 520, lunge: 34, hitstop: 120,
  }),
  push: attack({
    id: 'p_push', name: 'Shove', anim: 'push', limb: 'handF', height: 'mid', kind: 'push',
    startup: 110, active: 80, recovery: 300, cancelAt: 190,
    reach: 80, depth: 30, damage: 0, structure: 0, hitstun: 0, knockback: 0, lunge: 14, hitstop: 90,
  }),
} as const;

export const LIGHT_CHAIN: readonly AttackData[] = [PLAYER_ATTACKS.light1, PLAYER_ATTACKS.light2, PLAYER_ATTACKS.light3];
export const HEAVY_CHAIN: readonly AttackData[] = [PLAYER_ATTACKS.heavy1, PLAYER_ATTACKS.heavy2];

// ---------------------------------------------------------------------------
// Enemy moves. Long, readable startups; high/low moves are unblockable.
// ---------------------------------------------------------------------------
export const ENEMY_ATTACKS = {
  // Thug (normal)
  thugJab: attack({
    id: 'e_thug_jab', name: 'Jab', anim: 'jab', limb: 'handF', height: 'mid',
    startup: 430, active: 70, recovery: 380, cancelAt: 110,
    reach: 72, damage: 8, structure: 10, hitstun: 360, knockback: 210, lunge: 28, hitstop: 70,
  }),
  thugCross: attack({
    id: 'e_thug_cross', name: 'Cross', anim: 'cross', limb: 'handB', height: 'mid',
    startup: 320, active: 70, recovery: 460, cancelAt: 200,
    reach: 76, damage: 9, structure: 12, hitstun: 400, knockback: 240, lunge: 24, hitstop: 75,
  }),
  thugHaymaker: attack({
    id: 'e_thug_haymaker', name: 'Haymaker', anim: 'haymaker', limb: 'handB', height: 'high', unblockable: true,
    startup: 660, active: 90, recovery: 620, cancelAt: 400,
    reach: 82, damage: 14, structure: 20, hitstun: 520, knockback: 340, lunge: 34, hitstop: 100,
  }),
  thugSweep: attack({
    id: 'e_thug_sweep', name: 'Leg Sweep', anim: 'sweep', limb: 'footF', height: 'low', unblockable: true,
    startup: 640, active: 100, recovery: 640, cancelAt: 420,
    reach: 90, damage: 11, structure: 18, hitstun: 0, knockback: 200, lunge: 26, hitstop: 90, knockdown: true,
  }),

  // Viper (agile)
  viperJab: attack({
    id: 'e_viper_jab', name: 'Snap Jab', anim: 'jab', limb: 'handF', height: 'mid',
    startup: 320, active: 55, recovery: 220, cancelAt: 80,
    reach: 70, damage: 5, structure: 8, hitstun: 280, knockback: 170, lunge: 30, hitstop: 55,
  }),
  viperCross: attack({
    id: 'e_viper_cross', name: 'Snap Cross', anim: 'cross', limb: 'handB', height: 'mid',
    startup: 210, active: 55, recovery: 220, cancelAt: 80,
    reach: 74, damage: 5, structure: 8, hitstun: 280, knockback: 170, lunge: 20, hitstop: 55,
  }),
  viperKnee: attack({
    id: 'e_viper_knee', name: 'Flying Knee', anim: 'knee', limb: 'footF', height: 'mid',
    startup: 250, active: 70, recovery: 480, cancelAt: 260,
    reach: 72, damage: 8, structure: 12, hitstun: 420, knockback: 300, lunge: 34, hitstop: 80,
  }),
  viperHighKick: attack({
    id: 'e_viper_highkick', name: 'Whip Kick', anim: 'highkick', limb: 'footF', height: 'high', unblockable: true,
    startup: 540, active: 80, recovery: 520, cancelAt: 300,
    reach: 96, depth: 28, damage: 12, structure: 18, hitstun: 480, knockback: 320, lunge: 30, hitstop: 95,
  }),
  viperLowKick: attack({
    id: 'e_viper_lowkick', name: 'Ground Sweep', anim: 'sweep', limb: 'footF', height: 'low', unblockable: true,
    startup: 520, active: 90, recovery: 540, cancelAt: 300,
    reach: 94, damage: 10, structure: 16, hitstun: 0, knockback: 200, lunge: 28, hitstop: 85, knockdown: true,
  }),

  // Brute (heavy)
  bruteHammer: attack({
    id: 'e_brute_hammer', name: 'Hammer Fist', anim: 'hammer', limb: 'handF', height: 'mid',
    startup: 720, active: 110, recovery: 760, cancelAt: 420,
    reach: 96, depth: 32, damage: 18, structure: 30, hitstun: 600, knockback: 430, lunge: 30, hitstop: 130,
  }),
  bruteLariat: attack({
    id: 'e_brute_lariat', name: 'Lariat', anim: 'lariat', limb: 'handB', height: 'high', unblockable: true,
    startup: 760, active: 120, recovery: 780, cancelAt: 500,
    reach: 104, depth: 34, damage: 22, structure: 32, hitstun: 650, knockback: 520, lunge: 44, hitstop: 140,
  }),
  bruteStomp: attack({
    id: 'e_brute_stomp', name: 'Quake Stomp', anim: 'stomp', limb: 'footF', height: 'low', unblockable: true,
    startup: 740, active: 120, recovery: 760, cancelAt: 500,
    reach: 104, depth: 36, damage: 18, structure: 26, hitstun: 0, knockback: 260, lunge: 22, hitstop: 120, knockdown: true,
  }),
} as const;

export const ALL_ATTACKS: readonly AttackData[] = [
  ...Object.values(PLAYER_ATTACKS),
  ...Object.values(ENEMY_ATTACKS),
];
