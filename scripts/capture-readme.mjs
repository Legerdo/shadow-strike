// Capture real in-game screenshots for README.md.
// Start the dev server first, then run: npm run screenshots
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:5173/';
const output = path.resolve('docs/screenshots');
const browserPaths = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = browserPaths.find((file) => existsSync(file));

if (!executablePath) {
  throw new Error('Chrome or Edge is required to capture screenshots.');
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__SHADOW_STRIKE__?.snapshot().phase === 'ready',
    { timeout: 15000 },
  );
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(output, 'title.png') });

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__SHADOW_STRIKE__?.snapshot().phase === 'playing');
  // Wait for the wave banner to finish in simulation time. Software WebGL
  // rendering can advance slower than wall time in headless browsers.
  await page.waitForFunction(
    () => window.__SHADOW_STRIKE__.world.time > 2800,
    null,
    { timeout: 30000 },
  );

  // Set up a reproducible encounter using the game's own fighters and renderer.
  await page.evaluate(() => {
    const world = window.__SHADOW_STRIKE__.world;
    const player = world.player;
    player.x = 740;
    player.y = 160;
    player.facing = 1;
    world.enemies[0].x = 826;
    world.enemies[0].y = 160;
    world.enemies[0].facing = -1;
    world.enemies[1].x = 1050;
    world.enemies[1].y = 192;
    world.enemies[1].facing = -1;
  });
  await page.waitForTimeout(180);
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(170);
  await page.screenshot({ path: path.join(output, 'combat.png') });

  console.log('Saved docs/screenshots/title.png and docs/screenshots/combat.png');
} finally {
  await browser.close();
}
