import { ARENA_DEPTH, ARENA_WIDTH, VIEW_HEIGHT, VIEW_WIDTH } from '../game/constants';

/** Screen Y of the back edge (world y = 0) and front edge (world y = ARENA_DEPTH) of the floor. */
export const FLOOR_TOP = 438;
export const FLOOR_BOTTOM = 688;
/** Perspective scale at the back wall (front edge = 1). */
export const BACK_SCALE = 0.78;

export const HALF_W = VIEW_WIDTH / 2;
export const HALF_H = VIEW_HEIGHT / 2;

export interface ScreenPoint {
  x: number;
  y: number;
  s: number;
}

export function depthT(y: number): number {
  return y / ARENA_DEPTH;
}

export function scaleAt(y: number): number {
  return BACK_SCALE + (1 - BACK_SCALE) * depthT(y);
}

/**
 * Horizontal-tracking camera over the 2.5D arena. Gameplay coordinates
 * (x, depth y, height h) are converted to screen coordinates here only;
 * the simulation never sees screen space.
 */
export class ViewCamera {
  /** World X shown at the horizontal centre of the screen. */
  x = ARENA_WIDTH / 2;
  readonly minX = HALF_W;
  readonly maxX = ARENA_WIDTH - HALF_W;

  snap(targetX: number): void {
    this.x = this.clamp(targetX);
  }

  update(dtMs: number, targetX: number): void {
    const tx = this.clamp(targetX);
    const k = 1 - Math.exp((-dtMs / 1000) * 3.2);
    this.x += (tx - this.x) * k;
  }

  private clamp(x: number): number {
    return Math.max(this.minX, Math.min(this.maxX, x));
  }

  project(x: number, y: number, h = 0): ScreenPoint {
    const s = scaleAt(y);
    return {
      x: HALF_W + (x - this.x) * s,
      y: FLOOR_TOP + depthT(y) * (FLOOR_BOTTOM - FLOOR_TOP) - h * s,
      s,
    };
  }

  /** Screen X for a world X on a layer with the given parallax factor. */
  layerX(worldX: number, factor: number): number {
    return HALF_W + (worldX - this.x) * factor;
  }
}
