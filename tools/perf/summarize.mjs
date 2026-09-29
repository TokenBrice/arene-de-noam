// Summarize harness JSON into markdown tables (medians across reps).
// Usage: node summarize.mjs results/runtime-base.json [results/runtime-trace.json]
import { readFileSync } from 'node:fs';

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (v) => (v == null ? '–' : Math.round(v * 10) / 10);
const [basePath, tracePath] = process.argv.slice(2);
const base = JSON.parse(readFileSync(basePath, 'utf8'));
const trace = tracePath ? JSON.parse(readFileSync(tracePath, 'utf8')) : [];
const screens = [...new Set(base.map((r) => r.screen))];
const rates = [...new Set(base.map((r) => r.rate))];
console.log(
  '| Screen | CPU | FPS p50 | FPS p5 | Long tasks (n / ms) | Main ms/frame (task · script · style · layout) | Layers (all/drawing, ~MB) | DOM nodes (peak) | Anims (peak) | WebGL renders/s × draws |'
);
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const s of screens)
  for (const rate of rates) {
    const rows = base.filter((r) => r.screen === s && r.rate === rate);
    if (!rows.length) continue;
    const m = (k) => median(rows.map((r) => r[k]));
    console.log(
      `| ${s} | ${rate}× | ${r1(m('fpsP50'))} | ${r1(m('fpsP5'))} | ${r1(m('longTasks'))} / ${r1(m('longTaskMs'))} | ${r1(m('taskMsPerFrame'))} · ${r1(m('scriptMsPerFrame'))} · ${r1(m('styleMsPerFrame'))} · ${r1(m('layoutMsPerFrame'))} | ${m('layers')}/${m('drawingLayers')} (~${r1(m('layerMB'))}) | ${m('domNodes')} (${m('domNodePeak')}) | ${m('animations')} (${m('animationsPeak')}) | ${r1(m('webglRendersPerSec'))} × ${r1(m('drawCallsPerRender'))} |`
    );
  }
const extra = base.filter((r) => r.turnMs || r.entryMs);
if (extra.length) {
  console.log('\n| CPU | battle entry ms (median) | attack turn ms (median) |\n|---|---|---|');
  for (const rate of rates) {
    const e = median(base.filter((r) => r.rate === rate && r.entryMs).map((r) => r.entryMs));
    const t = median(base.filter((r) => r.rate === rate && r.turnMs).map((r) => r.turnMs));
    console.log(`| ${rate}× | ${e} | ${t} |`);
  }
}
if (trace.length) {
  console.log(
    '\n| Screen | CPU | Renderer main ms/s: script · style · layout · paint · composite · other | Other threads ms/s: Compositor · Viz · GPU main | Non-composited animations |'
  );
  console.log('|---|---|---|---|---|');
  for (const s of screens)
    for (const rate of [...new Set(trace.map((r) => r.rate))]) {
      const rows = trace.filter((r) => r.screen === s && r.rate === rate && r.trace);
      if (!rows.length) continue;
      const per = (r, k, src = 'main') =>
        ((r.trace[src === 'main' ? 'main' : 'otherThreadsMs'][k] || 0) / r.elapsedMs) * 1000;
      const mm = (k, src) => r1(median(rows.map((r) => per(r, k, src))));
      const anims = [
        ...new Set(
          rows.flatMap((r) =>
            r.trace.nonCompositedAnimations.map((a) => `${a.name.split('@')[0]}(${a.props.join('+') || '?'})`)
          )
        ),
      ];
      console.log(
        `| ${s} | ${rate}× | ${mm('scripting')} · ${mm('style')} · ${mm('layout')} · ${mm('paint')} · ${mm('composite')} · ${mm('other')} | ${mm('Compositor', 'o')} · ${mm('VizCompositorThread', 'o')} · ${mm('CrGpuMain', 'o')} | ${anims.join(', ')} |`
      );
    }
}
