// Shared helpers for the dev-only perf harness (tools/perf). Never imported by the app.
// Read-only with respect to the repo: everything is injected at runtime.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

export const PORT = Number(process.env.PORT || 8181);
export const BASE = process.env.BASE || `http://127.0.0.1:${PORT}`;

export const PHONE = { width: 360, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
export const PHONE_L = { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true };

export const SAVE = {
  version: 16,
  tutorialComplete: true,
  ladderVictories: 4,
  emblems: [],
  cosmetics: ['crystal'],
  mastery: { orakyn: 40, abyssar: 12 },
  records: { orakyn: { battles: 9, wins: 7, damage: 812, kos: 11, signatures: 4, combos: 3 } },
  customSquads: [null, null, null],
  feats: ['first_win'],
  trials: [],
  gauntletWins: 1,
  draftWins: 1,
  circuitWins: 0,
  bestGrade: 'A',
  battlesPlayed: 14,
  wins: 9,
  winStreak: 3,
  bestStreak: 5,
  lastTeam: ['orakyn', 'abyssar', 'virelia'],
  difficulty: 'apprentice',
  language: 'fr',
  muted: false,
  volume: 0.7,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  reducedMotion: false,
  highContrast: false,
  expertMode: false,
  battleSpeed: 1,
};

// Hardware GPU in headless Chromium on macOS (ANGLE/Metal). SWIFTSHADER=1 for CPU raster.
export function launchArgs() {
  const gpu =
    process.env.SWIFTSHADER === '1'
      ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
  return [
    ...gpu,
    '--autoplay-policy=no-user-gesture-required',
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
  ];
}

export async function launch() {
  return chromium.launch({ headless: process.env.HEADED !== '1', args: launchArgs() });
}

// Injected before any page script: rAF interval recorder, long-task + LoAF
// observers, WebGL draw/clear/context counters.
export const INSTRUMENT = `(() => {
  const P = (window.__perf = { recording: false, frames: [], longTasks: [], loaf: [], draws: 0, clears: 0, contexts: 0, contextAttrs: [], lost: 0 });
  let last = 0;
  const tick = (t) => { if (P.recording && last) P.frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (P.recording) P.longTasks.push(e.duration); }).observe({ type: 'longtask' }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (P.recording) P.loaf.push({ d: e.duration, b: e.blockingDuration, s: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0 }); }).observe({ type: 'long-animation-frame' }); } catch {}
  for (const C of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!C) continue;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const o = C.prototype[fn]; if (!o) continue;
      C.prototype[fn] = function (...a) { P.draws++; return o.apply(this, a); };
    }
    const oc = C.prototype.clear; C.prototype.clear = function (m) { P.clears++; return oc.call(this, m); };
  }
  const og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const c = og.call(this, type, attrs);
    if (c && /webgl/.test(type) && !this.__counted) { this.__counted = true; P.contexts++; P.contextAttrs.push(attrs); (P.glRefs ||= []).push(new WeakRef(c)); this.addEventListener('webglcontextlost', () => P.lost++); }
    return c;
  };
})();`;

export async function newPhonePage(browser, { viewport = PHONE, save = SAVE, fresh = false } = {}) {
  const { width, height, deviceScaleFactor, isMobile, hasTouch } = viewport;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor,
    isMobile,
    hasTouch,
  });
  const page = await context.newPage();
  await page.addInitScript(INSTRUMENT);
  if (!fresh)
    await page.addInitScript((s) => localStorage.setItem('arene-de-noam-save', JSON.stringify(s)), save);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  // LayerTree stays disabled during measurement windows (the agent itself adds
  // per-frame work); snapshotLayers() enables it briefly at window end.
  const layers = { list: [] };
  return { context, page, cdp, layers };
}

export async function throttle(cdp, rate) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

export async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}
// LayerTree only emits after (re-)enable, so force a fresh snapshot.
export async function snapshotLayers(cdp, layers) {
  const got = new Promise((resolve) => {
    const handler = (e) => {
      if (e.layers) {
        cdp.off('LayerTree.layerTreeDidChange', handler);
        resolve(e.layers);
      }
    };
    cdp.on('LayerTree.layerTreeDidChange', handler);
    setTimeout(() => resolve(null), 1500);
  });
  await cdp.send('LayerTree.enable');
  const list = await got;
  await cdp.send('LayerTree.disable');
  if (list) layers.list = list;
  return layers.list;
}

export async function describeLayers(cdp, list, top = 15) {
  const drawing = list.filter((l) => l.drawsContent && l.width * l.height > 0);
  drawing.sort((a, b) => b.width * b.height - a.width * a.height);
  const out = [];
  for (const l of drawing.slice(0, top)) {
    const r = await cdp.send('LayerTree.compositingReasons', { layerId: l.layerId }).catch(() => null);
    out.push({
      size: `${round(l.width, 0)}x${round(l.height, 0)}`,
      reasons: (r?.compositingReasonIds || r?.compositingReasons || []).join(','),
    });
  }
  return out;
}

const pct = (arr, p) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
export const round = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

function layerSummary(list, dpr) {
  const drawing = list.filter((l) => l.drawsContent);
  const px = drawing.reduce((sum, l) => sum + l.width * l.height, 0);
  return {
    layers: list.length,
    drawingLayers: drawing.length,
    // RGBA8 backing estimate at device pixels (tiling overhead ignored).
    layerMB: round((px * dpr * dpr * 4) / 1048576, 1),
  };
}

// Measure a window of `ms` on the current screen. `action` optionally runs at
// window start (e.g. click a move) and may resolve early (window = until done).
export async function measureWindow({ page, cdp, layers, ms = 4000, action = null, dpr = 2 }) {
  await page.evaluate(() => {
    const P = window.__perf;
    P.frames = [];
    P.longTasks = [];
    P.loaf = [];
    P.draws = 0;
    P.clears = 0;
    P.recording = true;
    P.animPeak = 0;
    P.nodePeak = 0;
    P.sampler = setInterval(() => {
      P.animPeak = Math.max(P.animPeak, document.getAnimations().length);
      P.nodePeak = Math.max(P.nodePeak, document.getElementsByTagName('*').length);
    }, 100);
  });
  const m0 = await metrics(cdp);
  const t0 = Date.now();
  if (action) await action();
  const left = ms - (Date.now() - t0);
  if (left > 0 && !action) await page.waitForTimeout(left);
  const elapsed = Date.now() - t0;
  const m1 = await metrics(cdp);
  const r = await page.evaluate(() => {
    const P = window.__perf;
    P.recording = false;
    clearInterval(P.sampler);
    const canvas = document.querySelector('#arena');
    return {
      frames: P.frames,
      longTasks: P.longTasks,
      loaf: P.loaf,
      draws: P.draws,
      clears: P.clears,
      contexts: P.contexts,
      animNow: document.getAnimations().length,
      animPeak: P.animPeak,
      nodes: document.getElementsByTagName('*').length,
      nodePeak: P.nodePeak,
      canvas: canvas
        ? { w: canvas.width, h: canvas.height, cw: canvas.clientWidth, ch: canvas.clientHeight }
        : null,
    };
  });
  const frames = r.frames.filter((f) => f > 0);
  const frameCount = frames.length || 1;
  const d = (k) => (m1[k] - m0[k]) * 1000; // seconds -> ms
  await snapshotLayers(cdp, layers);
  const ls = layerSummary(layers.list, dpr);
  return {
    elapsedMs: elapsed,
    frames: frames.length,
    fpsAvg: round((frames.length / elapsed) * 1000),
    fpsP50: round(1000 / pct(frames, 50)),
    fpsP5: round(1000 / pct(frames, 95)),
    worstFrameMs: round(Math.max(...frames, 0)),
    jankFrames: frames.filter((f) => f > 34).length,
    longTasks: r.longTasks.length,
    longTaskMs: round(r.longTasks.reduce((a, b) => a + b, 0)),
    loaf: r.loaf.length,
    loafBlockingMs: round(r.loaf.reduce((a, b) => a + b.b, 0)),
    taskMsPerFrame: round(d('TaskDuration') / frameCount, 2),
    scriptMsPerFrame: round(d('ScriptDuration') / frameCount, 2),
    styleMsPerFrame: round(d('RecalcStyleDuration') / frameCount, 2),
    layoutMsPerFrame: round(d('LayoutDuration') / frameCount, 2),
    styleRecalcs: m1.RecalcStyleCount - m0.RecalcStyleCount,
    layouts: m1.LayoutCount - m0.LayoutCount,
    heapMB: round(m1.JSHeapUsedSize / 1048576, 1),
    domNodes: r.nodes,
    domNodePeak: r.nodePeak,
    listeners: m1.JSEventListeners,
    animations: r.animNow,
    animationsPeak: r.animPeak,
    webglRendersPerSec: round((r.clears / elapsed) * 1000),
    drawCallsPerRender: r.clears ? round(r.draws / r.clears) : 0,
    webglContextsCreated: r.contexts,
    canvas: r.canvas,
    ...ls,
  };
}

// Trace-based main-thread split. Returns ms per category (self time) for the
// renderer main thread, plus compositor/raster/GPU thread totals and the list of
// non-composited animations reported by Blink.
export const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'blink',
  'blink.animations',
  'cc',
  'gpu',
  'v8',
  'v8.execute',
  'disabled-by-default-v8.compile',
  'loading',
  'toplevel',
];

const CATEGORY_OF = [
  [
    /^(EvaluateScript|v8\.compile|v8\.compileModule|v8\.evaluateModule|v8\.run|FunctionCall|TimerFire|FireAnimationFrame|EventDispatch|RunMicrotasks|V8\.Execute|v8\.callFunction|MinorGC|MajorGC|V8\.GC.*|BlinkGC.*|v8\.newInstance|CompileCode|CompileScript|ParseOnBackground|v8\.parseOnBackground|FireIdleCallback|XHRReadyStateChange|v8.produceModuleCache|v8.produceCache|V8.GCScavenger|V8.GCCompactor|V8.GCFinalizeMC)$/,
    'scripting',
  ],
  [
    /^(UpdateLayoutTree|RecalculateStyles|ScheduleStyleRecalculation|ParseAuthorStyleSheet|StyleInvalidatorInvalidationTracking)$/,
    'style',
  ],
  [/^(Layout|UpdateLayout|LocalFrameView::layout|InvalidateLayout)$/, 'layout'],
  [
    /^(Paint|PaintImage|PrePaint|Layerize|UpdateLayer|UpdateLayerTree|PaintSetup|Decode Image|Decode LazyPixelRef|ImageDecodeTask)$/,
    'paint',
  ],
  [/^(CompositeLayers|Commit|ProxyMain::BeginMainFrame::commit|ScrollbarsAndLayerTree)$/, 'composite'],
  [/^(ParseHTML|ResourceSendRequest|ResourceReceiveResponse|ResourceFinish)$/, 'loading'],
];

export function analyzeTrace(json) {
  const events = (json.traceEvents || json).filter((e) => e && typeof e === 'object');
  const threadNames = new Map();
  for (const e of events)
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args.name);
  const byThread = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
    const key = `${e.pid}:${e.tid}`;
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key).push(e);
  }
  const main = {};
  const other = {};
  let mainTotal = 0;
  const animations = new Map();
  const animName = new Map();
  for (const e of events)
    if (e.name === 'Animation' && e.ph === 'b' && e.args?.data)
      animName.set(
        e.id2?.local || e.id,
        `${e.args.data.displayName || e.args.data.name || '?'}@${(e.args.data.nodeName || '').slice(0, 48)}`
      );
  for (const e of events) {
    if (e.name === 'Animation' && e.args?.data?.compositeFailed !== undefined) {
      const k = animName.get(e.id2?.local || e.id) || '?';
      const cur = animations.get(k) || { name: k, failed: 0, props: new Set() };
      cur.failed |= e.args.data.compositeFailed;
      if (e.args.data.compositeFailed)
        for (const p of e.args.data.unsupportedProperties || []) cur.props.add(p);
      animations.set(k, cur);
    }
  }
  for (const [k, v] of animations) if (!v.failed) animations.delete(k);
  for (const [key, list] of byThread) {
    const name = threadNames.get(key) || '?';
    list.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
    if (name === 'CrRendererMain') {
      // self-time attribution with a nesting stack
      const stack = [];
      for (const e of list) {
        while (stack.length && stack[stack.length - 1].end <= e.ts) stack.pop();
        const parent = stack[stack.length - 1];
        const cat = (CATEGORY_OF.find(([re]) => re.test(e.name)) || [null, null])[1];
        const node = { end: e.ts + e.dur, cat: cat || parent?.cat || 'other', top: !parent };
        if (parent) parent.childDur = parent.childDur || 0;
        // subtract from parent self
        if (parent) main[parent.cat] = (main[parent.cat] || 0) - e.dur / 1000;
        main[node.cat] = (main[node.cat] || 0) + e.dur / 1000;
        if (!parent && e.name === 'RunTask') mainTotal += e.dur / 1000;
        if (!parent && e.name !== 'RunTask') mainTotal += 0;
        stack.push(node);
      }
    } else if (/Compositor$|^VizCompositorThread|^CrGpuMain|CompositorTileWorker|^GPU/.test(name)) {
      const tops = [];
      let end = -1;
      for (const e of list) {
        if (e.ts >= end) {
          tops.push(e);
          end = e.ts + e.dur;
        }
      }
      const label = name.replace(/\d+$/, '');
      // thread CPU time (tdur) is robust to host contention; fall back to wall time
      other[label] = (other[label] || 0) + tops.reduce((a, b) => a + (b.tdur ?? b.dur) / 1000, 0);
    }
  }
  for (const k of Object.keys(main)) main[k] = round(main[k], 1);
  for (const k of Object.keys(other)) other[k] = round(other[k], 1);
  return {
    mainThreadTaskMs: round(mainTotal, 1),
    main,
    otherThreadsMs: other,
    nonCompositedAnimations: [...animations.values()].map((a) => ({ name: a.name, props: [...a.props] })),
  };
}

export async function withTrace(browser, page, fn) {
  const path = `${tmpdir()}/perf-trace-${process.pid}-${Date.now()}.json`;
  await browser.startTracing(page, { path, categories: TRACE_CATEGORIES, screenshots: false });
  const result = await fn();
  await browser.stopTracing();
  const json = JSON.parse(readFileSync(path, 'utf8'));
  return { result, trace: analyzeTrace(json), path };
}

export async function enterQuickBattle(page) {
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="start-battle"]:visible').first().waitFor({ timeout: 60000 });
  await page.locator('[data-action="start-battle"]:visible').first().click();
  await page.locator('[data-move]:enabled').first().waitFor({ timeout: 90000 });
}

export async function waitIdle(page, timeout = 120000) {
  await page.waitForFunction(
    () =>
      document.querySelector('[data-move]:enabled') ||
      document.querySelector('[data-switch-index]') ||
      document.querySelector('[data-action="rematch"]'),
    null,
    { timeout, polling: 100 }
  );
}

export async function playUntil(page, predicate, maxSteps = 400) {
  for (let turn = 0; turn < maxSteps; turn++) {
    if (await predicate()) return true;
    const replacement = page.locator('[data-switch-index]:visible').first();
    if (await replacement.count()) {
      await replacement.click({ timeout: 500 }).catch(() => {});
      await page.waitForTimeout(50);
      continue;
    }
    const move = page.locator('[data-move]:visible:enabled').first();
    if (await move.count()) {
      await move.click({ timeout: 500 }).catch(() => {});
      await page.waitForTimeout(50);
      continue;
    }
    await page.waitForTimeout(80);
  }
  return false;
}
