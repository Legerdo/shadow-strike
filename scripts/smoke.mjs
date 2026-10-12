// Browser smoke test: launches a local Chrome/Edge via playwright-core against a
// running dev server, drives the game with real keyboard input and reports results.
// Usage: npm run dev (separate terminal), then: node scripts/smoke.mjs [url]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const OUT = path.resolve('artifacts');
fs.mkdirSync(OUT, { recursive: true });

const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = candidates.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error('No Chrome/Edge found');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

const snap = () => page.evaluate(() => window.__SHADOW_STRIKE__.snapshot());
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(URL);
await page.waitForFunction(() => !!window.__SHADOW_STRIKE__, null, { timeout: 15000 });
await sleep(800);
const renderer = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  return c ? (c.getContext('webgl2') || c.getContext('webgl') ? 'webgl' : 'other') : 'none';
});
check('canvas rendered', renderer !== 'none', renderer);
await page.screenshot({ path: path.join(OUT, '01-title.png') });

let s = await snap();
check('title phase', s.phase === 'ready', s.phase);

await page.keyboard.press('Enter');
await sleep(300);
s = await snap();
check('Enter starts wave 1', s.phase === 'playing' && s.wave === 1 && s.enemies.length === 2, `phase=${s.phase} wave=${s.wave} enemies=${s.enemies.map((e) => e.kind)}`);

// Movement: D (right) then W (depth up).
const x0 = s.player.x;
await page.keyboard.down('KeyD');
await sleep(500);
await page.keyboard.up('KeyD');
const y0 = (await snap()).player.y;
await page.keyboard.down('KeyW');
await sleep(400);
await page.keyboard.up('KeyW');
s = await snap();
check('D moves right', s.player.x > x0 + 60, `${x0} -> ${s.player.x}`);
check('W moves back in depth', s.player.y < y0 - 30, `${y0} -> ${s.player.y}`);

// Attacks.
await page.keyboard.press('KeyJ');
await sleep(30);
s = await snap();
check('J starts an attack', s.player.state.startsWith('Attack'), s.player.state);
await sleep(700);
await page.keyboard.press('KeyK');
await sleep(30);
s = await snap();
check('K starts an attack', s.player.state.startsWith('Attack'), s.player.state);
await sleep(900);

// Guard hold.
await page.keyboard.down('Space');
await sleep(250);
s = await snap();
check('Space held = Guard', s.player.state === 'Guard', s.player.state);
await page.keyboard.down('KeyS');
await sleep(40);
s = await snap();
check('Space+S = AvoidHigh (duck)', s.player.state === 'AvoidHigh', s.player.state);
await page.keyboard.up('KeyS');
await sleep(600);
await page.keyboard.down('KeyW');
await sleep(40);
s = await snap();
check('Space+W = AvoidLow (hop)', s.player.state === 'AvoidLow', s.player.state);
await page.keyboard.up('KeyW');
await page.keyboard.up('Space');
await sleep(600);
await page.keyboard.press('ShiftLeft');
await sleep(40);
s = await snap();
check('Shift = Dodge', s.player.state === 'Dodge', s.player.state);
await sleep(500);

// ---------------------------------------------------------------------------
// In-page bot: plays with real KeyboardEvents (same path as a human) using the
// visible telegraphs: parry mids, duck highs, hop lows, punish, push, finish.
// ---------------------------------------------------------------------------
await page.evaluate(() => {
  const api = window.__SHADOW_STRIKE__;
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  const tap = (code) => {
    key('keydown', code);
    setTimeout(() => key('keyup', code), 60);
  };
  const held = new Set();
  const hold = (code, on) => {
    if (on && !held.has(code)) {
      held.add(code);
      key('keydown', code);
    } else if (!on && held.has(code)) {
      held.delete(code);
      key('keyup', code);
    }
  };
  let busyUntil = 0;
  const bot = { ticks: 0, actions: {} };
  const act = (name) => (bot.actions[name] = (bot.actions[name] ?? 0) + 1);
  window.__bot = bot;
  bot.timer = setInterval(() => {
    const w = api.world;
    if (w.phase !== 'playing') {
      for (const c of [...held]) hold(c, false);
      return;
    }
    bot.ticks++;
    const now = performance.now();
    const p = w.player;
    const alive = w.enemies.filter((e) => e.alive);
    // Defence first: react to enemy wind-ups that are about to land.
    for (const e of alive) {
      const a = e.attack;
      if (e.state !== 'AttackStartup' || !a) continue;
      const left = a.data.startup - e.stateTime;
      const close = Math.abs(e.x - p.x) < 170 && Math.abs(e.y - p.y) < 50;
      if (!close) continue;
      if (left > 120) {
        // Incoming: stop committing to attacks and watch the wind-up.
        if (p.state.startsWith('Attack')) continue;
        for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) hold(c, false);
        return;
      }
      if (left < 10 || bot.lastReactUid === a.uid) continue;
      bot.lastReactUid = a.uid;
      for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) hold(c, false);
      if (a.data.height === 'high') {
        key('keydown', 'KeyS');
        tap('Space');
        setTimeout(() => key('keyup', 'KeyS'), 120);
        act('duck');
      } else if (a.data.height === 'low') {
        key('keydown', 'KeyW');
        tap('Space');
        setTimeout(() => key('keyup', 'KeyW'), 120);
        act('hop');
      } else {
        tap('Space');
        act('parry');
      }
      busyUntil = now + 260;
      return;
    }
    if (now < busyUntil) return;
    // Offence.
    let target = null;
    let best = Infinity;
    for (const e of alive) {
      const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y) * 2;
      if (d < best) {
        best = d;
        target = e;
      }
    }
    if (!target) return;
    if (target.state === 'StructureBreak' && Math.abs(target.x - p.x) < 110 && Math.abs(target.y - p.y) < 50) {
      tap('KeyE');
      act('finish');
      busyUntil = now + 1300;
      return;
    }
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const inRange = Math.abs(dx) < 95 && Math.abs(dy) < 16;
    if (inRange) {
      for (const c of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) hold(c, false);
      if (target.state === 'HitStun' && Math.random() < 0.25) {
        tap('KeyU');
        act('push');
        busyUntil = now + 450;
      } else if (Math.random() < 0.3) {
        tap('KeyK');
        act('heavy');
        busyUntil = now + 380;
      } else {
        tap('KeyJ');
        act('light');
        busyUntil = now + 180;
      }
      return;
    }
    hold('KeyD', dx > 70);
    hold('KeyA', dx < -70);
    hold('KeyS', dy > 8);
    hold('KeyW', dy < -8);
  }, 33);
});

const t0 = Date.now();
let shot2 = false;
let lastWave = 0;
const waveTimes = [];
while (Date.now() - t0 < 200_000) {
  await sleep(1000);
  s = await snap();
  if (s.wave !== lastWave) {
    waveTimes.push({ wave: s.wave, t: Math.round((Date.now() - t0) / 1000) });
    lastWave = s.wave;
  }
  if (!shot2 && s.enemies.some((e) => e.state.startsWith('Attack')) && Date.now() - t0 > 4000) {
    await page.screenshot({ path: path.join(OUT, '02-combat.png') });
    shot2 = true;
  }
  if (s.phase !== 'playing') break;
}
const bot = await page.evaluate(() => {
  clearInterval(window.__bot.timer);
  return { ticks: window.__bot.ticks, actions: window.__bot.actions };
});
s = await snap();
console.log('bot actions', JSON.stringify(bot.actions));
console.log('waves reached', JSON.stringify(waveTimes));
console.log('stats', JSON.stringify(s.stats), 'phase', s.phase, 'hp', s.player.health);
check('bot fought (enemies killed)', s.stats.kills >= 2, `kills=${s.stats.kills}`);
// Bot timing depends on browser frame pacing, so live parries are informational; parry is
// verified deterministically below and in the unit tests.
console.log(`INFO  live-play parries=${s.stats.parries}`);
check('defensive actions happened in live play', s.stats.parries + s.stats.avoids + s.stats.blocks + s.stats.dodges > 0, `parries=${s.stats.parries} avoids=${s.stats.avoids} blocks=${s.stats.blocks} dodges=${s.stats.dodges}`);
check('run ended in victory or defeat', s.phase === 'victory' || s.phase === 'defeat', s.phase);
await sleep(1400);
await page.screenshot({ path: path.join(OUT, `03-end-${s.phase}.png`) });

// Restart with R, then force a defeat and a victory to verify both screens + restart.
await page.keyboard.press('KeyR');
await sleep(300);
s = await snap();
check('R restarts to wave 1', s.phase === 'playing' && s.wave === 1 && s.player.health === 100, `phase=${s.phase} wave=${s.wave}`);

// Controlled parry / guard scenario with real key events timed off the enemy wind-up.
const defence = await page.evaluate(async () => {
  const w = window.__SHADOW_STRIKE__.world;
  const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const e = w.enemies[0];
  const other = w.enemies[1];
  const out = {};
  const setup = () => {
    const p = w.player;
    p.x = 700; p.y = 150; p.facing = 1;
    e.x = 772; e.y = 150; e.facing = -1;
    if (other) { other.x = 1400; other.y = 40; }
  };
  // 1) parry: fresh press ~90 ms before impact
  await wait(2200); // let the wave intro finish
  setup();
  const parriesBefore = w.stats.parries;
  w.enemyStartAttack(e, e.arch.plans[0].attacks[0]);
  await new Promise((resolve) => {
    const tick = () => {
      const a = e.attack;
      if (a && e.state === 'AttackStartup' && a.data.startup - e.stateTime <= 90) {
        key('keydown', 'Space');
        setTimeout(() => key('keyup', 'Space'), 200);
        resolve();
      } else requestAnimationFrame(tick);
    };
    tick();
  });
  await wait(500);
  out.parry = w.stats.parries - parriesBefore;
  out.enemyStructure = e.structure;
  // 2) hold guard long before the hit: block, own structure rises
  await wait(900);
  setup();
  const hpBefore = w.player.health;
  key('keydown', 'Space');
  await wait(400);
  const blocksBefore = w.stats.blocks;
  w.enemyStartAttack(e, e.arch.plans[0].attacks[0]);
  await wait(900);
  key('keyup', 'Space');
  out.block = w.stats.blocks - blocksBefore;
  out.hpLost = hpBefore - w.player.health;
  out.playerStructure = w.player.structure;
  return out;
});
check('timed Space press parries (browser)', defence.parry === 1 && defence.enemyStructure > 0, JSON.stringify(defence));
check('held Space blocks: no HP loss, own structure up', defence.block === 1 && defence.hpLost === 0 && defence.playerStructure > 0, JSON.stringify(defence));

await page.evaluate(() => window.__SHADOW_STRIKE__.world.debugSetPlayerHealth(0));
await sleep(1500);
s = await snap();
check('defeat screen', s.phase === 'defeat', s.phase);
await page.keyboard.press('KeyR');
await sleep(300);
s = await snap();
check('restart after defeat', s.phase === 'playing' && s.wave === 1, `phase=${s.phase}`);

for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__SHADOW_STRIKE__.world.debugKillAllEnemies());
  await sleep(3200);
}
s = await snap();
check('forced clears reach victory', s.phase === 'victory', `phase=${s.phase} wave=${s.wave}`);
await sleep(1300);
await page.screenshot({ path: path.join(OUT, '04-victory.png') });
await page.keyboard.press('KeyR');
await sleep(300);
s = await snap();
check('restart after victory', s.phase === 'playing' && s.wave === 1, `phase=${s.phase}`);

const fps = await page.evaluate(() => window.__SHADOW_STRIKE__.fps());
console.log('fps (headless swiftshader)', Math.round(fps));
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
process.exit(failed.length ? 1 : 0);
