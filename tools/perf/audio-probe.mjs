// Audio probe: node churn, live voices and music-scheduler lateness per screen.
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
  const P = (globalThis.__audio = { late: [], steps: 0, maxLive: 0, maxSources: 0 });
  const orig = s.scheduleMusicStep.bind(s);
  s.scheduleMusicStep = (config, step, time, dur) => {
    P.late.push(time - s.ctx.currentTime); // negative = scheduled in the past (audible glitch)
    P.steps++;
    return orig(config, step, time, dur);
  };
  setInterval(() => {
    P.maxLive = Math.max(P.maxLive, s._nodeCount);
    P.maxSources = Math.max(P.maxSources, s.musicSources.size + s.sfxSources.size);
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
    P.late = [];
    P.steps = 0;
    P.maxLive = s._nodeCount;
    P.maxSources = 0;
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
      late: P.late,
      steps: P.steps,
      maxLive: P.maxLive,
      maxSources: P.maxSources,
    };
  });
  const secs = (after.t - before.t) / 1000;
  const lateNotes = after.late.filter((x) => x < 0);
  const row = {
    screen: name,
    rate: RATE,
    secs: round(secs, 1),
    nodesCreatedPerSec: round((after.created - before.created) / secs, 1),
    liveNodesEnd: after.live,
    liveNodesPeak: after.maxLive,
    sourcesPeak: after.maxSources,
    musicSteps: after.steps,
    lateSteps: lateNotes.length,
    worstLatenessMs: round(Math.min(0, ...after.late) * 1000, 0),
    minLeadMs: round(Math.min(...after.late) * 1000, 0),
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
