import * as Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../game/constants';
import type { GameWorld } from '../game/GameWorld';
import { CharState } from '../game/types';
import { mix } from '../render/looks';

type Graphics = Phaser.GameObjects.Graphics;
type Text = Phaser.GameObjects.Text;

const FONT = '"Arial Black", Impact, "Malgun Gothic", sans-serif';
const BODY_FONT = '"Segoe UI", "Malgun Gothic", Arial, sans-serif';

interface Banner {
  title: string;
  sub: string;
  color: string;
  life: number;
  max: number;
}

const CONTROLS: readonly [string, string][] = [
  ['WASD', '이동 (W/S = 앞뒤 깊이)'],
  ['J', '약공격 3연타'],
  ['K', '강공격 2연타 (구조 피해↑)'],
  ['SPACE 유지', '가드 – 체력 보호, 내 구조치 상승'],
  ['SPACE 타이밍', '타격 직전 누르면 패링 – 적 구조치 상승'],
  ['SPACE + S', '숙이기 – 상단(HIGH) 공격 회피'],
  ['SPACE + W', '뛰어넘기 – 하단(LOW) 공격 회피'],
  ['SHIFT', '이동 회피 (무적 시간)'],
  ['U', '경직된 적 밀치기 – 벽·적과 충돌'],
  ['E', '자세 붕괴된 적 마무리'],
  ['M', '사운드 켜기/끄기'],
];

/** Screen-space HUD and full-screen states (title, victory, defeat). Never shaken by the camera. */
export class Hud {
  private readonly g: Graphics;
  private readonly overlay: Graphics;
  private readonly playerName: Text;
  private readonly waveText: Text;
  private readonly comboText: Text;
  private readonly comboLabel: Text;
  private readonly hintText: Text;
  private readonly bannerTitle: Text;
  private readonly bannerSub: Text;
  private readonly title: Text;
  private readonly subtitle: Text;
  private readonly prompt: Text;
  private readonly controlKeys: Text[] = [];
  private readonly controlDesc: Text[] = [];
  private readonly endTitle: Text;
  private readonly endStats: Text;
  private readonly endPrompt: Text;
  private readonly signal: Text;
  private readonly muteText: Text;
  private banner: Banner | null = null;
  private dispHealth = 100;
  private dispStructure = 0;
  private comboPop = 0;
  private lastCombo = 0;
  private endShownFor = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.g = scene.add.graphics();
    this.overlay = scene.add.graphics();
    const txt = (x: number, y: number, s: string, size: number, color = '#ffffff', font = FONT): Text =>
      scene.add.text(x, y, s, { fontFamily: font, fontSize: `${size}px`, color, stroke: '#000000', strokeThickness: 4 });

    this.playerName = txt(32, 20, 'KAI', 20, '#3ef2ff');
    this.waveText = txt(VIEW_WIDTH / 2, 22, '', 22).setOrigin(0.5, 0);
    this.comboText = txt(VIEW_WIDTH - 40, 120, '', 54, '#ffe14a').setOrigin(1, 0.5);
    this.comboLabel = txt(VIEW_WIDTH - 40, 158, 'HITS', 16, '#ffffff').setOrigin(1, 0.5);
    this.hintText = txt(VIEW_WIDTH / 2, VIEW_HEIGHT - 20, '', 14, '#c9c3e6', BODY_FONT).setOrigin(0.5, 1);
    this.signal = txt(VIEW_WIDTH / 2, 64, '', 16, '#ff7a1a').setOrigin(0.5, 0);
    this.muteText = txt(VIEW_WIDTH - 20, VIEW_HEIGHT - 20, '', 13, '#8f88b0', BODY_FONT).setOrigin(1, 1);
    this.bannerTitle = txt(VIEW_WIDTH / 2, 250, '', 72, '#ffffff').setOrigin(0.5);
    this.bannerSub = txt(VIEW_WIDTH / 2, 310, '', 22, '#d8d2ff', BODY_FONT).setOrigin(0.5);
    this.bannerTitle.setStroke('#000000', 8);

    this.title = txt(VIEW_WIDTH / 2, 120, 'SHADOW STRIKE', 92, '#ffffff').setOrigin(0.5);
    this.title.setStroke('#000000', 10);
    this.title.setShadow(0, 0, '#ff3b4f', 26, true, true);
    this.subtitle = txt(VIEW_WIDTH / 2, 186, '비 내리는 밤, 지하 격투장. 관찰하고, 흘리고, 무너뜨려라.', 20, '#d8d2ff', BODY_FONT).setOrigin(0.5);
    this.prompt = txt(VIEW_WIDTH / 2, 640, 'ENTER 또는 J 키로 시작', 28, '#ffe14a').setOrigin(0.5);
    CONTROLS.forEach(([k, d], i) => {
      const y = 246 + i * 33;
      this.controlKeys.push(txt(VIEW_WIDTH / 2 - 30, y, k, 18, '#3ef2ff').setOrigin(1, 0));
      this.controlDesc.push(txt(VIEW_WIDTH / 2 - 10, y + 1, d, 17, '#ffffff', BODY_FONT));
    });

    this.endTitle = txt(VIEW_WIDTH / 2, 230, '', 96, '#ffffff').setOrigin(0.5);
    this.endTitle.setStroke('#000000', 10);
    this.endStats = txt(VIEW_WIDTH / 2, 380, '', 20, '#e6e1ff', BODY_FONT).setOrigin(0.5).setAlign('center');
    this.endStats.setLineSpacing(6);
    this.endPrompt = txt(VIEW_WIDTH / 2, 560, 'R 키로 다시 시작', 30, '#ffe14a').setOrigin(0.5);

    layer.add([
      this.g, this.playerName, this.waveText, this.comboText, this.comboLabel, this.hintText, this.signal, this.muteText,
      this.bannerTitle, this.bannerSub, this.overlay, this.title, this.subtitle, this.prompt,
      ...this.controlKeys, ...this.controlDesc, this.endTitle, this.endStats, this.endPrompt,
    ]);
  }

  showBanner(title: string, sub: string, color: string, ms = 1700): void {
    this.banner = { title, sub, color, life: 0, max: ms };
  }

  setMuted(muted: boolean): void {
    this.muteText.setText(muted ? 'SOUND OFF (M)' : 'SOUND ON (M)');
  }

  reset(): void {
    this.banner = null;
    this.dispHealth = 100;
    this.dispStructure = 0;
    this.lastCombo = 0;
    this.endShownFor = 0;
  }

  update(w: GameWorld, dtMs: number, real: number): void {
    const g = this.g;
    const o = this.overlay;
    g.clear();
    o.clear();
    const phase = w.phase;
    const playing = phase === 'playing';
    const p = w.player;

    // ---- title screen ----
    const onTitle = phase === 'ready';
    for (const t of [this.title, this.subtitle, this.prompt, ...this.controlKeys, ...this.controlDesc]) t.setVisible(onTitle);
    if (onTitle) {
      o.fillStyle(0x05040a, 0.78);
      o.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      o.fillStyle(0xff3b4f, 0.9);
      o.fillRect(VIEW_WIDTH / 2 - 300, 214, 600, 3);
      o.fillStyle(0x0d0b18, 0.9);
      o.fillRoundedRect(VIEW_WIDTH / 2 - 330, 234, 660, CONTROLS.length * 33 + 16, 10);
      o.lineStyle(2, 0x3ef2ff, 0.4);
      o.strokeRoundedRect(VIEW_WIDTH / 2 - 330, 234, 660, CONTROLS.length * 33 + 16, 10);
      this.prompt.setAlpha(0.55 + 0.45 * Math.abs(Math.sin(real * 0.003)));
    }

    // ---- gameplay HUD ----
    const showHud = !onTitle;
    for (const t of [this.playerName, this.waveText, this.hintText]) t.setVisible(showHud);
    if (showHud) {
      const k = 1 - Math.exp(-dtMs / 90);
      this.dispHealth += (p.health - this.dispHealth) * k;
      this.dispStructure += (p.structure - this.dispStructure) * Math.min(1, k * 2);
      this.drawPlayerBars(g, w, real);
      const alive = w.aliveEnemies();
      this.waveText.setText(w.waves.waveNumber > 0 ? `WAVE ${w.waves.waveNumber} / ${w.waves.total}    적 ${alive}` : '');
      this.hintText.setText(this.hint(w));
      this.drawWavePips(g, w);
    }

    // ---- combo ----
    if (w.combo !== this.lastCombo) {
      if (w.combo > this.lastCombo) this.comboPop = 1;
      this.lastCombo = w.combo;
    }
    this.comboPop = Math.max(0, this.comboPop - dtMs / 160);
    const showCombo = playing && w.combo >= 2;
    this.comboText.setVisible(showCombo);
    this.comboLabel.setVisible(showCombo);
    if (showCombo) {
      this.comboText.setText(`${w.combo}`);
      this.comboText.setScale(1 + this.comboPop * 0.35);
      this.comboText.setColor(w.combo >= 10 ? '#ff3b4f' : w.combo >= 5 ? '#ff9a2a' : '#ffe14a');
    }

    // ---- incoming unblockable warning (redundant cue near the top) ----
    let warn = '';
    let warnColor = '#ff7a1a';
    if (playing) {
      for (const e of w.enemies) {
        const a = e.attack;
        if (e.state === CharState.AttackStartup && a && a.data.unblockable) {
          warn = a.data.height === 'high' ? '⚠ HIGH 공격 – SPACE+S 로 숙이기' : '⚠ LOW 공격 – SPACE+W 로 뛰어넘기';
          warnColor = a.data.height === 'high' ? '#ff7a1a' : '#18e0ff';
          break;
        }
      }
    }
    this.signal.setText(warn).setColor(warnColor).setVisible(warn !== '');

    // ---- banner ----
    if (this.banner) {
      const b = this.banner;
      b.life += dtMs;
      const u = b.life / b.max;
      if (u >= 1) {
        this.banner = null;
      } else {
        const a = u < 0.12 ? u / 0.12 : u > 0.8 ? 1 - (u - 0.8) / 0.2 : 1;
        const sc = u < 0.12 ? 1.4 - (u / 0.12) * 0.4 : 1;
        o.fillStyle(0x000000, 0.45 * a);
        o.fillRect(0, 205, VIEW_WIDTH, 130);
        o.fillStyle(Phaser.Display.Color.HexStringToColor(b.color).color, 0.8 * a);
        o.fillRect(0, 205, VIEW_WIDTH, 3);
        o.fillRect(0, 332, VIEW_WIDTH, 3);
        this.bannerTitle.setText(b.title).setColor(b.color).setAlpha(a).setScale(sc);
        this.bannerSub.setText(b.sub).setAlpha(a);
      }
    }
    this.bannerTitle.setVisible(this.banner !== null);
    this.bannerSub.setVisible(this.banner !== null);

    // ---- victory / defeat ----
    const ended = phase === 'victory' || phase === 'defeat';
    this.endShownFor = ended ? this.endShownFor + dtMs : 0;
    for (const t of [this.endTitle, this.endStats, this.endPrompt]) t.setVisible(ended && this.endShownFor > 600);
    if (ended && this.endShownFor > 600) {
      const a = Math.min(1, (this.endShownFor - 600) / 500);
      o.fillStyle(phase === 'victory' ? 0x0a0618 : 0x180306, 0.8 * a);
      o.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
      const win = phase === 'victory';
      this.endTitle.setText(win ? 'VICTORY' : 'DEFEATED');
      this.endTitle.setColor(win ? '#ffe14a' : '#ff3b4f');
      this.endTitle.setShadow(0, 0, win ? '#ffb000' : '#ff0030', 30, true, true);
      this.endTitle.setAlpha(a);
      const s = w.stats;
      const secs = Math.round((s.endedAt - s.startedAt) / 1000);
      this.endStats.setText(
        [
          win ? '격투장의 모든 도전자를 쓰러뜨렸다.' : `WAVE ${w.waves.waveNumber} 에서 쓰러졌다.`,
          '',
          `처치 ${s.kills}    마무리 ${s.finishers}    최대 콤보 ${s.maxCombo}`,
          `패링 ${s.parries}    가드 ${s.blocks}    회피 ${s.avoids + s.dodges}    벽 충돌 ${s.wallSlams}`,
          `피격 ${s.hitsTaken}    시간 ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
        ].join('\n'),
      );
      this.endStats.setAlpha(a);
      this.endPrompt.setAlpha(a * (0.55 + 0.45 * Math.abs(Math.sin(real * 0.003))));
    }
  }

  private hint(w: GameWorld): string {
    if (w.phase !== 'playing') return '';
    const p = w.player;
    if (p.state === CharState.StructureBreak) return '자세 붕괴! 잠시 방어 불가 – 버텨라';
    if (w.time < p.counterUntil) return '반격 찬스! J / K';
    return 'J 약  K 강  SPACE 가드/패링  SPACE+S 숙이기  SPACE+W 뛰기  SHIFT 회피  U 밀치기  E 마무리';
  }

  private drawPlayerBars(g: Graphics, w: GameWorld, real: number): void {
    const p = w.player;
    const x = 32;
    const y = 50;
    const bw = 360;
    // Health.
    g.fillStyle(0x000000, 0.6);
    g.fillRect(x - 3, y - 3, bw + 6, 22);
    g.fillStyle(0x3a0c14, 1);
    g.fillRect(x, y, bw, 16);
    g.fillStyle(0xffffff, 0.7);
    g.fillRect(x, y, bw * Math.max(0, this.dispHealth / p.maxHealth), 16);
    const hpCol = p.health / p.maxHealth < 0.3 ? mix(0xff3b4f, 0xffffff, 0.5 + 0.5 * Math.sin(real * 0.012)) : 0xff3b4f;
    g.fillStyle(hpCol, 1);
    g.fillRect(x, y, bw * (p.health / p.maxHealth), 16);
    // Structure: fills from the centre outward, like pressure building.
    const sy = y + 26;
    const sw = bw;
    g.fillStyle(0x000000, 0.6);
    g.fillRect(x - 3, sy - 3, sw + 6, 14);
    g.fillStyle(0x2a2210, 1);
    g.fillRect(x, sy, sw, 8);
    const st = Math.min(1, this.dispStructure / p.maxStructure);
    const broken = p.state === CharState.StructureBreak;
    const sc = broken ? mix(0xffc233, 0xffffff, 0.5 + 0.5 * Math.sin(real * 0.03)) : st > 0.75 ? 0xffe066 : 0xe8a33a;
    g.fillStyle(sc, 1);
    g.fillRect(x + sw / 2 - (sw / 2) * st, sy, sw * st, 8);
    g.fillStyle(0xffffff, 0.5);
    g.fillRect(x + sw / 2 - 1, sy - 2, 2, 12);
    this.playerName.setText(broken ? 'KAI   ▲ 자세 붕괴' : 'KAI');
    this.playerName.setColor(broken ? '#ffc233' : '#3ef2ff');
  }

  private drawWavePips(g: Graphics, w: GameWorld): void {
    const n = w.waves.total;
    const cx = VIEW_WIDTH / 2;
    for (let i = 0; i < n; i++) {
      const x = cx + (i - (n - 1) / 2) * 26;
      const done = i < w.waves.waveNumber - 1 || (i === w.waves.waveNumber - 1 && (w.waves.phase === 'clear' || w.waves.phase === 'complete'));
      const cur = i === w.waves.waveNumber - 1;
      g.fillStyle(done ? 0xffe14a : cur ? 0xff3b4f : 0x3a3550, 1);
      g.fillRect(x - 9, 54, 18, 5);
    }
  }
}
