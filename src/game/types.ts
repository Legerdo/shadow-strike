/** Finite state machine states shared by every fighter. */
export const CharState = {
  Idle: 'Idle',
  Move: 'Move',
  AttackStartup: 'AttackStartup',
  AttackActive: 'AttackActive',
  AttackRecovery: 'AttackRecovery',
  Guard: 'Guard',
  Parry: 'Parry',
  AvoidHigh: 'AvoidHigh',
  AvoidLow: 'AvoidLow',
  Dodge: 'Dodge',
  HitStun: 'HitStun',
  Pushed: 'Pushed',
  Knockdown: 'Knockdown',
  StructureBreak: 'StructureBreak',
  Finisher: 'Finisher',
  Dead: 'Dead',
} as const;
export type CharState = (typeof CharState)[keyof typeof CharState];

export type Team = 'player' | 'enemy';
export type AttackHeight = 'mid' | 'high' | 'low';
export type Limb = 'handF' | 'handB' | 'footF' | 'footB';
export type EnemyKind = 'normal' | 'agile' | 'heavy';
export type CharacterKind = 'player' | EnemyKind;
export type AttackKind = 'strike' | 'push';

/** Animation clip identifiers used by the renderer. */
export type AttackAnim =
  | 'jab'
  | 'cross'
  | 'roundhouse'
  | 'palm'
  | 'backkick'
  | 'push'
  | 'haymaker'
  | 'sweep'
  | 'highkick'
  | 'hammer'
  | 'stomp'
  | 'lariat'
  | 'knee';

export interface AttackData {
  readonly id: string;
  readonly name: string;
  readonly anim: AttackAnim;
  /** Striking limb, used for trails and glints. */
  readonly limb: Limb;
  readonly height: AttackHeight;
  readonly kind: AttackKind;
  readonly startup: number;
  readonly active: number;
  readonly recovery: number;
  /** Time into recovery after which the move can chain / be cancelled. */
  readonly cancelAt: number;
  /** Forward reach measured from attacker centre to the target's body edge. */
  readonly reach: number;
  /** Maximum depth (world Y) difference that can still connect. */
  readonly depth: number;
  readonly damage: number;
  readonly structure: number;
  /** Stagger applied on a clean hit (0 = no stagger). */
  readonly hitstun: number;
  readonly knockback: number;
  /** Forward travel during startup. */
  readonly lunge: number;
  readonly hitstop: number;
  /** Cannot be guarded or parried: must be avoided or dodged. */
  readonly unblockable: boolean;
  readonly knockdown: boolean;
}
