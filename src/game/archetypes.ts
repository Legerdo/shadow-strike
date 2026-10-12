import { ENEMY_ATTACKS } from './attacks';
import type { AttackData, CharacterKind } from './types';

export interface AttackPlan {
  readonly attacks: readonly AttackData[];
  readonly weight: number;
}

/** Gameplay stats for a fighter type. Purely data, no rendering info. */
export interface Archetype {
  readonly kind: CharacterKind;
  readonly name: string;
  readonly maxHealth: number;
  readonly maxStructure: number;
  readonly speedX: number;
  readonly speedY: number;
  readonly bodyRadius: number;
  readonly mass: number;
  readonly damageMult: number;
  readonly structureRegenDelay: number;
  /** Structure points recovered per second once not pressured. */
  readonly structureRegenRate: number;
  readonly breakDuration: number;
  readonly breakResetRatio: number;
  /** Depth-alignment assist during attack startup (units / second). */
  readonly magnetSpeed: number;
  /** Fraction of startup during which depth tracking is applied. */
  readonly magnetPortion: number;
  /** Hyper armor while winding up an attack. */
  readonly armorOnStartup: boolean;
  /** Clean hits with less hitstun than this do not stagger (0 = always flinch). */
  readonly flinchThreshold: number;
  readonly recoilMult: number;
  /** Damage dealt by a finisher. Infinity = always lethal. */
  readonly finisherDamage: number;
  // ---- AI parameters (ignored for the player) ----
  readonly reactionMs: readonly [number, number];
  readonly guardChance: number;
  readonly dodgeChance: number;
  readonly parryChance: number;
  /** Chance to raise guard right after recovering from a stagger. */
  readonly recoverGuardChance: number;
  readonly attackCooldown: readonly [number, number];
  readonly hoverDistance: readonly [number, number];
  readonly engageSpeedMult: number;
  readonly plans: readonly AttackPlan[];
}

const A = ENEMY_ATTACKS;

export const ARCHETYPES: Readonly<Record<CharacterKind, Archetype>> = {
  player: {
    kind: 'player', name: 'KAI',
    maxHealth: 100, maxStructure: 100,
    speedX: 270, speedY: 190, bodyRadius: 22, mass: 1, damageMult: 1,
    structureRegenDelay: 1400, structureRegenRate: 24,
    breakDuration: 1150, breakResetRatio: 0.45,
    magnetSpeed: 170, magnetPortion: 1,
    armorOnStartup: false, flinchThreshold: 0, recoilMult: 1,
    finisherDamage: Infinity,
    reactionMs: [0, 0], guardChance: 0, dodgeChance: 0, parryChance: 0, recoverGuardChance: 0,
    attackCooldown: [0, 0], hoverDistance: [0, 0], engageSpeedMult: 1, plans: [],
  },
  normal: {
    kind: 'normal', name: 'THUG',
    maxHealth: 80, maxStructure: 100,
    speedX: 150, speedY: 110, bodyRadius: 23, mass: 1, damageMult: 1,
    structureRegenDelay: 1800, structureRegenRate: 14,
    breakDuration: 2700, breakResetRatio: 0.5,
    magnetSpeed: 70, magnetPortion: 0.6,
    armorOnStartup: false, flinchThreshold: 0, recoilMult: 1,
    finisherDamage: Infinity,
    reactionMs: [300, 480], guardChance: 0.4, dodgeChance: 0, parryChance: 0.05, recoverGuardChance: 0.45,
    attackCooldown: [950, 1800], hoverDistance: [200, 250], engageSpeedMult: 1.1,
    plans: [
      { attacks: [A.thugJab, A.thugCross], weight: 4 },
      { attacks: [A.thugJab], weight: 1.5 },
      { attacks: [A.thugHaymaker], weight: 2 },
      { attacks: [A.thugSweep], weight: 1.6 },
    ],
  },
  agile: {
    kind: 'agile', name: 'VIPER',
    maxHealth: 75, maxStructure: 90,
    speedX: 235, speedY: 170, bodyRadius: 21, mass: 0.9, damageMult: 1,
    structureRegenDelay: 1500, structureRegenRate: 18,
    breakDuration: 2500, breakResetRatio: 0.5,
    magnetSpeed: 90, magnetPortion: 0.6,
    armorOnStartup: false, flinchThreshold: 0, recoilMult: 0.85,
    finisherDamage: Infinity,
    reactionMs: [170, 280], guardChance: 0.3, dodgeChance: 0.35, parryChance: 0.25, recoverGuardChance: 0.4,
    attackCooldown: [650, 1250], hoverDistance: [210, 270], engageSpeedMult: 1.25,
    plans: [
      { attacks: [A.viperJab, A.viperCross, A.viperKnee], weight: 3.5 },
      { attacks: [A.viperHighKick], weight: 2 },
      { attacks: [A.viperLowKick], weight: 2 },
      { attacks: [A.viperJab, A.viperCross, A.viperLowKick], weight: 1.6 },
      { attacks: [A.viperJab, A.viperHighKick], weight: 1.2 },
    ],
  },
  heavy: {
    kind: 'heavy', name: 'BRUTE',
    maxHealth: 170, maxStructure: 170,
    speedX: 105, speedY: 80, bodyRadius: 30, mass: 2.5, damageMult: 1,
    structureRegenDelay: 1300, structureRegenRate: 26,
    breakDuration: 2800, breakResetRatio: 0.55,
    magnetSpeed: 60, magnetPortion: 0.55,
    armorOnStartup: true, flinchThreshold: 500, recoilMult: 0.6,
    finisherDamage: 100,
    reactionMs: [380, 560], guardChance: 0.35, dodgeChance: 0, parryChance: 0.1, recoverGuardChance: 0.5,
    attackCooldown: [1200, 2000], hoverDistance: [180, 230], engageSpeedMult: 1.15,
    plans: [
      { attacks: [A.bruteHammer], weight: 3 },
      { attacks: [A.bruteLariat], weight: 2 },
      { attacks: [A.bruteStomp], weight: 2 },
      { attacks: [A.bruteHammer, A.bruteLariat], weight: 1 },
    ],
  },
};
