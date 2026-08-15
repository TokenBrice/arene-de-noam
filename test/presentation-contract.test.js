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
  assert.match(styles, /-webkit-line-clamp:\s*2/);
  assert.match(styles, /\.battle-screen \.arena-nameplate > small[\s\S]*white-space:\s*normal/);
  assert.match(i18n, /'battle\.speedLabel': 'Vitesse du combat : ×\{speed\}'/);
  assert.match(i18n, /'battle\.speedLabel': 'Battle speed: ×\{speed\}'/);
});
test('high-contrast and compact presentation details keep their semantic cues', async () => {
  const root = new URL('../', import.meta.url);
  const [accessibility, progression, components, base, selection, title, trials, draft, controller, i18n] =
    await Promise.all(
      [
        'styles/screens/accessibility.css',
        'styles/screens/progression.css',
        'styles/components.css',
        'styles/base.css',
        'styles/screens/selection.css',
        'src/screens/title.js',
        'src/screens/trials.js',
        'src/screens/draft.js',
        'src/battle-ui/controller.js',
        'src/i18n.js',
      ].map((file) => readFile(new URL(file, root), 'utf8'))
    );
  assert.match(accessibility, /body\.high-contrast\s+:is\(\.feat-hall, \.record-hero, \.league-rival, \.draft-card, \.boon-card, \.academy-card\)/);
  assert.match(accessibility, /body\.high-contrast \.screen::before\s*\{[\s\S]*display:\s*none/);
  assert.match(accessibility, /body\.high-contrast \.move-btn:disabled[\s\S]*border:\s*2px dashed/);
  assert.match(accessibility, /body\.high-contrast \.move-btn:disabled::after[\s\S]*content:\s*['"]▦['"]/);
  assert.match(progression, /\.feat-card\.locked\s*\{[\s\S]*opacity:\s*1/);
  assert.match(progression, /\.feat-card\.locked\s*>\s*i[\s\S]*saturate\(0\.6\)/);
  assert.match(progression, /\.feat-card\.locked::after[\s\S]*content:\s*['"]🔒['"]/);
  assert.match(components, /\.result-team img\.fallen\s*\{[\s\S]*grayscale\(0\.45\)\s*brightness\(0\.8\)/);
  assert.match(base, /\.roster-fan\s*\{[\s\S]*height:\s*140px/);
  assert.match(selection, /scroll-snap-type:\s*x proximity/);
  assert.match(selection, /mask-image:\s*linear-gradient/);
  assert.match(progression, /\.trial-squad img[\s\S]*width:\s*44px[\s\S]*height:\s*44px/);
  assert.match(title, /t\('app\.trials'\)/);
  assert.match(title, /t\('gauntlet\.title'\)/);
  assert.equal(draft.includes("<h3>${t('combo.title')}</h3>${comboRoutesHtml"), false);
  assert.match(controller, /data-last-label="\$\{escapeHtml\(t\('battle\.lastBadge'\)\)\}"/);
  assert.match(progression, /content: attr\(data-last-label\)/);
  assert.match(i18n, /'battle\.lastBadge': 'DERNIÈRE'/);
  assert.match(i18n, /'battle\.lastBadge': 'LAST'/);
});
