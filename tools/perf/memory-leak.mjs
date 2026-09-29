// Leak probe: N consecutive battles via "rematch"; after each, force GC and record
// JS heap, DOM nodes, listeners, live/created WebGL contexts, audio nodes.
// Usage: node memory-leak.mjs [--battles 6]
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, newPhonePage, BASE, SAVE, playUntil, metrics, round } from './lib.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const N = Number(arg('battles', 6));
const OUT = new URL('./results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await launch();
const { page, cdp } = await newPhonePage(browser, { save: { ...SAVE, battleSpeed: 2 } });
const warnings = [];
page.on('console', (m) => {
  if (/WebGL|context/i.test(m.text())) warnings.push(m.text().slice(0, 160));
});
await cdp.send('HeapProfiler.enable');
await page.goto(`${BASE}/?seed=7&enemyHp=1&audiodebug=1&enemy=thornox,kordane,calderoc`);
await page.locator('[data-action="quick"]').waitFor();
await page.mouse.click(5, 5);
await page.locator('[data-action="quick"]').click();
await page.locator('[data-action="start-battle"]:visible').first().click();
const rows = [];
async function sample(i) {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  const m = await metrics(cdp);
  const p = await page.evaluate(() => {
    const P = window.__perf;
    const live = (P.glRefs || []).filter((r) => {
      const g = r.deref();
      return g && !g.isContextLost();
    }).length;
    const held = (P.glRefs || []).filter((r) => r.deref()).length;
    const s = globalThis.__NOAM_SOUND__;
    return {
      created: P.contexts,
      lost: P.lost,
      liveContexts: live,
      contextsNotGCed: held,
      audioLive: s?._nodeCount,
      audioSources: s ? s.musicSources.size + s.sfxSources.size : null,
    };
  });
  const row = {
    battle: i,
    heapMB: round(m.JSHeapUsedSize / 1048576, 2),
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
    docs: m.Documents,
    ...p,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}
for (let i = 1; i <= N; i++) {
  await page.locator('[data-move]:enabled').first().waitFor({ timeout: 120000 });
  await playUntil(page, async () => (await page.locator('[data-action="rematch"]').count()) > 0);
  await page.waitForTimeout(800);
  await sample(i);
  await page.locator('[data-action="rematch"]').click();
}
await page.locator('[data-move]:enabled').first().waitFor({ timeout: 120000 });
console.log('console warnings', warnings.length, warnings.slice(0, 3));
writeFileSync(
  `${OUT}memory-leak${process.env.LABEL ? `-${process.env.LABEL}` : ''}.json`,
  JSON.stringify({ rows, warnings }, null, 1)
);
await browser.close();
