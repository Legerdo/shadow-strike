import type { InputAction, InputFrame } from '../game/PlayerController';

/** Physical key (KeyboardEvent.code) -> edge action. */
const PRESS_MAP: Readonly<Record<string, InputAction>> = {
  KeyJ: 'light',
  KeyK: 'heavy',
  Space: 'guard',
  ShiftLeft: 'dodge',
  ShiftRight: 'dodge',
  KeyU: 'push',
  KeyE: 'finisher',
  KeyW: 'up',
  KeyS: 'down',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyR: 'restart',
  Enter: 'start',
};

const GAME_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyJ', 'KeyK', 'KeyU', 'KeyE', 'KeyR', 'KeyM',
  'Space', 'ShiftLeft', 'ShiftRight', 'Enter',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

/**
 * Raw DOM keyboard listener using physical key codes, so it works with any
 * keyboard layout (including Korean IME). Presses are queued between frames
 * so even very short taps are never lost.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();
  private pressed: InputAction[] = [];
  private readonly extraHandlers: ((code: string) => void)[] = [];
  private readonly target: Window;

  private readonly onDown = (e: KeyboardEvent): void => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.held.add(e.code);
    const a = PRESS_MAP[e.code];
    if (a) {
      this.pressed.push(a);
      // Any game key also counts as "start" on the title screen except movement.
      if (a !== 'up' && a !== 'down' && a !== 'start' && a !== 'restart') this.pressed.push('start');
    }
    for (const h of this.extraHandlers) h(e.code);
  };

  private readonly onUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.held.clear();
  };

  constructor(target: Window = window) {
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  onKey(handler: (code: string) => void): void {
    this.extraHandlers.push(handler);
  }

  private isHeld(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** Snapshot for this frame; clears the queued presses. */
  poll(): InputFrame {
    const frame: InputFrame = {
      up: this.isHeld('KeyW', 'ArrowUp'),
      down: this.isHeld('KeyS', 'ArrowDown'),
      left: this.isHeld('KeyA', 'ArrowLeft'),
      right: this.isHeld('KeyD', 'ArrowRight'),
      guard: this.isHeld('Space'),
      pressed: this.pressed,
    };
    this.pressed = [];
    return frame;
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
