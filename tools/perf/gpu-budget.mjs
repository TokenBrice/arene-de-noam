// Design-time GPU constraint probe (plan §1 "Measurement validity").
//
// Host GPU timings cannot validate a Mali-G52/G57 phone, so every GPU-side budget is an
// ARCHITECTURE constraint that is identical on the host and the phone: drawing-buffer size,
// MSAA, draw calls, programs, lights, transparent meshes, estimated overdraw, composited
// layer count/area, canvas filters, and arena renders per second at idle / under a sheet.
//
// Usage: node tools/perf/gpu-budget.mjs [--tiers low,mid,high] [--dist] [--json]
//   PORT (default 8181)   port for the throwaway static server this script starts
//   GPU=swiftshader       force CPU raster (counts are the same; auto-fallback if hardware GL fails)
// Exit code 1 when a tier violates its budget. Dev-only: never imported by the app.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  PHONE,
  launchArgs,
  newPhonePage,
  snapshotLayers,
  waitIdle,
  round,
  MOVE_READY,
  openSwitchSheet,
  closeSwitchSheet,
} from './lib.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'results');
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const DIST = process.argv.includes('--dist');
const PORT = Number(process.env.PORT || 8181);
const BASE = `http://127.0.0.1:${PORT}`;
const VIEWPORT_AREA = PHONE.width * PHONE.height;

// ---------------------------------------------------------------------------------------
// Budgets. CURRENT = what the tree must satisfy today (Phase 2 gate). PHASE 3 = the target
// the Phase 3 presentation rebuild must reach; tighten the CURRENT values to these then.
// `null` = not gated yet (still reported). Layers are all compositor layers (CDP LayerTree),
// the same count the plan's baseline uses (20 idle / 48 mid-attack).
//   Phase 3 Low: draws <= 12, lights 0, backing <= 0.35 Mpx, layers idle <= 10, FX <= 16,
//                transparent quads <= 96 (Transient FX budget), overdraw <= 2 viewports.
// ---------------------------------------------------------------------------------------
const BUDGETS = {
  low: {
    maxDpr: 1.0, //                 Phase 3: 1.0
    antialias: false, //            Phase 3: false
    maxMpx: null, //                Phase 3: 0.35
    maxPointLights: 0,
    maxLights: null, //             Phase 3: 0
    maxDraws: 32, //                idle frame. Phase 3: 12
    maxDrawsFx: 40, //              worst mid-attack frame. Phase 3: 12
    maxPrograms: null, //           Phase 3: 6
    maxTransparent: 96, //          Phase 3: 96 (already the Transient-FX budget)
    maxOverdraw: 5, //              viewports of summed transparent-bbox area. Phase 3: 2
    maxIdleRenders: 31,
    maxSheetRenders: 0,
    maxFxRenders: null, //          Phase 3: 31
    maxLayersIdle: 20, //          plan baseline; Phase 3: 10
    maxLayersFx: 90, //            plan baseline is 48 (host measured 84); Phase 3: 16
    canvasFilters: 0,
  },
  mid: {
    maxDpr: 1.5,
    antialias: false,
    maxMpx: null,
    maxPointLights: 0,
    maxLights: null,
    maxDraws: 32,
    maxDrawsFx: 40,
    maxPrograms: null,
    maxTransparent: 96,
    maxOverdraw: 5,
    maxIdleRenders: 31,
    maxSheetRenders: 0,
    maxFxRenders: 66, //           60 cap + sampling slack (window edges, 120 Hz host rAF)
    maxLayersIdle: 20, //          Phase 3: 10
    maxLayersFx: 90, //            Phase 3: 16
    canvasFilters: 0,
  },
  high: {
    maxDpr: 2,
    antialias: true,
    maxMpx: null,
    maxPointLights: null,
    maxLights: null,
    maxDraws: null,
    maxDrawsFx: null,
    maxPrograms: null,
    maxTransparent: null,
    maxOverdraw: null,
    maxIdleRenders: 61,
    maxSheetRenders: 0,
    maxFxRenders: 66,
    maxLayersIdle: null,
    maxLayersFx: null,
    canvasFilters: 0,
  },
};
// Used when the tier hook is absent: one untiered pass, only the invariants that hold for every tier.
const UNTIERED = {
  ...BUDGETS.high,
  maxDpr: 2,
  antialias: null,
  maxPointLights: null,
  maxIdleRenders: 61,
};

// ---------------------------------------------------------------------------------------
function tierHookPresent() {
  const walk = (dir) =>
    readdirSync(dir).flatMap((n) => {
      const f = path.join(dir, n);
      return statSync(f).isDirectory() ? walk(f) : n.endsWith('.js') ? [f] : [];
    });
  return walk(path.join(REPO, 'src')).some((f) => /['"`]quality['"`]/.test(readFileSync(f, 'utf8')));
}

async function startServer() {
  const args = [path.join(HERE, 'server.mjs'), String(PORT), ...(DIST ? ['--dist'] : [])];
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`perf server exited: ${log}`);
    try {
      if ((await fetch(`${BASE}/`)).ok) return child;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`perf server did not start: ${log}`);
}

// In-page: everything that needs the live ArenaScene. Dev-only handle (module singleton).
const PAGE_HELPERS = `(() => {
  const H = (window.__gpuProbe = {});
  H.scene = async () => {
    try {
      const { ctx } = await import('/src/app/context.js');
      return ctx.arenaScene || null;
    } catch { return null; }
  };
  H.installCounter = async () => {
    const s = await H.scene();
    if (!s || s.__renderCounted) return !!s;
    s.__renderCounted = true;
    window.__renders = 0;
    const orig = s.renderer.render.bind(s.renderer);
    s.renderer.render = (a, b) => { window.__renders++; return orig(a, b); };
    return true;
  };
  H.filters = () => {
    const canvas = document.querySelector('#arena, .arena-canvas');
    if (!canvas) return [];
    const cr = canvas.getBoundingClientRect();
    const hits = [];
    const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '');
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const filter = cs.filter !== 'none' ? 'filter:' + cs.filter : '';
      const backdrop = (cs.backdropFilter || cs.webkitBackdropFilter || 'none') !== 'none' ? 'backdrop-filter:' + (cs.backdropFilter || cs.webkitBackdropFilter) : '';
      if (!filter && !backdrop) continue;
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const contains = el.contains(canvas);
      const r = el.getBoundingClientRect();
      const overlaps = r.width > 0 && r.height > 0 && r.left < cr.right && r.right > cr.left && r.top < cr.bottom && r.bottom > cr.top;
      if (!contains && !overlaps) continue;
      // Heavy = anything that filters the canvas itself or forces a blur/backdrop pass over it
      // (plan §1). Cheap color filters on overlapping DOM sprites/buttons are reported as light.
      const heavy = contains || backdrop || /blur|drop-shadow/.test(filter);
      hits.push((heavy ? 'heavy ' : 'light ') + describe(el) + ' ' + [filter, backdrop].filter(Boolean).join(' '));
    }
    return hits;
  };
  H.stats = async () => {
    const s = await H.scene();
    if (!s) return null;
    const { renderer, scene, camera } = s;
    scene.updateMatrixWorld(true);
    renderer.info.reset();
    renderer.render(scene, camera);
    const info = renderer.info;
    const V = camera.position.constructor;
    const lights = {};
    let meshes = 0, transparentMeshes = 0, sprites = 0, points = 0, overdraw = 0;
    const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const right = new V(camera.matrixWorld.elements[0], camera.matrixWorld.elements[1], camera.matrixWorld.elements[2]);
    const up = new V(camera.matrixWorld.elements[4], camera.matrixWorld.elements[5], camera.matrixWorld.elements[6]);
    const ndcArea = (pts) => {
      let x0 = 1, x1 = -1, y0 = 1, y1 = -1, any = false;
      for (const p of pts) {
        p.project(camera);
        if (p.z > 1) continue;
        any = true;
        x0 = Math.min(x0, Math.max(-1, p.x)); x1 = Math.max(x1, Math.min(1, p.x));
        y0 = Math.min(y0, Math.max(-1, p.y)); y1 = Math.max(y1, Math.min(1, p.y));
      }
      return any && x1 > x0 && y1 > y0 ? ((x1 - x0) * (y1 - y0)) / 4 : 0;
    };
    scene.traverse((o) => {
      if (o.isLight) { if (visible(o) && o.intensity > 0) lights[o.type] = (lights[o.type] || 0) + 1; return; }
      if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine) || !visible(o)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (o.isMesh) meshes++;
      const transparent = mats.some((m) => m && (m.transparent || m.blending === 2) && m.opacity > 0);
      if (!transparent) return;
      if (o.isSprite) {
        sprites++;
        const c = o.getWorldPosition(new V());
        const half = o.scale.x / 2, halfY = o.scale.y / 2;
        overdraw += ndcArea([c.clone().addScaledVector(right, half).addScaledVector(up, halfY), c.clone().addScaledVector(right, -half).addScaledVector(up, -halfY)]);
        return;
      }
      if (o.isMesh) transparentMeshes++; else if (o.isPoints) points++;
      const g = o.geometry;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      const corners = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) corners.push(new V(x, y, z).applyMatrix4(o.matrixWorld));
      overdraw += ndcArea(corners);
    });
    const gl = renderer.getContext();
    const attrs = gl.getContextAttributes();
    const canvas = renderer.domElement;
    return {
      drawingBuffer: { w: gl.drawingBufferWidth, h: gl.drawingBufferHeight },
      mpx: (gl.drawingBufferWidth * gl.drawingBufferHeight) / 1e6,
      pixelRatio: renderer.getPixelRatio(),
      antialias: !!attrs.antialias,
      css: { w: canvas.clientWidth, h: canvas.clientHeight },
      draws: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs ? info.programs.length : 0,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      lights,
      meshes,
      transparentMeshes,
      transparentSprites: sprites,
      transparentPoints: points,
      transparentTotal: transparentMeshes + sprites + points,
      overdraw,
    };
  };
})();`;

const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const lightsLabel = (l) =>
  Object.entries(l || {})
    .map(([k, v]) => `${v}${k.replace('Light', '')}`)
    .join('+') || '0';

async function layerStats(cdp, layers) {
  const list = await snapshotLayers(cdp, layers);
  const drawing = list.filter((l) => l.drawsContent && l.width * l.height > 0);
  const area = drawing.reduce((a, l) => a + l.width * l.height, 0);
  return { layers: list.length, drawing: drawing.length, viewports: area / VIEWPORT_AREA };
}

async function probeTier(browser, tier, hook) {
  const { context, page, cdp, layers } = await newPhonePage(browser);
  const q = hook ? `&quality=${tier}` : '';
  const result = { tier, hook, notes: [] };
  try {
    await page.addInitScript(PAGE_HELPERS);
    await page.goto(`${BASE}/?seed=7&enemy=thornox,kordane,calderoc${q}`);
    await page.locator('[data-action="quick"]').waitFor({ timeout: 60000 });
    await page.mouse.click(5, 5);
    await page.locator('[data-action="quick"]').click();
    await page.locator('[data-action="start-battle"]:visible').first().waitFor({ timeout: 60000 });
    await page.locator('[data-action="start-battle"]:visible').first().click();
    const ready = await page
      .locator('[data-move]:enabled')
      .first()
      .waitFor({ timeout: 60000 })
      .then(
        () => true,
        () => false
      );
    if (!ready) {
      result.error = (await page.locator('.error-card').count())
        ? 'WebGL unavailable (error card shown)'
        : 'battle did not start';
      return result;
    }
    const counting = await page.evaluate(() => window.__gpuProbe.installCounter());
    if (!counting) result.notes.push('ArenaScene handle unavailable (dist build?): scene stats skipped');
    const renders = (ms) =>
      page.evaluate(async (ms) => {
        const a = window.__renders || 0;
        await new Promise((r) => setTimeout(r, ms));
        return ((window.__renders || 0) - a) / (ms / 1000);
      }, ms);
    const filters = new Set();
    const collectFilters = async () =>
      (await page.evaluate(() => window.__gpuProbe.filters())).forEach((f) => filters.add(f));

    // ---- idle
    await page.waitForTimeout(1500);
    result.idleRenders = counting ? await renders(2000) : null;
    result.idle = counting ? await page.evaluate(() => window.__gpuProbe.stats()) : null;
    result.layersIdle = await layerStats(cdp, layers);
    await collectFilters();

    // ---- switch sheet (before the attack: the seed-7 enemy roots us afterwards and disables Changer)
    if (
      await openSwitchSheet(page).catch(
        (e) => (result.notes.push('switch sheet: ' + e.message.split('\n')[0]), false)
      )
    ) {
      await page.waitForTimeout(700);
      result.sheetRenders = counting ? await renders(2000) : null;
      await collectFilters();
      await closeSwitchSheet(page);
      await page.waitForTimeout(500);
    } else result.notes.push('switch sheet not available');

    // ---- mid-attack: sample several times through the turn, keep the worst case
    const attackStart = counting ? await page.evaluate(() => window.__renders) : 0;
    const t0 = Date.now();
    await page.locator(MOVE_READY).first().click();
    const worst = {
      layers: 0,
      drawing: 0,
      viewports: 0,
      transparentTotal: 0,
      overdraw: 0,
      draws: 0,
      lights: {},
      programs: 0,
    };
    for (const at of [250, 700, 1200, 1800]) {
      await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
      const l = await layerStats(cdp, layers);
      worst.layers = Math.max(worst.layers, l.layers);
      worst.drawing = Math.max(worst.drawing, l.drawing);
      worst.viewports = Math.max(worst.viewports, l.viewports);
      if (counting) {
        const s = await page.evaluate(() => window.__gpuProbe.stats());
        for (const k of ['transparentTotal', 'overdraw', 'draws', 'programs'])
          worst[k] = Math.max(worst[k], s[k]);
        for (const [k, v] of Object.entries(s.lights)) worst.lights[k] = Math.max(worst.lights[k] || 0, v);
      }
      await collectFilters();
    }
    result.fxRenders = counting
      ? ((await page.evaluate(() => window.__renders)) - attackStart) / ((Date.now() - t0) / 1000)
      : null;
    result.fx = worst;
    await waitIdle(page);
    await page.waitForTimeout(800);

    // ---- switch sheet
    result.filters = [...filters];
  } finally {
    await context.close();
  }
  return result;
}

function check(row, budget) {
  const v = [];
  const over = (label, value, max) =>
    max != null && value != null && value > max && v.push(`${label} ${round(value, 2)} > ${max}`);
  if (row.idle) {
    over('DPR', row.idle.pixelRatio, budget.maxDpr);
    if (budget.antialias != null && row.idle.antialias !== budget.antialias)
      v.push(`antialias ${row.idle.antialias} != ${budget.antialias}`);
    over('backing Mpx', row.idle.mpx, budget.maxMpx);
    over('point lights', row.idle.lights.PointLight || 0, budget.maxPointLights);
    over('lights', sum(row.idle.lights), budget.maxLights);
    over('draw calls', row.idle.draws, budget.maxDraws);
    over('draw calls (FX)', row.fx.draws, budget.maxDrawsFx);
    over('programs', Math.max(row.idle.programs, row.fx.programs), budget.maxPrograms);
    over('transparent', Math.max(row.idle.transparentTotal, row.fx.transparentTotal), budget.maxTransparent);
    over('overdraw', Math.max(row.idle.overdraw, row.fx.overdraw), budget.maxOverdraw);
    over('point lights (FX)', row.fx.lights.PointLight || 0, budget.maxPointLights);
    over('lights (FX)', sum(row.fx.lights), budget.maxLights);
  }
  over('idle renders/s', row.idleRenders, budget.maxIdleRenders);
  over('sheet renders/s', row.sheetRenders, budget.maxSheetRenders);
  over('FX renders/s', row.fxRenders, budget.maxFxRenders);
  over('layers idle', row.layersIdle.layers, budget.maxLayersIdle);
  over('layers FX', row.fx.layers, budget.maxLayersFx);
  const heavy = row.filters.filter((f) => f.startsWith('heavy '));
  over('canvas filters', heavy.length, budget.canvasFilters);
  v.push(...heavy.map((f) => `filter: ${f.slice(6)}`));
  return v;
}

const f = (v, d = 1) => (v == null ? '–' : String(round(v, d)));
function printTable(rows) {
  const cols = [
    ['tier', (r) => r.tier],
    ['buffer', (r) => (r.idle ? `${r.idle.drawingBuffer.w}x${r.idle.drawingBuffer.h}` : '–')],
    ['Mpx', (r) => f(r.idle?.mpx, 2)],
    ['DPR', (r) => f(r.idle?.pixelRatio, 2)],
    ['AA', (r) => (r.idle ? (r.idle.antialias ? 'on' : 'off') : '–')],
    ['draws', (r) => (r.idle ? `${r.idle.draws}/${r.fx.draws}` : '–')],
    ['tris', (r) => (r.idle ? String(r.idle.triangles) : '–')],
    ['prog', (r) => (r.idle ? String(r.idle.programs) : '–')],
    ['tex', (r) => (r.idle ? String(r.idle.textures) : '–')],
    ['lights', (r) => (r.idle ? lightsLabel(r.idle.lights) : '–')],
    ['transp i/fx', (r) => (r.idle ? `${r.idle.transparentTotal}/${r.fx.transparentTotal}` : '–')],
    ['overdraw i/fx', (r) => (r.idle ? `${f(r.idle.overdraw, 2)}/${f(r.fx.overdraw, 2)}` : '–')],
    ['layers i/fx', (r) => (r.layersIdle ? `${r.layersIdle.layers}/${r.fx.layers}` : '–')],
    ['layer vp i/fx', (r) => (r.layersIdle ? `${f(r.layersIdle.viewports)}/${f(r.fx.viewports)}` : '–')],
    ['rend/s idle', (r) => f(r.idleRenders, 0)],
    ['fx', (r) => f(r.fxRenders, 0)],
    ['sheet', (r) => f(r.sheetRenders, 0)],
    [
      'filters h/l',
      (r) =>
        r.filters
          ? `${r.filters.filter((x) => x.startsWith('heavy ')).length}/${r.filters.filter((x) => x.startsWith('light ')).length}`
          : '–',
    ],
  ];
  const cells = [cols.map(([h]) => h), ...rows.map((r) => cols.map(([, fn]) => fn(r)))];
  const widths = cols.map((_, i) => Math.max(...cells.map((row) => row[i].length)));
  for (const [ri, row] of cells.entries()) {
    console.log(row.map((c, i) => c.padEnd(widths[i])).join('  '));
    if (ri === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  }
}

async function main() {
  const hook = tierHookPresent();
  const tiers = hook ? arg('tiers', 'low,mid,high').split(',') : ['untiered'];
  if (!hook)
    console.log('note: no ?quality= hook in src yet - running one untiered pass with invariant-only budgets');
  const server = await startServer();
  let browser = await chromium.launch({ headless: process.env.HEADED !== '1', args: launchArgs() });
  const rows = [];
  try {
    for (const tier of tiers) {
      let row = await probeTier(browser, tier, hook);
      if (row.error && process.env.SWIFTSHADER !== '1') {
        console.log(`${tier}: ${row.error} on hardware GL, retrying with swiftshader`);
        await browser.close();
        process.env.SWIFTSHADER = '1';
        browser = await chromium.launch({ headless: true, args: launchArgs() });
        row = await probeTier(browser, tier, hook);
      }
      rows.push(row);
    }
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
  console.log(
    `\nGPU constraint probe - ${PHONE.width}x${PHONE.height} @ DPR ${PHONE.deviceScaleFactor}, ${DIST ? 'dist/' : 'source'}, i/fx = idle / worst mid-attack sample`
  );
  printTable(rows.filter((r) => !r.error));
  let failed = false;
  for (const row of rows) {
    const budget = hook ? BUDGETS[row.tier] : UNTIERED;
    const problems = row.error ? [row.error] : check(row, budget);
    for (const n of row.notes) console.log(`${row.tier}: note: ${n}`);
    if (problems.length) {
      failed = true;
      console.log(`FAIL ${row.tier}:`);
      problems.forEach((p) => console.log(`  - ${p}`));
    } else console.log(`PASS ${row.tier}`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'gpu-budget.json'), JSON.stringify({ hook, dist: DIST, rows }, null, 1));
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
  process.exit(failed ? 1 : 0);
}

await main();
