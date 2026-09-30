// Audio probe: node churn, live voices and decoded music memory per screen.
// Usage: node audio-probe.mjs [--rate 6]
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, newPhonePage, BASE, throttle, waitIdle, round } from './lib.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const RATE = Number(arg('rate', 1));
const OUT = new URL('./results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await launch();
const { page, cdp } = await newPhonePage(browser);
await throttle(cdp, RATE);
await page.goto(`${BASE}/?seed=7&audiodebug=1&enemy=thornox,kordane,calderoc`);
await page.locator('[data-action="quick"]').waitFor({ timeout: 120000 });
await page.mouse.click(5, 5);
await page.waitForFunction(() => globalThis.__NOAM_SOUND__?.ctx?.state === 'running', null, {
  timeout: 20000,
});
await page.evaluate(() => {
  const s = globalThis.__NOAM_SOUND__;
  const P = (globalThis.__audio = { maxLive: 0, maxSources: 0, maxMusicBytes: 0 });
  setInterval(() => {
    P.maxLive = Math.max(P.maxLive, s._nodeCount);
    P.maxSources = Math.max(P.maxSources, s.musicSources.size + s.sfxSources.size);
    P.maxMusicBytes = Math.max(P.maxMusicBytes, s.musicBytes());
  }, 50);
});
const info = await page.evaluate(() => {
  const c = globalThis.__NOAM_SOUND__.ctx;
  return { sampleRate: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency };
});
console.log('AudioContext', info);

async function window(name, fn) {
  const before = await page.evaluate(() => {
    const s = globalThis.__NOAM_SOUND__,
      P = globalThis.__audio;
    P.maxLive = s._nodeCount;
    P.maxSources = 0;
    P.maxMusicBytes = s.musicBytes();
    return { created: s._createdNodeCount, t: performance.now() };
  });
  await fn();
  const after = await page.evaluate(() => {
    const s = globalThis.__NOAM_SOUND__,
      P = globalThis.__audio;
    return {
      created: s._createdNodeCount,
      live: s._nodeCount,
      t: performance.now(),
      maxLive: P.maxLive,
      maxSources: P.maxSources,
      musicSources: s.musicSources.size,
      musicBytes: s.musicBytes(),
      maxMusicBytes: P.maxMusicBytes,
    };
  });
  const secs = (after.t - before.t) / 1000;
  const mib = (bytes) => round(bytes / 1048576, 2);
  const row = {
    screen: name,
    rate: RATE,
    secs: round(secs, 1),
    nodesCreatedPerSec: round((after.created - before.created) / secs, 1),
    liveNodesEnd: after.live,
    liveNodesPeak: after.maxLive,
    sourcesPeak: after.maxSources,
    musicStems: after.musicSources,
    musicDecodedMiB: mib(after.musicBytes),
    musicDecodedPeakMiB: mib(after.maxMusicBytes),
  };
  console.log(JSON.stringify(row));
  return row;
}
const rows = [];
rows.push(await window('title', () => page.waitForTimeout(6000)));
rows.push(
  await window('title->select', async () => {
    await page.locator('[data-action="quick"]').click();
    await page.locator('[data-action="start-battle"]:visible').first().waitFor();
    await page.waitForTimeout(3000);
  })
);
rows.push(
  await window('battle-entry', async () => {
    await page.locator('[data-action="start-battle"]:visible').first().click();
    await page.locator('[data-move]:enabled').first().waitFor({ timeout: 120000 });
  })
);
rows.push(await window('battle-idle', () => page.waitForTimeout(6000)));
rows.push(
  await window('attack-turn', async () => {
    await page.locator('[data-move]:enabled').first().click();
    await page.waitForTimeout(300);
    await waitIdle(page);
  })
);
rows.push(
  await window('synthetic-200ms-task', async () => {
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const end = performance.now() + 200;
      while (performance.now() < end);
    });
    await page.waitForTimeout(1000);
  })
);
writeFileSync(
  `${OUT}audio-x${RATE}${process.env.LABEL ? `-${process.env.LABEL}` : ''}.json`,
  JSON.stringify({ info, rows }, null, 1)
);
await browser.close();
