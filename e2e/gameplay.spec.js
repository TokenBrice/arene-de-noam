import { test, expect } from '@playwright/test';
import {
  expectNoRuntimeLeaks,
  installCompletedTutorial,
  playVisibleBattle,
  watchRuntime,
} from './helpers.js';

// Battle tools live in the pause sheet (docs/battle-presentation.md §11.5); sheets stack, and
// Escape closes the top one.
async function openPause(page) {
  await page.locator('[data-action="battle-pause"]').click();
  await expect(page.locator('.pause-sheet')).toBeVisible();
}

async function openLog(page) {
  await openPause(page);
  await page.locator('[data-action="battle-log"]').click();
  const log = page.getByRole('dialog', { name: 'Journal du combat' });
  await expect(log).toBeVisible();
  return log;
}

async function openCodex(page) {
  await openPause(page);
  await page.locator('[data-action="battle-help"]').click();
  const codex = page.getByRole('dialog', { name: 'Codex du combat' });
  await expect(codex).toBeVisible();
  return codex;
}

async function closeSheets(page) {
  while (await page.locator('.sheet').count()) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
  }
}

// The dock stays mounted with enabled buttons while a turn plays (it only fades out), so "the
// controls are back" means the battle screen has unlocked.
function controls(page, selector = '[data-move]:enabled') {
  return page.locator(`.battle-screen:not(.locked) ${selector}`);
}

async function controlsBack(page, timeout = 10000) {
  await expect(controls(page).first()).toBeVisible({ timeout });
}

// Real ms from a click on `locator` until the controls come back (the turn's playback).
async function turnMs(page, locator, { hold = false } = {}) {
  await page.evaluate(() => {
    window.__turn = null;
    const start = () => {
      const began = performance.now();
      let seenLock = false;
      const tick = () => {
        const locked = document.querySelector('.battle-screen.locked');
        seenLock ||= Boolean(locked);
        if (seenLock && !locked && document.querySelector('[data-move]:not([disabled])'))
          window.__turn = performance.now() - began;
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    document.addEventListener('click', start, { capture: true, once: true });
  });
  await locator.click();
  if (hold) {
    // Press the stage as soon as the dock locks; the director also catches a pointer that is
    // already down when the turn starts.
    await page.locator('.battle-screen.locked').waitFor();
    const stage = await page.locator('.battle-stage').boundingBox();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.6);
    await page.mouse.down();
  }
  await expect.poll(() => page.evaluate(() => window.__turn), { timeout: 20000 }).not.toBeNull();
  if (hold) await page.mouse.up();
  return page.evaluate(() => window.__turn);
}

// #fx-text readout blocks and K.O. stamps are pooled nodes animated with WAAPI. A per-frame
// sampler records every showing (a new animation on a node) with its text, its stamp pill,
// whether it stayed inside the stage on every sampled frame, the largest share of its creature's
// rest box (the stage anchor variables, §11.2) it ever covered and its distance from that box.
async function recordReadouts(page) {
  await page.evaluate(() => {
    const shows = (window.__readouts = []),
      current = new WeakMap();
    const sample = () => {
      const stage = document.querySelector('.battle-stage');
      if (stage) {
        const frame = stage.getBoundingClientRect(),
          vars = getComputedStyle(stage);
        for (const node of document.querySelectorAll('#fx-text .fx-number, #fx-text .fx-stamp')) {
          const animation = node.getAnimations()[0];
          if (!animation) continue;
          let show = current.get(node);
          if (show?.animation !== animation) {
            show = {
              animation,
              record: {
                type: node.classList.contains('fx-stamp') ? 'stamp' : 'number',
                side: node.dataset.side,
                kind: node.dataset.kind ?? null,
                inside: true,
                cover: 0,
              },
            };
            current.set(node, show);
            shows.push(show.record);
          }
          const value = node.querySelector('.fx-value') ?? node,
            outer = node.getBoundingClientRect(),
            side = show.record.side,
            px = (name) => parseFloat(vars.getPropertyValue(`--${side}-${name}`)),
            creature = {
              left: frame.left + px('x') - px('size') * 0.35,
              right: frame.left + px('x') + px('size') * 0.35,
              top: frame.top + px('head-y'),
              bottom: frame.top + px('feet-y'),
            },
            covered =
              Math.max(0, Math.min(outer.right, creature.right) - Math.max(outer.left, creature.left)) *
              Math.max(0, Math.min(outer.bottom, creature.bottom) - Math.max(outer.top, creature.top));
          Object.assign(show.record, {
            gap: Math.hypot(
              Math.max(0, creature.left - outer.right, outer.left - creature.right),
              Math.max(0, creature.top - outer.bottom, outer.top - creature.bottom)
            ),
            text: value.textContent.trim(),
            stamp: node.querySelector('.fx-stamp-pill:not([hidden])')?.textContent.trim() ?? null,
            tags: node.querySelector('.fx-tags')?.textContent.trim() ?? '',
            inside:
              show.record.inside &&
              outer.left >= frame.left &&
              outer.right <= frame.right &&
              outer.top >= frame.top &&
              outer.bottom <= frame.bottom,
            cover: Math.max(
              show.record.cover,
              covered / ((creature.right - creature.left) * (creature.bottom - creature.top))
            ),
          });
        }
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

function readouts(page) {
  return page.evaluate(() => window.__readouts);
}

// Banners are pooled per kind and shown for 450–900 ms: record each showing (the node loses its
// `hidden` attribute) with its text, instead of polling for a short visible window. Stage banners
// live in #fx-text; the top-band pills (Signature ready, switch-in, weather) on the screen root.
async function recordBanners(page) {
  await page.evaluate(() => {
    const shows = (window.__banners = []);
    new MutationObserver((records) => {
      for (const { target } of records)
        if (target.matches('.fx-banner') && !target.hidden)
          shows.push({
            kind: target.dataset.kind,
            side: target.dataset.side ?? null,
            text: target.textContent,
          });
    }).observe(document.querySelector('.battle-screen'), {
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
  });
}

function banners(page) {
  return page.evaluate(() => window.__banners);
}

// Every text the narration box (#action-line) shows during playback.
async function recordLines(page) {
  await page.evaluate(() => {
    const line = document.querySelector('#action-line'),
      shown = (window.__lines = []);
    new MutationObserver(() => shown.push(line.textContent)).observe(line, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

function lines(page) {
  return page.evaluate(() => window.__lines);
}

test('visible tutorial teaches types, Combo, Signature, and switch, then completes', async ({ page }) => {
  test.setTimeout(90000);
  const runtime = watchRuntime(page);
  await page.goto('/?seed=4242&animations=0');
  await page.getByRole('button', { name: /Jouer/ }).click();
  // The first battle also loads and compiles the arena (slow on a cold SwiftShader worker).
  await expect(page.getByText(/Le type Combat est faible face au type Psy/)).toBeVisible({ timeout: 15000 });
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('#hud-enemy')).toContainText('Marqué');
  const markedToken = page.locator('#hud-enemy .plate-status[data-status="marked"]');
  await expect(markedToken).toHaveClass(/negative/);
  await expect(markedToken.locator('.status-icon-target-lock')).toHaveCount(1);
  await expect(markedToken).toHaveCSS('--status-color', '#AD1457');
  const log = await openLog(page);
  await expect(log.locator('.battle-log li').filter({ hasText: 'Marqué' })).toHaveCount(1);
  await closeSheets(page);
  await expect(page.getByText(/Kordane est Marqué/)).toBeVisible();
  await expect(controls(page, '[data-move="slowing_riddle"]')).toBeVisible();
  await page.locator('[data-move="slowing_riddle"]').click();
  await expect(page.locator('#hud-enemy')).not.toContainText('Marqué');
  await expect(page.getByText(/Éclat est plein/)).toBeVisible();
  await expect(controls(page, '[data-move="oracle_veil"]')).toBeVisible();
  await page.locator('[data-move="oracle_veil"]').click();
  await expect(page.getByText(/Calderoc est de type Feu.*Eau sont super efficaces/)).toBeVisible();
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled();
  await page.locator('[data-action="open-switch"]').click();
  await page.locator('[data-switch-index]').filter({ hasText: 'Abyssar' }).click();
  await expect(page.getByText(/À toi\. Observe les PV et termine le combat/)).toBeVisible();
  await playVisibleBattle(page, { untilSelection: true });
  await expect(page.getByRole('heading', { name: 'Compose ton équipe' })).toBeVisible();
  await expectNoRuntimeLeaks(runtime);
});

test('reduced-motion tutorial outro is presented before team select', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/?seed=4242');
  await page.getByRole('button', { name: /Réglages/ }).click();
  await page.locator('#motion').check();
  await page.getByRole('button', { name: /Retour/ }).click();
  await page.getByRole('button', { name: /Jouer/ }).click();
  // The first battle also loads and compiles the arena (slow on a cold SwiftShader worker).
  await expect(page.getByText(/Le type Combat est faible face au type Psy/)).toBeVisible({ timeout: 15000 });
  for (const move of ['lucid_arc', 'slowing_riddle', 'oracle_veil']) {
    await expect(controls(page, `[data-move="${move}"]`)).toBeVisible();
    await page.locator(`[data-move="${move}"]`).click();
  }
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled();
  await page.locator('[data-action="open-switch"]').click();
  await page.locator('[data-switch-index]').filter({ hasText: 'Abyssar' }).click();
  await expect(page.getByText(/À toi\. Observe les PV et termine le combat/)).toBeVisible();
  await page.evaluate(() => {
    window.__tutorialOutroSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.battle-outro')) window.__tutorialOutroSeen = true;
    }).observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  await playVisibleBattle(page, { untilSelection: true, maxIterations: 3000 });
  expect(await page.evaluate(() => window.__tutorialOutroSeen)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Compose ton équipe' })).toBeVisible();
});

test('configures a team and finishes a seeded full quick battle', async ({ page }) => {
  const runtime = watchRuntime(page);
  await installCompletedTutorial(page);
  await page.goto('/?seed=88&animations=0&player=calderoc,kordane,farfombre&enemy=virelia,orakyn,abyssar');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('.difficulty-preview')).toContainText('catégorie d’action');
  await page.getByLabel('Difficulté').selectOption('champion');
  await expect(page.locator('.difficulty-preview')).toContainText('Intentions masquées');
  await page.getByLabel('Arène').selectOption('eclipse');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('#arena')).toBeVisible();
  await expect(page.locator('#contract-chip, .flow-chip, .arena-resonance')).toHaveCount(0);
  await page.locator('[data-move]:enabled').first().click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  // ?animations=0 is the readout-only path: no stage text, no banners.
  await expect(page.locator('#fx-text > *')).toHaveCount(0);
  await playVisibleBattle(page);
  const resultHeading = page.getByRole('heading', { name: /Victoire|Belle bataille/ });
  await expect(resultHeading).toBeVisible();
  const victory = (await resultHeading.textContent()).includes('Victoire');
  // Defeat stays friendly: the grade card only appears on a victory.
  await expect(page.locator('.performance-grade')).toHaveCount(victory ? 1 : 0);
  await expect(page.locator('.mastery-reward')).toHaveCount(3);
  await expect(page.locator('.result-team img')).toHaveCount(3);
  expect(
    await page
      .locator('.result-team img')
      .evaluateAll((images) => images.map((image) => getComputedStyle(image).opacity))
  ).toEqual(['1', '1', '1']);
  await expect(page.locator('.battle-recap')).toBeVisible();
  await expect(page.getByText('CRÉATURE DU MATCH')).toBeVisible();
  // The recap lists only non-zero totals, and those totals agree with the trio report.
  const recapStats = await page
    .locator('.battle-recap .recap-stats > span')
    .evaluateAll((spans) =>
      spans.map((span) => [
        span.querySelector('small').textContent,
        Number(span.querySelector('b').textContent),
      ])
    );
  for (const [, value] of recapStats) expect(value).toBeGreaterThan(0);
  const trio = await page
    .locator('.squad-report article dl')
    .evaluateAll((lists) =>
      lists.map((dl) => [...dl.querySelectorAll('dd')].map((dd) => Number(dd.textContent)))
    );
  const dealt = trio.reduce((sum, [damage]) => sum + damage, 0),
    combos = trio.reduce((sum, [, , comboCount]) => sum + comboCount, 0);
  expect(dealt).toBeGreaterThan(0);
  const recap = Object.fromEntries(recapStats);
  expect(recap['infligés']).toBe(dealt);
  expect(recap.Combos).toBe(combos > 0 ? combos : undefined);
  if (victory) {
    await expect(page.locator('.performance-grade .grade-detail > span')).toHaveCount(3);
    await expect(page.locator('.performance-grade')).toContainText('Victoire');
    await expect(page.locator('.performance-grade')).toContainText('Tours');
    await expect(page.locator('.performance-grade')).toContainText('Survivants');
  }
  await expect(page.locator('.squad-report article')).toHaveCount(3);
  await expect(page.locator('.squad-report')).toContainText('RAPPORT DU TRIO');
  await expect(page.locator('.squad-report')).toContainText('actions');
  await page.getByRole('button', { name: /Revoir le combat/ }).click();
  await expect(page.getByRole('dialog', { name: 'Journal du combat' })).toBeVisible();
  await expect(page.locator('.battle-log li.turn-start')).not.toHaveCount(0);
  await page.keyboard.press('Escape');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.battlesPlayed).toBe(1);
  expect(saved.bestGrade).toMatch(/[ABCDS]/);
  expect(saved.mastery.calderoc).toBeGreaterThan(0);
  await expectNoRuntimeLeaks(runtime);
});

test('×2 speed plays the same turn about twice as fast, rematches included', async ({ page }) => {
  test.setTimeout(120000);
  const query = '/?seed=18&enemyHp=1&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre';
  await installCompletedTutorial(page, {
    reducedMotion: false,
    battleSpeed: 1,
    lastTeam: ['orakyn', 'abyssar', 'virelia'],
  });
  const enter = async () => {
    await page.goto(query);
    await page.getByRole('button', { name: /Combat rapide/ }).click();
    await page.getByRole('button', { name: /Entrer dans/ }).click();
    await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible({ timeout: 8000 });
  };
  await enter();
  const normal = await turnMs(page, page.locator('[data-move="lucid_arc"]'));
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('arene-de-noam-save'));
    localStorage.setItem('arene-de-noam-save', JSON.stringify({ ...save, battleSpeed: 2 }));
  });
  await enter();
  const fast = await turnMs(page, page.locator('[data-move="lucid_arc"]'));
  expect(fast).toBeLessThan(normal * 0.7);
  await playVisibleBattle(page, { maxIterations: 3000 });
  await expect(page.getByRole('heading', { name: /Victoire|Belle bataille/ })).toBeVisible();
  await page.getByRole('button', { name: 'Revanche' }).click();
  await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible({ timeout: 8000 });
  const rematch = await turnMs(page, page.locator('[data-move="lucid_arc"]'));
  expect(rematch).toBeLessThan(normal * 0.7);
});

test('holding the stage hurries the turn without dropping a single hit number', async ({ page }) => {
  test.setTimeout(60000);
  const query = '/?seed=24&player=lumivox,orakyn,virelia&enemy=kordane,calderoc,farfombre';
  await installCompletedTutorial(page, {
    lastTeam: ['lumivox', 'orakyn', 'virelia'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  const enter = async () => {
    await page.goto(query);
    await page.getByRole('button', { name: /Combat rapide/ }).click();
    await page.getByRole('button', { name: /Entrer dans/ }).click();
    await expect(controls(page, '[data-move="echo_chorus"]')).toBeVisible({ timeout: 8000 });
  };
  await enter();
  const normal = await turnMs(page, page.locator('[data-move="echo_chorus"]'));
  await enter();
  // Record every damage number the enemy shows while the stage is held, with its pooled node.
  await page.evaluate(() => {
    const layer = document.querySelector('#fx-text');
    window.__numbers = [];
    new MutationObserver((records) => {
      for (const record of records) {
        const number = record.target.closest?.('.fx-number[data-side="enemy"][data-kind="damage"]');
        if (number && record.target.matches('.fx-value'))
          window.__numbers.push({
            node: [...layer.children].indexOf(number),
            text: record.target.textContent,
          });
      }
    }).observe(layer, { childList: true, subtree: true });
  });
  const held = await turnMs(page, page.locator('[data-move="echo_chorus"]'), { hold: true });
  expect(held).toBeLessThan(normal * 0.6);
  // Each of the three hits bumps one running chain total: same node, growing damage.
  const numbers = await page.evaluate(() => window.__numbers);
  expect(numbers.map(({ text }) => text)).toEqual([
    expect.stringMatching(/^−\d+$/),
    expect.stringMatching(/^−\d+$/),
    expect.stringMatching(/^−\d+$/),
  ]);
  expect(new Set(numbers.map(({ node }) => node)).size).toBe(1);
  const totals = numbers.map(({ text }) => Number(text.slice(1)));
  expect(totals[1]).toBeGreaterThan(totals[0]);
  expect(totals[2]).toBeGreaterThan(totals[1]);
});

test('quick battle rules alter the fight and remain visible in the codex', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=40&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('#quick-rule option')).toHaveCount(6);
  await page.getByLabel('Règle du duel').selectOption('relay_rush');
  await expect(page.getByText(/\+24 Éclat/)).toBeVisible();
  await page.getByLabel('Règle du duel').selectOption('fortress_duel');
  await expect(
    page.getByText('Chaque créature des deux équipes commence avec 18 de barrière.')
  ).toBeVisible();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('#hud-player')).toContainText(/Barrière (18|24)/);
  await expect(page.locator('#hud-enemy')).toContainText(/Barrière (18|24)/);
  await openPause(page);
  await expect(page.locator('.pause-context .quick-rule-line')).toContainText('Duel des forteresses');
  await page.locator('[data-action="battle-help"]').click();
  await expect(page.locator('.quick-rule-codex')).toContainText('Duel des forteresses');
});

test('Relay Rush turns a voluntary switch into immediate tempo', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/?seed=41');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByLabel('Règle du duel').selectOption('relay_rush');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled({ timeout: 8000 });
  await recordBanners(page);
  await page.locator('[data-action="open-switch"]').click();
  await expect(page.locator('.switch-bonus')).toContainText('+24 Éclat');
  await page.locator('[data-switch-index]').first().click();
  await controlsBack(page);
  expect(await banners(page)).toContainEqual(
    expect.objectContaining({ kind: 'switch-in', side: 'player', text: expect.stringContaining('+24 Éclat') })
  );
  await expect(page.locator('#hud-player')).toContainText('Accéléré');
  const hasteToken = page.locator('#hud-player .plate-status[data-status="haste"]');
  await expect(hasteToken).toHaveClass(/positive/);
  await expect(hasteToken.locator('.status-icon-wing')).toHaveCount(1);
  await expect(hasteToken).toHaveCSS('--status-color', '#C6FF00');
  await openPause(page);
  await expect(page.locator('.pause-context .quick-rule-line')).toContainText('Relais incandescent');
});

test('conquering the League unlocks a rotating Champion Circuit', async ({ page }) => {
  await installCompletedTutorial(page, {
    ladderVictories: 12,
    circuitWins: 0,
  });
  await page.goto('/?seed=40&animations=0');
  await expect(page.getByRole('button', { name: /Circuit des champions/ })).toBeVisible();
  await page.getByRole('button', { name: /Circuit des champions/ }).click();
  await expect(page.getByRole('heading', { name: 'Circuit des champions' })).toBeVisible();
  await expect(page.locator('.circuit-condition')).toContainText('Orage de Signatures');
  await expect(page.locator('.circuit-condition')).toContainText('100 Éclat');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('#hud-player .surge-row')).toContainText('100/100');
  await openCodex(page);
  await expect(page.locator('.circuit-codex')).toContainText('Orage de Signatures');
});

test('move choices expose distinct damage and support tiles with a readable forecast', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=14&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.move-btn.kind-damage')).toHaveCount(2);
  await expect(page.locator('.move-btn.kind-support')).toHaveCount(1);
  await expect(page.locator('[data-move="oracle_veil"]')).toBeDisabled();
  await page.locator('[data-move="lucid_arc"]').click({ button: 'right' });
  await expect(page.locator('.exchange-preview')).toHaveCount(1);
  await expect(page.locator('.exchange-preview')).toContainText('Toi');
  await closeSheets(page);
  await expect(page.locator('.team-dot')).toHaveCount(6);
  await expect(page.locator('#hud-player .team-dot.active')).toHaveCount(1);
  await expect(page.locator('#hud-enemy .team-dot.active')).toHaveCount(1);
});

test('affinity advantage lands with its stamp, its number and the narration emphasis', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['orakyn', 'abyssar', 'virelia'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto('/?seed=14&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await controlsBack(page, 8000);
  await recordReadouts(page);
  await recordLines(page);
  await page.locator('[data-move="lucid_arc"]').click();
  await controlsBack(page);
  // One readout block: the stamp pill over the number, inside the stage, beside the target
  // rather than over it.
  const hit = (await readouts(page)).find(
    (record) => record.type === 'number' && record.side === 'enemy' && record.kind === 'damage'
  );
  expect(hit).toEqual(
    expect.objectContaining({
      text: expect.stringMatching(/^−\d+$/),
      stamp: expect.stringMatching(/efficace/i),
      inside: true,
    })
  );
  expect(hit.cover).toBeLessThan(0.15);
  // The narration carries the stamp as its emphasis line from the contact on, not before.
  const shownLines = await lines(page),
    plain = shownLines.findIndex((line) => /Arc lucide\.?\s*$/.test(line)),
    stressed = shownLines.findIndex((line) => /Arc lucide.*Super efficace/.test(line));
  expect(plain).toBeGreaterThanOrEqual(0);
  expect(stressed).toBeGreaterThan(plain);
});

test('multi-hit techniques count every hit on the chain counter', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['lumivox', 'orakyn', 'virelia'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto('/?seed=24&player=lumivox,orakyn,virelia&enemy=kordane,calderoc,farfombre');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(controls(page, '[data-move="echo_chorus"]')).toBeVisible({ timeout: 8000 });
  // The counter rides the target's number ("−31 ×3").
  await page.evaluate(() => {
    window.__chain = [];
    const layer = document.querySelector('#fx-text');
    new MutationObserver(() => {
      const node = layer.querySelector('.fx-number[data-side="enemy"] .fx-chain:not([hidden])');
      const text = node?.textContent.trim();
      if (text && window.__chain.at(-1) !== text) window.__chain.push(text);
    }).observe(layer, { childList: true, subtree: true, characterData: true, attributes: true });
  });
  await page.locator('[data-move="echo_chorus"]').click();
  await expect.poll(() => page.evaluate(() => window.__chain), { timeout: 6000 }).toEqual(['×1', '×2', '×3']);
});

test('Coach cleanses penalties, grants 15 Surge, costs no action, and is once per battle', async ({
  page,
}) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto(
    '/?seed=14&player=kordane,abyssar,virelia&enemy=orakyn,calderoc,farfombre&enemyMove=slowing_riddle'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  const command = page.locator('[data-action="trainer-command"]');
  await expect(controls(page, '[data-move="crystal_strike"]')).toBeVisible({ timeout: 8000 });
  await expect(command).toHaveCount(0);
  await page.locator('[data-move="crystal_strike"]').click();
  await expect(page.locator('#hud-player')).toContainText('Sonné', { timeout: 5000 });
  const stunnedToken = page.locator('#hud-player .plate-status[data-status="stunned"]');
  await expect(stunnedToken).toHaveClass(/negative/);
  await expect(stunnedToken.locator('.status-icon-dizzy-stars')).toHaveCount(1);
  await expect(stunnedToken).toHaveCSS('--status-color', '#FFEA70');
  await expect(command).toBeVisible({ timeout: 5000 });
  const before = Number(
    (await page.locator('#hud-player .plate-surge-number').textContent()).match(/\d+/)[0]
  );
  await recordBanners(page);
  await command.click();
  await controlsBack(page, 5000);
  expect(await banners(page)).toContainEqual(
    expect.objectContaining({ kind: 'trainer-command', text: expect.stringContaining('Coup de pouce') })
  );
  await expect(command).toHaveCount(0);
  await expect(page.locator('#hud-player')).not.toContainText('Sonné');
  const after = Number((await page.locator('#hud-player .plate-surge-number').textContent()).match(/\d+/)[0]);
  expect(after - before).toBe(15);
  await openCodex(page);
  await expect(page.locator('.trainer-command-codex.used')).toContainText('Coup de pouce utilisé');
});

test('restorative techniques display their recovered HP at the creature', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['nymbloom', 'abyssar', 'virelia'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto('/?seed=61&enemyMove=supernova');
  await page.getByRole('button', { name: 'Épreuves' }).click();
  await page.locator('.trial-card').nth(4).getByRole('button', { name: 'Jouer cette épreuve' }).click();
  await expect(page.getByRole('heading', { name: 'La Dernière Lueur' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Jouer cette épreuve' }).click();
  await expect(controls(page, '[data-move="bubble_burst"]')).toBeVisible({ timeout: 8000 });
  await page.locator('[data-move="bubble_burst"]').click();
  await expect(controls(page, '[data-move="healing_rain"]')).toBeVisible({ timeout: 15000 });
  await recordReadouts(page);
  await page.locator('[data-move="healing_rain"]').click();
  // The heal number rides the healed creature: beside its rest box (the stage anchor vars), not
  // over it.
  await expect
    .poll(() => readouts(page), { timeout: 15000 })
    .toContainEqual(
      expect.objectContaining({
        type: 'number',
        kind: 'heal',
        side: 'player',
        text: expect.stringMatching(/^\+\d+$/),
      })
    );
  const heal = (await readouts(page)).find(
    (record) => record.type === 'number' && record.kind === 'heal' && record.side === 'player'
  );
  expect(heal.cover).toBeLessThan(0.15);
  expect(heal.gap).toBeLessThan(48);
});

test('reaching full Surge triggers a creature-specific Signature-ready cut-in', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto(
    '/?seed=14&player=solflare,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=resonant_focus'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(controls(page, '[data-move="sun_spear"]')).toBeVisible({ timeout: 8000 });
  await recordBanners(page);
  // Solflare's Sunborn talent makes Supernova playable from 80 Surge: the third Sun Spear
  // (30 → 50 → 70 → 90) crosses it, and the banner announces it right then.
  for (let action = 0; action < 3; action++) {
    await expect(controls(page, '[data-move="sun_spear"]')).toBeVisible({ timeout: 8000 });
    await page.locator('[data-move="sun_spear"]').click();
  }
  await expect
    .poll(() => banners(page), { timeout: 8000 })
    .toContainEqual(
      expect.objectContaining({
        kind: 'signature-ready',
        side: 'player',
        text: expect.stringContaining('Supernova'),
      })
    );
});

test('removed pre-battle systems leave no selection, intro, HUD, or codex surface', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=40&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('[data-doctrine], #contract-select, .contract-preview, .team-bonds')).toHaveCount(
    0
  );
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.intro-contract, #contract-chip, .flow-chip, .arena-resonance')).toHaveCount(0);
  await openCodex(page);
  await expect(page.locator('.contract-codex, .flow-codex, .resonance-codex')).toHaveCount(0);
});

test('roster cards scout favorable targets and threats in the revealed rival trio', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?enemy=kordane,calderoc,virelia');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('.scout-read')).toHaveCount(30);
  await expect(page.locator('[data-creature="abyssar"] .scout-read')).toContainText('1 cible favorable');
  await expect(page.locator('[data-creature="abyssar"] .scout-read')).toContainText('1 menace');
  await expect(page.locator('.scout-read').filter({ hasText: /\b1 (cibles|menaces)\b/ })).toHaveCount(0);
  await expect(page.locator('.creature-card.scout-strong')).not.toHaveCount(0);
});

test('Eclipse of Grace purges the rival team after its aimed transaction', async ({ page }) => {
  await installCompletedTutorial(page);
  // Aubéastre's Kindred Halo (priority +1) makes its whole trio Concentré first; the slower
  // Eclipse then lands on Aubéastre and purges the bench as well.
  await page.goto(
    '/?seed=814201&animations=0&player=deuilastre,orakyn,kordane&enemy=aubeastre,virelia,pactigon&enemyMove=kindred_halo'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('#quick-rule').selectOption('starstorm');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(controls(page, '[data-move="eclipse_of_grace"]')).toBeVisible();
  await page.locator('[data-move="eclipse_of_grace"]').click();
  await controlsBack(page);
  const log = await openLog(page);
  const entries = log.locator('.battle-log li');
  await expect(entries.filter({ hasText: 'Éclipse des grâces' })).toHaveCount(1);
  for (const benched of ['Virelia', 'Pactigon'])
    await expect(entries.filter({ hasText: `${benched} perd Concentré` })).toHaveCount(1);
});

test('Immaculate Relay reuses the selector and switches only after the aimed attack', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto(
    '/?seed=814202&animations=0&player=aubeastre,deuilastre,pactigon&enemy=orakyn,kordane,virelia&enemyMove=lucid_arc'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('#quick-rule').selectOption('starstorm');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  const relay = page.locator('[data-move="immaculate_relay"]');
  await relay.click();
  await expect(page.getByRole('heading', { name: 'Choisis l’allié protégé' })).toBeVisible();
  await expect(page.locator('.signature-relay [data-switch-index]')).toHaveCount(2);
  await expect(page.locator('.signature-relay .switch-incoming')).toHaveText([
    /Aucun impact entrant.*purifié.*Concentré/,
    /Aucun impact entrant.*purifié.*Concentré/,
  ]);
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(relay).toBeFocused();
  await relay.click();
  await page.locator('.signature-relay [data-switch-index="1"]').click();
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-creature', 'deuilastre');
  await controlsBack(page);
  const log = await openLog(page);
  await expect(log).toContainText('Arc lucide');
  await expect(log).toContainText(/Deuilastre entre purifié et Concentré/);
});

test('ladder rivals telegraph and trigger their unique ace phase', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=18&animations=0&enemyHp=1');
  await page.getByRole('button', { name: /Jouer|Continuer/ }).click();
  await expect(page.locator('.trainer-ace')).toContainText('Second souffle');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  // Every rival starts at 1 HP. Arc 1 K.O.s the lead; the rival's Virelia heals itself before
  // arc 2 lands; arc 3 K.O.s it, and the last rival standing triggers the ace.
  for (let arc = 0; arc < 3; arc++) {
    await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible();
    await page.locator('[data-move="lucid_arc"]').click();
  }
  await controlsBack(page);
  await openCodex(page);
  await expect(page.locator('.ace-codex.triggered')).toContainText('Second souffle');
});

test('keyboard numbers choose moves and C opens switching', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=12&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.getByText('Tour 1')).toBeVisible();
  await expect(page.locator('.intent-read')).toBeVisible();
  await expect(page.locator('.intent-read')).not.toContainText('Illisible');
  await page.keyboard.press('1');
  await expect(page.getByText('Tour 2')).toBeVisible();
  await controlsBack(page);
  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: /Qui prend sa place/ })).toBeVisible();
  await expect(page.locator('.switch-incoming')).toHaveCount(2);
  await expect(page.locator('.switch-incoming').first()).toContainText(/Dégâts prévus/);
  await expect(page.locator('.switch-option.recommended')).toHaveCount(1);
  await expect(page.locator('.switch-option.recommended')).toContainText('Changement conseillé');
});

test('a predicted resisted attack exposes and celebrates a Perfect Relay', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['abyssar', 'orakyn', 'virelia'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto(
    '/?seed=1&player=abyssar,orakyn,virelia&enemy=kordane,calderoc,farfombre&enemyMove=crystal_strike'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.intent-read')).toContainText('Frappe cristal');
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled({ timeout: 8000 });
  await recordBanners(page);
  await recordLines(page);
  await page.keyboard.press('c');
  const relay = page.locator('.switch-option.perfect-read');
  await expect(relay).toHaveCount(1);
  await expect(relay).toContainText('RELAIS PARFAIT · +6 Éclat');
  await relay.click();
  await controlsBack(page);
  expect(await banners(page)).toContainEqual(
    expect.objectContaining({ kind: 'perfect-relay', text: expect.stringContaining('RELAIS PARFAIT') })
  );
  expect(await lines(page)).toContainEqual(expect.stringContaining('RELAIS PARFAIT'));
});

test('Burning powers Venom Harvest without consuming a Combo setup', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['thornox', 'nymbloom', 'riptalon'],
    reducedMotion: false,
    battleSpeed: 2,
  });
  await page.goto('/?seed=1');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('#quick-rule').selectOption('starstorm');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(controls(page, '[data-move="toxic_spines"]')).toBeVisible({ timeout: 8000 });
  await page.locator('[data-move="toxic_spines"]').click();
  await expect(controls(page, '[data-move="venom_harvest"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-move="venom_harvest"] .move-combo-badge')).toHaveCount(0);
  await page.locator('[data-move="venom_harvest"]').click();
  await controlsBack(page);
  const log = await openLog(page);
  await expect(log.locator('li.log-enemy').filter({ hasText: /Combo/i })).toHaveCount(0);
});

test('battle codex explains live rules and closes with Escape', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=12&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  const codex = await openCodex(page);
  await expect(codex.getByText('Météo de l’arène')).toBeVisible();
  await expect(codex.getByText('Triangles de types')).toBeVisible();
  await expect(codex.getByText(/Eau → Feu → Plante → Eau/)).toBeVisible();
  await expect(codex.getByText(/entre triangles : ×1/)).toBeVisible();
  await expect(page.locator('.trainer-command-codex')).toContainText('Coup de pouce');
  await expect(codex.getByText(/Une attaque donne 20 Éclat/)).toBeVisible();
  await expect(page.locator('.flow-codex, .contract-codex, .resonance-codex')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(codex).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('versus intro stays focused on the teams and arena', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/?seed=32');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('#fx-text > .fx-banner[data-kind="intro"]')).toBeVisible();
  await expect(page.locator('.intro-contract')).toHaveCount(0);
  // The intro hands the controls back within its 2 s budget.
  await controlsBack(page, 4000);
  await expect(page.locator('#fx-text > .fx-banner[data-kind="intro"]')).toBeHidden();
});

test('battle chronicle records semantic events and opens from the keyboard', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=1025&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible();
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(controls(page, '[data-move="slowing_riddle"]')).toBeVisible();
  await page.locator('[data-move="slowing_riddle"]').click();
  await controlsBack(page);
  await page.keyboard.press('l');
  const log = page.getByRole('dialog', { name: 'Journal du combat' });
  await expect(log).toBeVisible();
  await expect(log.locator('.battle-log li')).not.toHaveCount(0);
  await expect(log.locator('.battle-log li.turn-start[data-turn="Tour 1"]')).toHaveCount(1);
  await expect(log).toContainText(/lance|perd|entre dans l’arène/);
  await expect(log).toContainText('Ton Orakyn');
  await expect(log).toContainText('Orakyn rival');
  await expect(log.locator('.battle-log li').filter({ hasText: 'Combo' })).not.toHaveCount(0);
  await closeSheets(page);
  await expect(page.locator('.battle-log')).toHaveCount(0);
});

test('flat Surge is deterministic and has no sequence UI', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=83&animations=0&enemy=kordane,calderoc,farfombre&enemyMove=resonant_focus');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  const meter = page.locator('#hud-player .plate-surge-number');
  await expect(meter).toContainText('30/100');
  await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible();
  await page.locator('[data-move="lucid_arc"]').click();
  await controlsBack(page);
  await expect(meter).toContainText(/\b50\/100\b/);
  await expect(page.locator('.flow-route, .flow-reset, .flow-chip, .flow-crescendo-call')).toHaveCount(0);
});

test('two ready signature moves trigger the split clash cut-in', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['solflare', 'lumivox', 'voltide'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  // Signature Storm fills both gauges. Kordane's Fault Charge (priority 0) fires first and
  // Solflare survives it, so Supernova (priority −2) answers in the same turn: a real clash.
  await page.goto(
    '/?seed=61&player=solflare,lumivox,voltide&enemy=kordane,calderoc,farfombre&enemyMove=fault_charge'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('#quick-rule').selectOption('starstorm');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(controls(page, '[data-move="supernova"]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#hud-player .team-dot.signature-ready')).toHaveCount(3);
  await expect(page.locator('#hud-enemy .team-dot.signature-ready')).toHaveCount(3);
  await recordBanners(page);
  await page.locator('[data-move="supernova"]').click();
  await expect
    .poll(() => banners(page), { timeout: 4000 })
    .toContainEqual(expect.objectContaining({ kind: 'clash', text: expect.stringContaining('VS') }));
});

test('a switched teammate converts a setup with a Combo tag crediting the helper', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['orakyn', 'pyrolynx', 'abyssar'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto(
    '/?seed=68&player=orakyn,pyrolynx,abyssar&enemy=monolith,kordane,brontusk&enemyMove=gravity_fist,gravity_fist,gravity_fist'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('#quick-rule').selectOption('starstorm');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible({ timeout: 8000 });
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled({ timeout: 8000 });
  await page.locator('[data-action="open-switch"]').click();
  await page.locator('[data-switch-index]').filter({ hasText: 'Pyrolynx' }).click();
  await expect(controls(page, '[data-move="ninefold_inferno"]')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-move="ninefold_inferno"] .move-combo-badge')).toBeVisible();
  await recordReadouts(page);
  await page.locator('[data-move="ninefold_inferno"]').click();
  await expect
    .poll(() => readouts(page), { timeout: 6000 })
    .toContainEqual(
      expect.objectContaining({
        type: 'number',
        side: 'enemy',
        tags: expect.stringMatching(/COMBO ×1,3.*Orakyn/),
      })
    );
});

test.describe('touch controls', () => {
  test.use({ hasTouch: true });
  test('tablet touch-sized controls remain usable', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await installCompletedTutorial(page);
    await page.goto('/?seed=3&animations=0');
    await page.getByRole('button', { name: /Combat rapide/ }).tap();
    const card = page.locator('[data-creature="orakyn"]');
    const box = await card.boundingBox();
    expect(box.width).toBeGreaterThan(44);
    expect(box.height).toBeGreaterThan(44);
    await page.getByRole('button', { name: /Entrer dans/ }).tap();
    const move = page.locator('[data-move]').first();
    const moveBox = await move.boundingBox();
    expect(moveBox.height).toBeGreaterThanOrEqual(44);
    await move.tap();
    await expect(page.getByText('Tour 2')).toBeVisible();
  });
});

test('knockout opens a free replacement selector before the next choice', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=12&animations=0&playerHp=1');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await page.locator('[data-move]').first().click();
  await expect(page.getByRole('heading', { name: /Choisis une relève/ })).toBeVisible();
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-phase', 'fainted');
  const replacement = page.locator('[data-switch-index]').first();
  await replacement.click();
  await expect(page.locator('#action-line')).toContainText(/entre en jeu|À toi/);
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-phase', 'idle');
});

test('a voluntary switch recalls the outgoing creature before the replacement lands', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/?seed=31');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  const fighter = page.locator('#fighter-player');
  const outgoingId = await fighter.getAttribute('data-creature');
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled({ timeout: 8000 });
  await page.locator('[data-action="open-switch"]').click();
  await page.locator('[data-switch-index]:enabled').first().click();
  await expect(fighter).toHaveAttribute('data-phase', 'recall');
  await expect(fighter).not.toHaveAttribute('data-creature', outgoingId);
  await expect(fighter).toHaveAttribute('data-phase', 'idle');
});

test('a defeat produces evidence-based trainer analysis', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=22&animations=0&teamHp=1');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await playVisibleBattle(page);
  await expect(page.getByRole('heading', { name: 'Belle bataille !' })).toBeVisible();
  await expect(page.locator('.battle-advice')).toBeVisible();
  await expect(page.locator('.battle-advice')).toContainText('Conseils de l’entraîneur');
  await expect(page.locator('.recap-mvp')).toHaveCount(1);
  const recapBox = await page.locator('.battle-recap').boundingBox();
  const statsBox = await page.locator('.recap-stats').boundingBox();
  expect(recapBox).not.toBeNull();
  expect(statsBox).not.toBeNull();
  await page.getByRole('button', { name: /Ajuster l’équipe/ }).click();
  await expect(page.getByRole('heading', { name: 'Compose ton équipe' })).toBeVisible();
  await expect(page.locator('.enemy-list')).toContainText('Orakyn');
  await expect(page.locator('.contract-preview, [data-doctrine], .team-bonds')).toHaveCount(0);
});
