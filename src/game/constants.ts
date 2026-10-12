/**
 * Global tuning values for the simulation.
 * Times are milliseconds of simulation time, distances are world units.
 * World X = left/right, world Y = depth (0 = back wall, ARENA_DEPTH = camera side).
 */

export const VIEW_WIDTH = 1280;
export const VIEW_HEIGHT = 720;

export const ARENA_WIDTH = 1560;
export const ARENA_DEPTH = 300;

/** Fixed simulation step. Rules never depend on render frame rate. */
export const SIM_STEP_MS = 1000 / 120;
/** Longest frame delta accepted (prevents spiral of death after tab switches). */
export const MAX_FRAME_MS = 100;

export const INPUT_BUFFER_MS = 220;

// ---- Guard / parry --------------------------------------------------------
/** Parry only succeeds this long after a *fresh* guard press. */
export const PARRY_WINDOW_MS = 170;
/** Press-to-press lockout: mashing guard never yields a parry window. */
export const PARRY_REARM_MS = 320;
/** A tapped guard stays up at least this long so taps can still parry. */
export const MIN_GUARD_MS = 150;
export const PARRY_STATE_MS = 300;
export const PARRY_COUNTER_CANCEL_MS = 70;
export const PARRY_RECOIL_MS = 420;
export const PARRY_STRUCTURE_MULT = 1.4;
export const PARRY_STRUCTURE_BASE = 12;
export const GUARD_STRUCTURE_MULT = 0.85;
export const GUARD_PUSHBACK_MULT = 0.55;
export const BLOCKSTUN_MS = 150;

// ---- Avoid (duck / hop) -----------------------------------------------------
export const AVOID_DURATION_MS = 480;
export const AVOID_ACTIVE_START_MS = 20;
export const AVOID_ACTIVE_END_MS = 410;
export const AVOID_STRUCTURE_BASE = 14;
export const AVOID_STRUCTURE_MULT = 0.6;
export const WRONG_AVOID_MULT = 1.35;

// ---- Counter attacks ----------------------------------------------------------
export const COUNTER_WINDOW_MS = 600;
export const COUNTER_DAMAGE_MULT = 1.5;
export const INTERRUPT_STRUCTURE_MULT = 1.25;

// ---- Dodge ----------------------------------------------------------------------
export const DODGE_DURATION_MS = 300;
export const DODGE_DASH_MS = 220;
export const DODGE_IFRAME_MS = 200;
export const DODGE_DISTANCE = 130;
export const DODGE_DEPTH_SCALE = 0.75;
export const DODGE_COOLDOWN_MS = 360;

// ---- Hit stun & anti-infinite ---------------------------------------------------
export const STUN_CHAIN_LIMIT = 4;
export const STUN_CHAIN_GAP_MS = 260;
export const STUN_IMMUNE_MS = 1100;
export const STUN_DECAY = 0.86;
export const KNOCKBACK_DAMPING = 9;

// ---- Push / collisions ------------------------------------------------------------
export const PUSH_SPEED = 1000;
export const PUSH_DAMPING = 4.2;
export const PUSH_MIN_SPEED = 120;
export const PUSH_STUMBLE_MS = 380;
export const SHOVE_SPEED = 360;
export const SHOVE_STRUCTURE = 10;
export const SHOVE_INTERRUPT_MS = 260;
export const WALL_SLAM_MIN_SPEED = 240;
export const WALL_SLAM_DAMAGE = 14;
export const WALL_SLAM_STRUCTURE = 30;
export const COLLIDE_DAMAGE = 7;
export const COLLIDE_STRUCTURE = 16;
export const COLLIDE_DEPTH = 32;
export const SEPARATION_DEPTH = 22;

// ---- Knockdown ----------------------------------------------------------------------
export const KNOCKDOWN_FALL_MS = 320;
export const KNOCKDOWN_LIE_MS = 700;
export const SHORT_KNOCKDOWN_LIE_MS = 420;
export const KNOCKDOWN_GETUP_MS = 520;
export const GETUP_INVULN_MS = 320;

// ---- Finisher -------------------------------------------------------------------------
export const FINISHER_DURATION_MS = 1150;
export const FINISHER_HIT_TIMES = [240, 500, 820] as const;
export const FINISHER_RANGE_X = 125;
export const FINISHER_RANGE_Y = 58;
export const FINISHER_SPACING = 58;
export const FINISHER_HEAL = 10;

// ---- Combat flow ------------------------------------------------------------------------
export const COMBO_LINK_MS = 380;
export const COMBO_TIMEOUT_MS = 2300;
export const MAX_ATTACK_TOKENS = 2;
export const HITSTOP_MAX_MS = 200;

// ---- Waves --------------------------------------------------------------------------------
export const WAVE_INTRO_MS = 1800;
export const WAVE_CLEAR_MS = 1900;
export const DEATH_SETTLE_MS = 700;
export const WAVE_HEAL = 20;
