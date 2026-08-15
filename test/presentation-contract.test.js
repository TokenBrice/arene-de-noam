import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOVES } from '../src/data/moves.js';
import { AFFINITIES, AFFINITY_ORDER } from '../src/data/affinities.js';
import { STATUS_DEFINITIONS } from '../src/battle/statuses.js';
import { CLASSES, CLASS_ORDER, classIcon } from '../src/data/classes.js';

test('all six types have unique original SVG geometry and the settled accessible palette', () => {
  const expectedColors = {
    flame: '#FF6B4A',
    tide: '#4DA6FF',
    grove: '#55C878',
    force: '#F2B84B',
    mind: '#E879C6',
    shadow: '#9B8CFF',
  };
  const paths = AFFINITY_ORDER.map((id) => AFFINITIES[id].iconPath);
  const statusColors = new Set(
    Object.values(STATUS_DEFINITIONS).map(({ color }) => color.toUpperCase())
  );
  assert.equal(new Set(paths).size, 6);
  for (const id of AFFINITY_ORDER) {
    assert.ok(AFFINITIES[id].iconPath.length > 30, `${id} needs authored SVG geometry`);
    assert.equal(AFFINITIES[id].color, expectedColors[id]);
    assert.equal(statusColors.has(AFFINITIES[id].color.toUpperCase()), false);
    assert.equal('icon' in AFFINITIES[id], false, `${id} must not fall back to a text glyph`);
  }
});

test('all six classes have distinct muted SVG identities outside type and status palettes', () => {
  const colors = CLASS_ORDER.map((id) => CLASSES[id].color.toUpperCase()),
    paths = CLASS_ORDER.map((id) => CLASSES[id].iconPath),
    reserved = new Set([
      ...Object.values(AFFINITIES).map(({ color }) => color.toUpperCase()),
      ...Object.values(STATUS_DEFINITIONS).map(({ color }) => color.toUpperCase()),
    ]);
  assert.equal(new Set(colors).size, 6);
  assert.equal(new Set(paths).size, 6);
  for (const id of CLASS_ORDER) {
    assert.ok(CLASSES[id].iconPath.length > 30);
    assert.equal(reserved.has(CLASSES[id].color.toUpperCase()), false);
    assert.match(classIcon(id, { title: id }), /viewBox="0 0 24 24"/);
    assert.match(classIcon(id, { title: id }), /role="img"/);
  }
});

test('all ninety moves have authored, move-specific animation choreography', async () => {
  const root = new URL('../', import.meta.url);
  const index = await readFile(new URL('index.html', root), 'utf8');
  const stylesheets = [...index.matchAll(/href="(\.\/styles\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(
    (match) => match[1]
  );
  const css = (
    await Promise.all(stylesheets.map((stylesheet) => readFile(new URL(stylesheet, root), 'utf8')))
  ).join('\n');
  for (const moveId of Object.keys(MOVES))
    assert.match(
      css,
      new RegExp(`\\.move-${moveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
      `${moveId} needs its own animation selector`
    );
});
test('battle controls expose dialog, speed, plate, overflow, and mobile rule semantics', async () => {
  const root = new URL('../', import.meta.url);
  const [controller, hud, shell, styles, i18n] = await Promise.all(
    [
      'src/battle-ui/controller.js',
      'src/battle-ui/hud.js',
      'src/app/shell.js',
      'styles/screens/battle-layout.css',
      'src/i18n.js',
    ].map((file) => readFile(new URL(file, root), 'utf8'))
  );
  assert.match(controller, /replacementCard\?\.setAttribute\('role', 'dialog'\)/);
  assert.match(controller, /replacementCard\?\.setAttribute\('aria-modal', 'true'\)/);
  assert.match(controller, /replacementCard\?\.setAttribute\('aria-labelledby', 'replacement-title'\)/);
  assert.match(controller, /function closeSwitch\(/);
  assert.match(shell, /closeSwitch\(\)/);
  assert.match(controller, /battle\.speedLabel/);
  assert.match(controller, /className = 'plate-status-more'/);
  assert.match(controller, /battle\.statusOverflow/);
  assert.match(
    controller,
    /closeSwitch\(\{[\s\S]*restoreFocus: !state\.sides\.player\.pendingReplacement,[\s\S]*focusAfterUnlock: !state\.sides\.player\.pendingReplacement/
  );
  assert.match(styles, /-webkit-line-clamp:\s*2/);
  assert.match(styles, /\.battle-screen \.arena-nameplate > small[\s\S]*white-space:\s*normal/);
  assert.match(i18n, /'battle\.speedLabel': 'Vitesse du combat : ×\{speed\}'/);
  assert.match(i18n, /'battle\.speedLabel': 'Battle speed: ×\{speed\}'/);
});
