// Production build for GitHub Pages: `npm run build` writes dist/.
// Development stays unbundled (`npm run serve`); CI runs this before deploying.
//
// - One minified ESM bundle of src/main.js with code splitting: the dynamic
//   import of src/presentation/arena.js puts it and Three.js in a lazy chunk.
// - Eager CSS in cascade order, split only where a lazy battle sheet must slot
//   in (src/app/battle-stylesheets.js anchors), so lazy loading keeps the exact
//   eager cascade. Battle sheets sharing an anchor share one lazy file.
// - Content-hashed JS/CSS/font names; __ASSET_MAP__ tells ctx.ensureBattleStyles()
//   the hashed stylesheet names; __DIST__ enables service-worker registration.
// - index.html rewritten for the hashed files; runtime assets copied as-is.
// - dist/sw.js with a versioned precache list of every dist file.
import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { BATTLE_STYLESHEETS } from '../src/app/battle-stylesheets.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = 'app';
const FILE_LOADERS = { '.woff2': 'file', '.woff': 'file', '.png': 'file', '.svg': 'file', '.webp': 'file' };
// Copied unchanged: the manifest, every URL the code builds at runtime, and the
// font licences (the OFL requires them next to the redistributed fonts).
const STATIC_FILES = ['manifest.webmanifest'];
const STATIC_DIRS = [
  ['assets/icons', (name) => name.endsWith('.png')],
  ['assets/monsters', (name) => name === 'battle.png'],
  ['fonts', (name) => name.endsWith('.txt')],
];

const posix = (file) => file.split(path.sep).join('/');
const fail = (message) => {
  throw new Error(`build: ${message}`);
};

// Replaces exactly one occurrence, so a drifting index.html fails the build
// instead of shipping a half-rewritten page.
function replaceOnce(html, pattern, replacement, what) {
  const matches = html.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`));
  if (matches?.length !== 1) fail(`expected one ${what} in index.html, found ${matches?.length ?? 0}`);
  return html.replace(pattern, replacement);
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => posix(path.relative(DIST, path.join(entry.parentPath, entry.name))))
    .sort();
}

// --- Stylesheet groups -----------------------------------------------------
const sourceHtml = await readFile(path.join(ROOT, 'index.html'), 'utf8');
const EAGER_LINK = /^[ \t]*<link rel="stylesheet" href="(\.\/styles\/[^"]+\.css)" \/>\n/gm;
const eager = [...sourceHtml.matchAll(EAGER_LINK)].map((match) => match[1]);
const manifest = [...sourceHtml.matchAll(/<!-- href="(\.\/styles\/[^"]+\.css)" -->/g)].map((m) => m[1]);
const battle = BATTLE_STYLESHEETS.map(([sheet]) => sheet);
if (!eager.length) fail('no eager stylesheets found in index.html');
if (manifest.join() !== battle.join())
  fail('the index.html battle-sheet manifest differs from src/app/battle-stylesheets.js');
for (const [sheet, anchor] of BATTLE_STYLESHEETS)
  if (anchor !== null && !eager.includes(anchor)) fail(`${sheet} anchors on ${anchor}, not an eager sheet`);

const anchors = new Set(BATTLE_STYLESHEETS.map(([, anchor]) => anchor));
const baseName = (sheet) => path.basename(sheet, '.css');
const eagerGroups = [];
for (const sheet of eager) {
  if (!eagerGroups.length || anchors.has(sheet))
    eagerGroups.push({ name: eagerGroups.length ? baseName(sheet) : 'app', sheets: [] });
  eagerGroups.at(-1).sheets.push(sheet);
}
const battleGroups = [];
BATTLE_STYLESHEETS.forEach(([sheet, anchor], index) => {
  if (index === 0 || BATTLE_STYLESHEETS[index - 1][1] !== anchor)
    battleGroups.push({ name: baseName(sheet), sheets: [] });
  battleGroups.at(-1).sheets.push(sheet);
});
const cssGroups = [...eagerGroups, ...battleGroups];
if (new Set(cssGroups.map((group) => group.name)).size !== cssGroups.length) fail('CSS group names collide');

await rm(DIST, { recursive: true, force: true });

// --- CSS -------------------------------------------------------------------
const cssEntries = {
  name: 'css-groups',
  setup(builder) {
    builder.onResolve({ filter: /^css-group:/ }, (args) => ({
      path: args.path.slice(10),
      namespace: 'css-group',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'css-group' }, (args) => ({
      contents: cssGroups
        .find((group) => group.name === args.path)
        .sheets.map((sheet) => `@import ${JSON.stringify(sheet)};`)
        .join('\n'),
      loader: 'css',
      resolveDir: ROOT,
    }));
  },
};
const css = await build({
  absWorkingDir: ROOT,
  entryPoints: cssGroups.map((group) => ({ in: `css-group:${group.name}`, out: group.name })),
  plugins: [cssEntries],
  bundle: true,
  minify: true,
  outdir: DIST,
  entryNames: `${OUT_DIR}/[name]-[hash]`,
  assetNames: `${OUT_DIR}/[name]-[hash]`,
  loader: FILE_LOADERS,
  metafile: true,
  logLevel: 'warning',
});
const cssOutputs = Object.entries(css.metafile.outputs);
const outputUrl = (file) => `./${posix(path.relative('dist', file))}`;
const groupUrl = new Map(
  cssOutputs
    .filter(([, output]) => output.entryPoint)
    .map(([file, output]) => [output.entryPoint.replace('css-group:', ''), outputUrl(file)])
);
const ASSET_MAP = {};
for (const group of cssGroups) for (const sheet of group.sheets) ASSET_MAP[sheet] = groupUrl.get(group.name);
// url() assets (fonts) by source path, for rewriting index.html preloads.
const emittedAssets = new Map();
for (const [file, output] of cssOutputs)
  if (!output.entryPoint)
    for (const input of Object.keys(output.inputs)) emittedAssets.set(`./${input}`, outputUrl(file));

// --- JS --------------------------------------------------------------------
const threeFromVendor = {
  name: 'three-vendor',
  setup(builder) {
    builder.onResolve({ filter: /^three$/ }, () => ({ path: path.join(ROOT, 'vendor/three.module.min.js') }));
  },
};
const js = await build({
  absWorkingDir: ROOT,
  entryPoints: ['src/main.js'],
  plugins: [threeFromVendor],
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  outdir: DIST,
  entryNames: `${OUT_DIR}/[name]-[hash]`,
  chunkNames: `${OUT_DIR}/[name]-[hash]`,
  define: { __ASSET_MAP__: JSON.stringify(JSON.stringify(ASSET_MAP)), __DIST__: 'true' },
  metafile: true,
  logLevel: 'warning',
});
const jsOutputs = js.metafile.outputs;
const mainFile = Object.keys(jsOutputs).find((file) => jsOutputs[file].entryPoint === 'src/main.js');
const staticImports = (file, seen = new Set()) => {
  for (const { path: child, kind } of jsOutputs[file].imports)
    if (kind === 'import-statement' && !seen.has(child)) {
      seen.add(child);
      staticImports(child, seen);
    }
  return seen;
};
const eagerJs = [mainFile, ...staticImports(mainFile)];

// --- index.html ------------------------------------------------------------
let html = sourceHtml;
html = replaceOnce(
  html,
  /((?:[ \t]*<link rel="stylesheet" href="\.\/styles\/[^"]+\.css" \/>\n)+)[ \t]*<!-- Battle-sheet asset manifest[\s\S]*?-->\n(?:[ \t]*<!-- href="\.\/styles\/[^"]+\.css" -->\n)+/,
  [
    ...eagerGroups.map((group) => `    <link rel="stylesheet" href="${groupUrl.get(group.name)}" />\n`),
    ...eagerJs.map((file) => `    <link rel="modulepreload" href="${outputUrl(file)}" />\n`),
  ].join(''),
  'stylesheet block'
);
html = html.replace(/(<link rel="preload" href=")(\.\/[^"]+)(")/g, (_, open, href, close) => {
  if (!emittedAssets.has(href)) fail(`preloaded ${href} is not referenced by the CSS bundle`);
  return `${open}${emittedAssets.get(href)}${close}`;
});
html = replaceOnce(html, /[ \t]*<script type="importmap">[\s\S]*?<\/script>\n/, '', 'import map');
html = replaceOnce(
  html,
  /import\('\.\/src\/main\.js'\)/,
  `import('${outputUrl(mainFile)}')`,
  'main.js import'
);
await writeFile(path.join(DIST, 'index.html'), html);

// --- Static assets -----------------------------------------------------------
for (const file of STATIC_FILES) {
  await mkdir(path.dirname(path.join(DIST, file)), { recursive: true });
  await copyFile(path.join(ROOT, file), path.join(DIST, file));
}
for (const [dir, keep] of STATIC_DIRS)
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !keep(entry.name)) continue;
    const from = path.join(entry.parentPath, entry.name);
    const to = path.join(DIST, path.relative(ROOT, from));
    await mkdir(path.dirname(to), { recursive: true });
    await copyFile(from, to);
  }

// --- Service worker ----------------------------------------------------------
// Hashed files are immutable, so the install may take them from the HTTP cache;
// everything else is revalidated so a new build never precaches a stale copy.
const files = await listFiles(DIST);
const hashed = new Set(
  [...Object.keys(css.metafile.outputs), ...Object.keys(jsOutputs)].map((file) => outputUrl(file).slice(2))
);
const buildId = createHash('sha256');
for (const file of files) buildId.update(file).update(await readFile(path.join(DIST, file)));
const precache = {
  immutable: files.filter((file) => hashed.has(file)).map((file) => `./${file}`),
  revalidate: files.filter((file) => !hashed.has(file)).map((file) => `./${file}`),
};
const sw = await transform(await readFile(path.join(ROOT, 'sw.js'), 'utf8'), {
  minify: true,
  define: {
    __BUILD_ID__: JSON.stringify(buildId.digest('hex').slice(0, 12)),
    __PRECACHE__: JSON.stringify(precache),
  },
});
await writeFile(path.join(DIST, 'sw.js'), sw.code);

// --- Report ------------------------------------------------------------------
// Critical path = what the title waits on: the page, eager CSS and eager JS.
const critical = new Set([
  'index.html',
  ...eagerJs.map((file) => outputUrl(file).slice(2)),
  ...eagerGroups.map((group) => groupUrl.get(group.name).slice(2)),
]);
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`.padStart(10);
const total = { raw: 0, gzip: 0 };
console.log(`dist/ built (${files.length + 1} files)\n${'file'.padEnd(40)}       raw       gzip`);
for (const file of files.filter((name) => /\.(js|css|html)$/.test(name)).concat('sw.js')) {
  const bytes = await readFile(path.join(DIST, file)),
    gzip = gzipSync(bytes, { level: 9 }).length;
  if (critical.has(file)) {
    total.raw += bytes.length;
    total.gzip += gzip;
  }
  console.log(`${file.padEnd(40)}${kb(bytes.length)} ${kb(gzip)}${critical.has(file) ? '  critical' : ''}`);
}
console.log(`critical path total: ${kb(total.raw).trim()} raw, ${kb(total.gzip).trim()} gzip`);
