// Load harness: title-ready and first-battle-ready times, requests/bytes, parse/compile split.
// Needs tools/perf/server.mjs running on PORT (http=dev profile, https=GitHub-Pages-like).
// Usage: node tools/perf/measure-load.mjs [--reps 3] [--label base] [--profiles dev,pages]
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { PHONE, SAVE, launchArgs, TRACE_CATEGORIES, round } from './lib.mjs';

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const PORT = Number(process.env.PORT || 8181);
const REPS = Number(arg('reps', 3));
const LABEL = arg('label', 'base');
const PROFILES = arg('profiles', 'dev,pages').split(',');
const QUERY = arg('query', '');
const OUT = new URL('./results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Lighthouse "Slow 4G" (mobile) throttling: 150 ms RTT, 1.6 Mbps down, 750 Kbps up.
const SLOW4G = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

const browser = await chromium.launch({
  headless: true,
  args: [...launchArgs(), '--ignore-certificate-errors'],
});

const MARK = `(() => {
  const mark = (k, sel) => {
    const check = () => { if (!window.__load[k] && document.querySelector(sel)) window.__load[k] = performance.now(); };
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
  };
  window.__load = {};
  mark('title', '[data-action="quick"]');
})();`;

function traceSplit(path) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const ev = json.traceEvents || json;
  const names = new Map();
  for (const e of ev)
    if (e.ph === 'M' && e.name === 'thread_name') names.set(`${e.pid}:${e.tid}`, e.args.name);
  const want = {
    compile: /^(v8\.compile|v8\.compileModule|V8\.CompileCode|v8\.parseOnBackground)$/,
    evaluate: /^(v8\.evaluateModule|EvaluateScript)$/,
    cssParse: /^ParseAuthorStyleSheet$/,
    style: /^(UpdateLayoutTree|RecalculateStyles)$/,
    layout: /^Layout$/,
    paint: /^(Paint|PrePaint)$/,
    gc: /^(MinorGC|MajorGC|V8\.GC_MC_BACKGROUND_MARKING|BlinkGC\.AtomicPhase)$/,
    runTask: /^RunTask$/,
  };
  const acc = Object.fromEntries(Object.keys(want).map((k) => [k, 0]));
  let longest = 0;
  for (const e of ev) {
    if (e.ph !== 'X' || names.get(`${e.pid}:${e.tid}`) !== 'CrRendererMain') continue;
    for (const [k, re] of Object.entries(want)) if (re.test(e.name)) acc[k] += e.dur / 1000;
    if (e.name === 'RunTask') longest = Math.max(longest, e.dur / 1000);
  }
  for (const k of Object.keys(acc)) acc[k] = round(acc[k], 0);
  acc.longestTask = round(longest, 0);
  return acc;
}

async function run(profile, rate, rep) {
  const context = await browser.newContext({
    viewport: { width: PHONE.width, height: PHONE.height },
    deviceScaleFactor: PHONE.deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  await page.addInitScript((s) => localStorage.setItem('arene-de-noam-save', JSON.stringify(s)), SAVE);
  await page.addInitScript(MARK);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const pages = profile.startsWith('pages');
  if (pages) await cdp.send('Network.emulateNetworkConditions', SLOW4G);
  const base = pages ? `https://127.0.0.1:${PORT}` : `http://127.0.0.1:${PORT}`;
  let reqs = [];
  const byId = new Map();
  cdp.on('Network.responseReceived', (e) =>
    byId.set(e.requestId, {
      url: e.response.url,
      status: e.response.status,
      type: e.type,
      fromCache: e.response.fromDiskCache || e.response.fromMemoryCache,
      proto: e.response.protocol,
    })
  );
  cdp.on('Network.loadingFinished', (e) => {
    const r = byId.get(e.requestId);
    if (r) reqs.push({ ...r, bytes: e.encodedDataLength });
  });
  cdp.on('Network.requestServedFromCache', (e) => {
    const r = byId.get(e.requestId);
    if (r) r.fromCache = true;
  });
  const summarize = () => {
    const list = reqs.filter((r) => !r.url.startsWith('data:'));
    const net = list.filter((r) => !r.fromCache);
    const by = (re) => net.filter((r) => re.test(r.url.split('?')[0]));
    return {
      requests: list.length,
      network: net.length,
      notModified: net.filter((r) => r.status === 304).length,
      KB: round(net.reduce((a, b) => a + b.bytes, 0) / 1024, 0),
      jsKB: round(by(/\.js$/).reduce((a, b) => a + b.bytes, 0) / 1024, 0),
      cssKB: round(by(/\.css$/).reduce((a, b) => a + b.bytes, 0) / 1024, 0),
      pngKB: round(by(/\.png$/).reduce((a, b) => a + b.bytes, 0) / 1024, 0),
      proto: [...new Set(list.map((r) => r.proto))].join(','),
    };
  };
  const tracePath = `${tmpdir()}/perf-load-${process.pid}-${Date.now()}.json`;
  const traceIt = rep === 0;
  if (traceIt) await browser.startTracing(page, { path: tracePath, categories: TRACE_CATEGORIES });
  await page.goto(`${base}/?seed=7${QUERY}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__load?.title, null, { timeout: 180000, polling: 50 });
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    return { title: window.__load.title, fcp: fcp?.startTime, dcl: nav.domContentLoadedEventEnd };
  });
  await page.waitForTimeout(300);
  if (traceIt) await browser.stopTracing();
  const cold = summarize();
  const split = traceIt ? traceSplit(tracePath) : null;
  reqs = [];
  // First battle: title -> team select -> battle ready
  const s0 = Date.now();
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="start-battle"]:visible').first().waitFor({ timeout: 180000 });
  const selectMs = Date.now() - s0;
  const s1 = Date.now();
  await page.locator('[data-action="start-battle"]:visible').first().click();
  await page.locator('[data-move]:enabled').first().waitFor({ timeout: 180000 });
  const battleMs = Date.now() - s1;
  const toBattle = summarize();
  // Repeat visit in the same context (HTTP cache warm)
  reqs = [];
  const r0 = Date.now();
  await page.goto(`${base}/?seed=7${QUERY}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__load?.title, null, { timeout: 180000, polling: 50 });
  const warmTitle = await page.evaluate(() => window.__load.title);
  const warm = summarize();
  await context.close();
  return {
    profile,
    rate,
    rep,
    titleReadyMs: round(t.title, 0),
    fcpMs: round(t.fcp, 0),
    dclMs: round(t.dcl, 0),
    cold,
    split,
    selectMs,
    battleReadyMs: battleMs,
    toBattle,
    warmTitleMs: round(warmTitle, 0),
    warm,
  };
}

const rows = [];
const plan = [];
for (const p of PROFILES) for (const rate of p === 'dev' ? [1, 4, 6] : [4, 6]) plan.push([p, rate]);
for (let rep = 0; rep < REPS; rep++)
  for (const [p, rate] of plan) {
    const r = await run(p, rate, rep);
    rows.push(r);
    console.log(
      `${p} x${rate} rep${rep}: title ${r.titleReadyMs}ms (fcp ${r.fcpMs}) req ${r.cold.requests} ${r.cold.KB}KB [js ${r.cold.jsKB} css ${r.cold.cssKB} png ${r.cold.pngKB}] ${r.cold.proto} | select ${r.selectMs}ms battle ${r.battleReadyMs}ms (+${r.toBattle.network} req ${r.toBattle.KB}KB) | warm title ${r.warmTitleMs}ms net ${r.warm.network} (${r.warm.notModified} 304) ${r.warm.KB}KB` +
        (r.split ? `\n   main: ${JSON.stringify(r.split)}` : '')
    );
  }
writeFileSync(`${OUT}load-${LABEL}.json`, JSON.stringify(rows, null, 1));
await browser.close();
