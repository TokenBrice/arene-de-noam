// Runtime perf harness: per screen x CPU throttle rate.
// Usage (server must already run on PORT, default 8181):
//   node tools/perf/measure-runtime.mjs --rates 1,4,6 [--trace] [--reps 1] [--label base] [--query "&foo=1"]
// Writes tools/perf/results/runtime-<label>.json and prints a table.
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  launch,
  newPhonePage,
  BASE,
  PHONE,
  PHONE_L,
  throttle,
  measureWindow,
  withTrace,
  waitIdle,
  playUntil,
  snapshotLayers,
  describeLayers,
  round,
} from './lib.mjs';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const RATES = arg('rates', '1,4,6').split(',').map(Number);
const TRACE = process.argv.includes('--trace');
const REPS = Number(arg('reps', 1));
const LABEL = arg('label', TRACE ? 'trace' : 'base');
const QUERY = arg('query', '');
const VIEWPORT = arg('viewport', 'phone') === 'large' ? PHONE_L : PHONE;
const ONLY = arg('only', '');
const OUT = new URL('./results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await launch();
const all = [];

async function measure(ctx, name, opts) {
  if (ONLY && !ONLY.split(',').includes(name)) {
    if (opts.action) await opts.action();
    return null;
  }
  const { page, cdp, layers } = ctx;
  let res, trace;
  if (TRACE) {
    const out = await withTrace(browser, page, () =>
      measureWindow({ page, cdp, layers, dpr: VIEWPORT.deviceScaleFactor, ...opts })
    );
    res = out.result;
    trace = out.trace;
  } else res = await measureWindow({ page, cdp, layers, dpr: VIEWPORT.deviceScaleFactor, ...opts });
  const row = { screen: name, rate: ctx.rate, rep: ctx.rep, ...res, trace };
  if (process.env.LAYERS === '1') row.topLayers = await describeLayers(cdp, layers.list, 12);
  all.push(row);
  console.log(
    `${name.padEnd(14)} x${ctx.rate} fps p50 ${res.fpsP50} p5 ${res.fpsP5} worst ${res.worstFrameMs}ms long ${res.longTasks}/${res.longTaskMs}ms task/f ${res.taskMsPerFrame} script/f ${res.scriptMsPerFrame} style/f ${res.styleMsPerFrame} layout/f ${res.layoutMsPerFrame} recalcs ${res.styleRecalcs} layers ${res.layers}/${res.drawingLayers} (${res.layerMB}MB) dom ${res.domNodes}/${res.domNodePeak} anims ${res.animations}/${res.animationsPeak} gl ${res.webglRendersPerSec}/s x${res.drawCallsPerRender}` +
      (trace
        ? `\n    trace main ${JSON.stringify(trace.main)} other ${JSON.stringify(trace.otherThreadsMs)} noncomposited ${trace.nonCompositedAnimations.map((a) => a.name + ':' + a.props.join('+')).join(' ')}`
        : '')
  );
  return row;
}

for (let rep = 0; rep < REPS; rep++)
  for (const rate of RATES) {
    const { context, page, cdp, layers } = await newPhonePage(browser, { viewport: VIEWPORT });
    const ctx = { page, cdp, layers, rate, rep };
    await throttle(cdp, rate);
    const t0 = Date.now();
    await page.goto(`${BASE}/?seed=7&enemy=thornox,kordane,calderoc${QUERY}`);
    await page.locator('[data-action="quick"]').waitFor({ timeout: 120000 });
    const titleReady = Date.now() - t0;
    // unlock audio like a real tap would
    await page.mouse.click(5, 5);
    await page.waitForTimeout(1500);
    await measure(ctx, 'title', { ms: 4000 });

    await page.locator('[data-action="quick"]').click();
    await page.locator('[data-action="start-battle"]:visible').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    await measure(ctx, 'team-select', { ms: 4000 });

    let entryMs = 0;
    await measure(ctx, 'battle-entry', {
      action: async () => {
        const s = Date.now();
        await page.locator('[data-action="start-battle"]:visible').first().click();
        await page.locator('[data-move]:enabled').first().waitFor({ timeout: 120000 });
        entryMs = Date.now() - s;
      },
    });
    all.at(-1) && (all.at(-1).entryMs = entryMs);
    await page.waitForTimeout(1000);
    await measure(ctx, 'battle-idle', { ms: 5000 });

    let turnMs = 0;
    await measure(ctx, 'attack-turn', {
      action: async () => {
        const s = Date.now();
        await page.locator('[data-move]:enabled').first().click();
        await page.waitForTimeout(300);
        await waitIdle(page);
        turnMs = Date.now() - s;
      },
    });
    if (all.at(-1)?.screen === 'attack-turn') all.at(-1).turnMs = turnMs;
    await page.waitForTimeout(800);

    const sw = page.locator('[data-action="open-switch"]:enabled');
    if (await sw.count()) {
      await sw.click();
      await page
        .locator('.replacement')
        .first()
        .waitFor({ timeout: 10000 })
        .catch(() => {});
      await page.waitForTimeout(600);
      await measure(ctx, 'switch-overlay', { ms: 3000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Results: fresh battle with enemies at 1 HP.
    await page.goto(`${BASE}/?seed=7&enemyHp=1&enemy=thornox,kordane,calderoc${QUERY}`);
    await page.locator('[data-action="quick"]').waitFor({ timeout: 120000 });
    await page.locator('[data-action="quick"]').click();
    await page.locator('[data-action="start-battle"]:visible').first().click();
    await page.locator('[data-move]:enabled').first().waitFor({ timeout: 120000 });
    await playUntil(page, async () => (await page.locator('[data-action="rematch"]').count()) > 0);
    await page.waitForTimeout(1500);
    await measure(ctx, 'results', { ms: 4000 });
    all.filter((r) => r.rate === rate && r.rep === rep).forEach((r) => (r.titleReadyMs = titleReady));
    await context.close();
  }

writeFileSync(`${OUT}runtime-${LABEL}.json`, JSON.stringify(all, null, 1));
await browser.close();
console.log('wrote', `${OUT}runtime-${LABEL}.json`);
