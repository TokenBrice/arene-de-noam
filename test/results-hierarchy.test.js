import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const results = await readFile(new URL('../src/screens/results.js', import.meta.url), 'utf8');
const gauntlet = await readFile(new URL('../src/screens/gauntlet.js', import.meta.url), 'utf8');
const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');

test('results actions lead the analytics reveal and defeat rematch is primary', () => {
  assert.ok(results.indexOf('<div class="results-grade">') < results.indexOf('<div class="result-actions results-reveal results-reveal--1">'));
  assert.ok(results.indexOf('<div class="result-actions results-reveal results-reveal--1">') < results.indexOf('<div class="battle-recap results-reveal results-reveal--3">'));
  assert.match(results, /actionButton\([^;]+, 'rematch', !win \? 'primary-btn' : 'subtle-btn'\)/);
  assert.match(results, /actionButton\(t\('result\.nextTrial'\), 'next-trial', 'subtle-btn'\)/);
  assert.match(results, /data-action="next-trial"/);
  assert.match(results, /ctx\.selection = null;\n    renderTrials\(\)/);
  assert.match(results, /const mvpBlock\s*=\s*[\s\S]*?recap\.mvp\.damage > 0/);
});

test('performance breakdown omits the victory bonus when the battle is a defeat', () => {
  assert.match(gauntlet, /function performanceHtml\(grade, compact = false, win = true\)/);
  assert.match(gauntlet, /\(win \? \['victory', 'tempo', 'survival'\] : \['tempo', 'survival'\]\)/);
  assert.match(results, /performanceHtml\(ctx\.pendingRewards\?\.grade, false, win\)/);
});

test('trial follow-up action has both locale translations', () => {
  assert.match(i18n, /'result\.nextTrial': 'Voir les épreuves'/);
  assert.match(i18n, /'result\.nextTrial': 'View trials'/);
});
