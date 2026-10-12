import * as Phaser from 'phaser';
import { VIEW_HEIGHT, VIEW_WIDTH } from './game/constants';
import { GameScene } from './scenes/GameScene';

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: '#05040a',
  antialias: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  fps: { target: 60, smoothStep: true },
  input: { keyboard: false, mouse: true, touch: false },
  scene: [GameScene],
});

// Keep keyboard focus on the page so key events reach the game.
window.addEventListener('pointerdown', () => window.focus());

export default game;
