/**
 * Procedural sound effects with the Web Audio API (no audio files).
 * The AudioContext is created lazily on the first user gesture.
 */
export type SfxName =
  | 'whoosh'
  | 'whooshHeavy'
  | 'hit'
  | 'hitHeavy'
  | 'counter'
  | 'block'
  | 'parry'
  | 'avoid'
  | 'wrong'
  | 'dodge'
  | 'telegraphHigh'
  | 'telegraphLow'
  | 'break'
  | 'guardBreak'
  | 'push'
  | 'wall'
  | 'collide'
  | 'thud'
  | 'finisher'
  | 'finisherFinal'
  | 'death'
  | 'wave'
  | 'victory'
  | 'defeat'
  | 'ui';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private rainSrc: AudioBufferSourceNode | null = null;
  private lastPlayed = new Map<SfxName, number>();
  muted = false;

  /** Must be called from a user gesture handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startRain();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  private startRain(): void {
    const c = this.ctx;
    if (!c || !this.noise || !this.master) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 0.4;
    const g = c.createGain();
    g.gain.value = 0.045;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.rainSrc = src;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(filter: BiquadFilterType, freq: number, dur: number, vol: number, q = 1, delay = 0, freqEnd?: number): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(name: SfxName): void {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    if (now - last < 30) return; // prevent stacking the same sound in one frame
    this.lastPlayed.set(name, now);
    switch (name) {
      case 'whoosh':
        this.burst('bandpass', 900, 0.12, 0.25, 0.8, 0, 2600);
        break;
      case 'whooshHeavy':
        this.burst('bandpass', 500, 0.22, 0.35, 0.7, 0, 1600);
        break;
      case 'hit':
        this.tone('sine', 190, 60, 0.12, 0.7);
        this.burst('lowpass', 2200, 0.08, 0.55);
        break;
      case 'hitHeavy':
        this.tone('sine', 140, 40, 0.22, 0.9);
        this.burst('lowpass', 1500, 0.16, 0.7);
        this.tone('square', 80, 40, 0.08, 0.15);
        break;
      case 'counter':
        this.tone('sine', 160, 45, 0.24, 0.9);
        this.burst('lowpass', 2600, 0.15, 0.7);
        this.tone('triangle', 1400, 900, 0.18, 0.18);
        break;
      case 'block':
        this.burst('bandpass', 1300, 0.07, 0.5, 2);
        this.tone('triangle', 320, 200, 0.07, 0.25);
        break;
      case 'parry':
        this.tone('triangle', 2400, 1800, 0.35, 0.3);
        this.tone('sine', 3600, 3400, 0.25, 0.15);
        this.burst('highpass', 4000, 0.06, 0.4);
        break;
      case 'avoid':
        this.burst('bandpass', 1800, 0.18, 0.3, 1.2, 0, 600);
        this.tone('sine', 900, 1500, 0.12, 0.12);
        break;
      case 'wrong':
        this.tone('sawtooth', 220, 110, 0.18, 0.2);
        break;
      case 'dodge':
        this.burst('bandpass', 1400, 0.14, 0.25, 0.8, 0, 500);
        break;
      case 'telegraphHigh':
        this.tone('square', 880, 1320, 0.09, 0.08);
        this.tone('square', 1320, 1320, 0.07, 0.07, 0.1);
        break;
      case 'telegraphLow':
        this.tone('square', 660, 330, 0.09, 0.08);
        this.tone('square', 330, 330, 0.07, 0.07, 0.1);
        break;
      case 'break':
        this.tone('sawtooth', 300, 60, 0.45, 0.3);
        this.burst('lowpass', 900, 0.4, 0.6);
        this.tone('triangle', 1800, 600, 0.3, 0.15);
        break;
      case 'guardBreak':
        this.tone('sawtooth', 200, 50, 0.4, 0.3);
        this.burst('bandpass', 700, 0.35, 0.6);
        break;
      case 'push':
        this.burst('lowpass', 700, 0.18, 0.6);
        this.tone('sine', 110, 50, 0.18, 0.6);
        break;
      case 'wall':
        this.tone('sine', 90, 30, 0.35, 1);
        this.burst('lowpass', 1100, 0.3, 0.8);
        this.burst('bandpass', 3000, 0.25, 0.25, 3, 0.02); // fence rattle
        break;
      case 'collide':
        this.tone('sine', 120, 40, 0.28, 0.9);
        this.burst('lowpass', 900, 0.22, 0.7);
        break;
      case 'thud':
        this.tone('sine', 80, 35, 0.2, 0.6);
        this.burst('lowpass', 400, 0.18, 0.4);
        break;
      case 'finisher':
        this.tone('sine', 200, 60, 0.18, 0.8);
        this.burst('lowpass', 2400, 0.12, 0.6);
        break;
      case 'finisherFinal':
        this.tone('sine', 120, 30, 0.6, 1);
        this.burst('lowpass', 1800, 0.5, 0.9);
        this.tone('triangle', 1600, 400, 0.6, 0.2);
        break;
      case 'death':
        this.tone('triangle', 300, 80, 0.5, 0.2);
        break;
      case 'wave':
        this.tone('square', 220, 220, 0.12, 0.12);
        this.tone('square', 330, 330, 0.12, 0.12, 0.13);
        this.tone('square', 440, 440, 0.25, 0.12, 0.26);
        this.burst('lowpass', 300, 0.5, 0.4, 1, 0.26);
        break;
      case 'victory':
        [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.22, i * 0.14));
        break;
      case 'defeat':
        [392, 330, 262, 196].forEach((f, i) => this.tone('sawtooth', f, f * 0.98, 0.4, 0.12, i * 0.2));
        break;
      case 'ui':
        this.tone('square', 660, 990, 0.06, 0.08);
        break;
    }
  }

  destroy(): void {
    try {
      this.rainSrc?.stop();
      void this.ctx?.close();
    } catch {
      // ignore
    }
    this.ctx = null;
  }
}
