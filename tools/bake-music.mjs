// Dev-only: bakes the original score (tools/music/score.js) to assets/music/*.ogg.
//
//   node tools/bake-music.mjs [--only title,crystal] [--report <dir>]
//
// Headless Chromium (Playwright) renders each track with OfflineAudioContext (tools/music/
// render.js: synth voices + baked reverb), masters it (−16 LUFS integrated, linked true-peak
// limiter under −1 dBTP), encodes Opus with WebCodecs (64 kb/s stereo base, 40 kb/s mono tension
// stem) and muxes Ogg in-repo (tools/music/ogg.js). Every file is [margin][loop][margin], the
// margins being the loop's own wrap-around audio (MUSIC_LOOP_MARGIN_SECONDS in src/sound.js),
// and the encoder is primed with real audio on both sides, so the loop is seamless without a
// crossfade. The files are then decoded again and checked: exact length and alignment, loudness,
// true peak, loop-seam continuity at 48 and 44.1 kHz through a looping AudioBufferSourceNode,
// decoded memory and the motif (pitch-tracked from a lead-only render). A failed check exits 1.
// --report writes report.json, report.md and one spectrogram PNG per file.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSIC_TRACKS } from '../src/sound.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'assets', 'music');
// A secure origin (WebCodecs needs one) served from the repository by request interception;
// only the module trees the bake page imports are reachable.
const ORIGIN = 'https://bake-music.local';
const SERVED = ['/src/', '/tools/music/'];

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const only = arg('only')?.split(',');
const reportDir = arg('report') && path.resolve(arg('report'));
const ids = Object.keys(MUSIC_TRACKS).filter((id) => !only || only.includes(id));
if (only && ids.length !== only.length) throw new Error(`unknown track in --only ${only}`);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (message) => message.type() === 'error' && console.error(message.text()));
await page.route(`${ORIGIN}/**`, async (route) => {
  const { pathname } = new URL(route.request().url());
  if (pathname === '/')
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>bake-music</title>' });
  const file = path.join(ROOT, decodeURIComponent(pathname));
  if (!SERVED.some((prefix) => pathname.startsWith(prefix)) || !file.startsWith(ROOT) || !existsSync(file))
    return route.fulfill({ status: 404, body: '' });
  return route.fulfill({ contentType: 'text/javascript', body: await readFile(file) });
});
await page.goto(`${ORIGIN}/`);

await mkdir(OUT, { recursive: true });
if (reportDir) await mkdir(reportDir, { recursive: true });
const results = [];
for (const id of ids) {
  const started = Date.now();
  const result = await page.evaluate(async (track) => {
    const { bakeTrack } = await import('/tools/music/bake-page.js');
    return bakeTrack(track);
  }, id);
  for (const { name, base64 } of result.files)
    await writeFile(path.join(OUT, name), Buffer.from(base64, 'base64'));
  if (reportDir)
    for (const stem of Object.values(result.stems))
      await writeFile(
        path.join(reportDir, stem.file.replace('.ogg', '.png')),
        Buffer.from(stem.spectrogram, 'base64')
      );
  for (const stem of Object.values(result.stems)) delete stem.spectrogram;
  delete result.files;
  results.push(result);
  const failed = result.checks.filter((check) => !check.ok);
  console.log(
    `${id.padEnd(10)} ${((Date.now() - started) / 1000).toFixed(1).padStart(5)} s  ` +
      Object.values(result.stems)
        .map(
          (s) =>
            `${s.file} ${(s.bytes / 1024).toFixed(0)} KB ${s.lufs.toFixed(1)} LUFS ${s.truePeakDbtp.toFixed(1)} dBTP`
        )
        .join('  ') +
      (failed.length ? `  FAILED: ${failed.map((check) => check.what).join('; ')}` : '')
  );
}
await browser.close();

const fixed = (value, digits = 1) => value.toFixed(digits);
const percent = (share) => `${Math.round(share * 100)}`;
const rows = results.flatMap((r) =>
  Object.values(r.stems).map(
    (s) =>
      `| ${s.file} | ${fixed(r.bpm, 2)} | ${fixed(r.loopSeconds, 2)} | ${fixed(s.bytes / 1024, 0)} | ${fixed(s.kbps)} | ${fixed(s.lufs, 2)} | ${fixed(s.truePeakDbtp, 2)} | ${fixed(s.snrDb)} | ${s.lag} | ${fixed(s.seam.jumpDb)} / ${fixed(s.seam.p99DeltaDb)} | ${fixed(s.seam.mismatchDb)} | ${fixed(s.click48k, 2)} / ${fixed(s.click44k, 2)} | ${fixed(s.decodedBytes48k / 2 ** 20, 2)} | ${s.bands.map(percent).join(' / ')} |`
  )
);
const totalBytes = results.reduce(
  (sum, r) => sum + Object.values(r.stems).reduce((a, s) => a + s.bytes, 0),
  0
);
const failures = results.flatMap((r) => r.checks.filter((check) => !check.ok));
console.log(
  `total ${(totalBytes / 1024).toFixed(0)} KB in ${results.reduce((n, r) => n + Object.keys(r.stems).length, 0)} files`
);
if (reportDir) {
  const markdown = [
    '# Baked music report (tools/bake-music.mjs)',
    '',
    `Total ${totalBytes} bytes. Loudness is BS.1770-4 integrated over the loop (circular); true peak is 4× oversampled; seam = sample delta the player makes at the loop point vs the loop's p99 adjacent-sample delta (dBFS); mismatch = |x[loopStart] − x[loopEnd]|; click = local |Δ²| at the wrap / p99.9 |Δ²| of the playback (≈1 = no click).`,
    '',
    '| file | BPM | loop s | KB | kb/s | LUFS | dBTP | codec SNR dB | lag | seam jump / p99 dB | mismatch dB | click 48k / 44.1k | decoded MiB | power % <250 / 250–700 / 0.7–3k / >3k Hz |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...rows,
    '',
    '## Mastering',
    '',
    ...results.map(
      (r) =>
        `- ${r.id}: gain ${fixed(r.masterGainDb)} dB, limiter max ${fixed(r.limiterMaxReductionDb)} dB, >1 dB reduction on ${fixed(r.limiterOver1dbPercent, 2)} % of samples; lead ${fixed(r.leadVsMixLu)} LU vs the base mix; render ${fixed(r.renderMs / 1000)} s; decoded stems ${fixed(r.decodedBytes / 2 ** 20, 2)} MiB`
    ),
    '',
    '## Motif (1 5 6 2′ 1′) — scored vs pitch-tracked from a dry lead-only render',
    '',
    ...results.flatMap((r) => [
      `### ${r.id}`,
      '',
      `- scored statements: ${r.motif.scoredStatements.join(', ') || 'none'}`,
      `- heard statements: ${r.motif.heardStatements.join(', ') || 'none'}`,
      `- heard sequence (${r.motif.heardNotes} notes, ${r.motif.scoredNotes} scored): ${r.motif.heardSequence}`,
      '',
    ]),
    '## Checks',
    '',
    ...results.flatMap((r) => r.checks.map((check) => `- [${check.ok ? 'x' : ' '}] ${check.what}`)),
    '',
  ].join('\n');
  await writeFile(path.join(reportDir, 'report.md'), markdown);
  await writeFile(path.join(reportDir, 'report.json'), JSON.stringify(results, null, 1));
  console.log(`report: ${path.relative(ROOT, reportDir)}/report.md`);
}
if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exitCode = 1;
}
