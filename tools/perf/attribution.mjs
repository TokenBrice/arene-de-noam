// Attribution experiment on the battle idle screen: toggles subsystems live and
// traces each condition, so per-thread cost can be attributed to WebGL, CSS
// animations and DPR. Usage: node attribution.mjs [--rate 1] [--ms 4000] [--query "&x=1"]
import { writeFileSync, mkdirSync } from 'node:fs';
import { launch, newPhonePage, BASE, throttle, measureWindow, withTrace, round } from './lib.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const RATE = Number(arg('rate', 1));
const MS = Number(arg('ms', 4000));
const QUERY = arg('query', '');
const REPS = Number(arg('reps', 2));
const OUT = new URL('./results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const gate = (page, n) =>
  page.evaluate(async (n) => {
    const { ctx } = await import('/src/app/context.js');
    const s = ctx.arenaScene;
    let i = 0;
    const orig = s.renderer.render.bind(s.renderer);
    s.renderer.render = (a, b) => {
      if (i++ % n === 0) orig(a, b);
    };
  }, n);

const CONDITIONS = {
  // gate(page, n): render only every n-th rAF (120 Hz host -> 120/n renders/s)
  baseline: async () => {},
  'webgl-60/s': async (page) => gate(page, 2),
  'webgl-30/s': async (page) => gate(page, 4),
  'css-paused+webgl-30/s': async (page) => {
    await gate(page, 4);
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  },
  'webgl-dpr1': async (page) =>
    page.evaluate(async () => {
      const { ctx } = await import('/src/app/context.js');
      const s = ctx.arenaScene;
      s.renderer.setPixelRatio(1);
      s.pixelRatioCap = 1;
      s.resize = () => {};
      const r = s.canvas.getBoundingClientRect();
      s.renderer.setSize(r.width, r.height, false);
    }),
  'webgl-off': async (page) =>
    page.evaluate(async () => {
      const { ctx } = await import('/src/app/context.js');
      ctx.arenaScene.renderer.render = () => {};
    }),
  'css-anims-paused': async (page) =>
    page.evaluate(() => {
      for (const a of document.getAnimations()) a.pause();
    }),
  'webgl-off+css-paused': async (page) =>
    page.evaluate(async () => {
      const { ctx } = await import('/src/app/context.js');
      ctx.arenaScene.renderer.render = () => {};
      for (const a of document.getAnimations()) a.pause();
    }),
};

const browser = await launch();
const rows = [];
for (let rep = 0; rep < REPS; rep++)
  for (const [name, apply] of Object.entries(CONDITIONS)) {
    const { context, page, cdp, layers } = await newPhonePage(browser);
    await page.goto(`${BASE}/?seed=7&enemy=thornox,kordane,calderoc${QUERY}`);
    await page.locator('[data-action="quick"]').click();
    await page.locator('[data-action="start-battle"]:visible').first().click();
    await page.locator('[data-move]:enabled').first().waitFor({ timeout: 120000 });
    await page.waitForTimeout(1500);
    await throttle(cdp, RATE);
    await apply(page);
    await page.waitForTimeout(500);
    const { result, trace } = await withTrace(browser, page, () =>
      measureWindow({ page, cdp, layers, ms: MS })
    );
    const secs = result.elapsedMs / 1000;
    const perSec = Object.fromEntries(
      Object.entries(trace.otherThreadsMs).map(([k, v]) => [k, round(v / secs, 0)])
    );
    const mainPerSec = Object.fromEntries(
      Object.entries(trace.main).map(([k, v]) => [k, round(v / secs, 0)])
    );
    rows.push({
      condition: name,
      rep,
      rate: RATE,
      fpsP50: result.fpsP50,
      fpsP5: result.fpsP5,
      styleRecalcs: result.styleRecalcs,
      mainPerSec,
      otherPerSec: perSec,
      layers: result.layers,
      drawing: result.drawingLayers,
    });
    console.log(
      `${name.padEnd(22)} rep${rep} x${RATE} fps ${result.fpsP50}/${result.fpsP5} recalcs/s ${round(result.styleRecalcs / secs, 0)} main ms/s ${JSON.stringify(mainPerSec)} other ms/s ${JSON.stringify(perSec)}`
    );
    await context.close();
  }
writeFileSync(
  `${OUT}attribution-x${RATE}${process.env.LABEL ? `-${process.env.LABEL}` : ''}.json`,
  JSON.stringify(rows, null, 1)
);
await browser.close();
