import { test, expect } from '@playwright/test';
import { HURRY_RATE } from '../src/battle-ui/fx-clock.js';
import {
  arenaReady,
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

// Free-battle options (difficulty, rival, arena, rule) live in a sheet opened from the rival card;
// Escape closes it back to team select.
async function chooseQuickRule(page, rule) {
  await page.locator('[data-action="open-options"]').click();
  await page.locator(`[data-rule-pick="${rule}"]`).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet')).toHaveCount(0);
}

// The dock stays mounted with enabled buttons while a turn plays (it only fades out), so "the
// controls are back" means the battle screen has unlocked.
function controls(page, selector = '[data-move]:enabled') {
  return page.locator(`.battle-screen:not(.locked) ${selector}`);
}

async function controlsBack(page, timeout = 10000) {
  await expect(controls(page).first()).toBeVisible({ timeout });
}

// The clock ms the turn played from a click on `locator` until the dock unlocks: the session
// clock's `pacedMs` (§4), its running time with work pending plus each hit-stop's scheduled length.
// That is the turn's length at any steady frame rate: wall time under parallel SwiftShader (50-100
// ms frames, stalls, a frame past every hit-stop's end) measures the machine instead. `hold`
// presses the stage before the move is picked, so the whole turn plays hurried (§6.5).
async function turnMs(page, locator, { hold = false } = {}) {
  await page.evaluate(async () => {
    const { ctx } = await import('/src/app/context.js');
    const screen = document.querySelector('.battle-screen');
    window.__turn = null;
    const start = () => {
      const clock = ctx.battleSession.clock,
        from = clock.pacedMs;
      let seenLock = false;
      const observer = new MutationObserver(() => {
        const locked = screen.classList.contains('locked');
        seenLock ||= locked;
        if (!seenLock || locked) return;
        observer.disconnect();
        window.__turn = clock.pacedMs - from;
      });
      observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
    };
    document.addEventListener('click', start, { capture: true, once: true });
  });
  if (hold) {
    const stage = await page.locator('.battle-stage').boundingBox();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height * 0.6);
    await page.mouse.down();
    await locator.dispatchEvent('click');
  } else await locator.click();
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

// The first-run tutorial (GAME-04): four lessons, one decision each, in the order a monster-battle
// player expects; the targeted tile is the only playable one and the lesson rides the prompt line.
test('first-run tutorial teaches super effective, switching and the Signature in 4 decisions', async ({
  page,
}) => {
  test.setTimeout(90000);
  const runtime = watchRuntime(page);
  await page.goto('/?seed=4242&animations=0');
  await page.locator('[data-action="play"]').first().click();
  const lesson = page.locator('.battle-screen:not(.locked) .prompt-lesson');
  // The first battle also loads and compiles the arena (slow on a cold SwiftShader worker).
  await expect(lesson).toContainText(/Psy bat Combat.*super efficace/, { timeout: 15000 });
  await expect(page.locator('.tutorial-target')).toHaveCount(1);
  await expect(page.locator('[data-move="lucid_arc"].tutorial-target')).toBeEnabled();
  await expect(page.locator('[data-move="lucid_arc"] .move-effectiveness')).toHaveText('Super efficace');
  await expect(page.locator('[data-move="slowing_riddle"]')).toBeDisabled();
  await expect(page.locator('[data-action="open-switch"]')).toBeDisabled();
  await page.locator('[data-move="lucid_arc"]').click();
  // Kordane falls; the rival sends Calderoc and announces its Fire Signature.
  await expect(lesson).toContainText(/Change pour Abyssar.*l’Eau résiste au Feu/);
  await expect(page.locator('#fighter-enemy')).toHaveAttribute('data-creature', 'calderoc');
  await expect(page.locator('.intent-read')).toContainText('Signature');
  await expect(page.locator('[data-move]:enabled')).toHaveCount(0);
  await page.locator('[data-action="open-switch"].tutorial-target').click();
  await page.locator('[data-switch-index]').filter({ hasText: 'Abyssar' }).click();
  // The gauge is full only now, for the Signature lesson; the K.O. waits for the last lesson.
  await expect(lesson).toContainText(/jauge Signature ✦ est pleine.*Bastion nacré/);
  await expect(page.locator('#hud-player .plate-surge-number')).toContainText('100/100');
  await expect(page.locator('[data-move="abyssal_surge"]')).toBeDisabled();
  await expect(page.locator('.move-effectiveness.lethal')).toHaveCount(0);
  await page.locator('[data-move="shell_bastion"].tutorial-target').click();
  await expect(lesson).toContainText(/L’Eau bat le Feu.*achève Calderoc/);
  await expect(page.locator('[data-move="abyssal_surge"] .move-effectiveness.lethal')).toBeVisible();
  await page.locator('[data-move="abyssal_surge"].tutorial-target').click();
  // The tutorial is won like any battle: its results lead on to team select, which greets the new
  // player once.
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'results', { timeout: 15000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.tutorialComplete).toBe(true);
  await page.locator('[data-action="pick-team"]').click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'selection');
  await expect(page.locator('.ts-guide')).toBeVisible();
  await expectNoRuntimeLeaks(runtime);
});

test('the tutorial can be skipped from the prompt line', async ({ page }) => {
  await page.goto('/?seed=4242&animations=0');
  await page.locator('[data-action="play"]').first().click();
  const skip = page.locator('.battle-screen:not(.locked) [data-action="skip-tutorial"]');
  // Skipping asks first: cancelling keeps the lesson going.
  await skip.click({ timeout: 15000 });
  await page.locator('[data-action="skip-cancel"]').click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'battle');
  await skip.click();
  await page.locator('[data-action="skip-confirm"]').click();
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'selection');
  await expect(page.locator('.ts-guide')).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));
  expect(saved.tutorialComplete).toBe(true);
});

test('reduced-motion tutorial outro is presented before its results', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/?seed=4242');
  await page.locator('[data-action="settings"]').click();
  await page.locator('#motion').check();
  await page.locator('[data-action="back"]').first().click();
  await page.locator('[data-action="play"]').first().click();
  await page.evaluate(() => {
    window.__tutorialOutroSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.battle-outro')) window.__tutorialOutroSeen = true;
    }).observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  const target = controls(page, '.tutorial-target');
  // The first battle also loads and compiles the arena (slow on a cold SwiftShader worker).
  for (let decision = 0; decision < 4; decision++) {
    await expect(target).toBeEnabled({ timeout: 15000 });
    const opensSwitch = (await target.getAttribute('data-action')) === 'open-switch';
    await target.click();
    if (opensSwitch) await page.locator('[data-switch-index]').filter({ hasText: 'Abyssar' }).click();
  }
  await expect(page.locator('#screen')).toHaveAttribute('data-page', 'results', { timeout: 20000 });
  expect(await page.evaluate(() => window.__tutorialOutroSeen)).toBe(true);
});

test('configures a team and finishes a seeded full quick battle', async ({ page }) => {
  const runtime = watchRuntime(page);
  await installCompletedTutorial(page);
  await page.goto('/?seed=88&animations=0&player=calderoc,kordane,farfombre&enemy=virelia,orakyn,abyssar');
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="open-options"]').click();
  await page.locator('[data-difficulty="champion"]').click();
  await page.locator('[data-arena-pick="eclipse"]').click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
  await expect(page.locator('#contract-chip, .flow-chip, .arena-resonance')).toHaveCount(0);
  // Champion hides the rival's plan; the chosen arena is the one fought in.
  await expect(controls(page).first()).toBeVisible();
  await expect(page.locator('.intent-read')).toHaveCount(0);
  await openPause(page);
  await expect(page.locator('.pause-context')).toContainText('Couronne d’éclipse');
  await closeSheets(page);
  await page.locator('[data-move]:enabled').first().click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  // ?animations=0 is the readout-only path: no stage text, no banners.
  await expect(page.locator('#fx-text > *')).toHaveCount(0);
  await playVisibleBattle(page);
  const resultHeading = page.getByRole('heading', { name: /Victoire|Belle bataille/ });
  await expect(resultHeading).toBeVisible();
  const victory = (await resultHeading.textContent()).includes('Victoire');
  // Defeat stays friendly: the rank stamp only lands on a victory.
  await expect(page.locator('.rs-stamp')).toHaveCount(victory ? 1 : 0);
  await expect(page.locator('.rs-row')).toHaveCount(3);
  await expect(page.locator('.rs-row .rs-pic img')).toHaveCount(3);
  // Fallen creatures are dimmed on purpose; the survivors show at full opacity.
  for (const opacity of await page
    .locator('.rs-row:not(.is-fallen) .rs-pic img')
    .evaluateAll((images) => images.map((image) => getComputedStyle(image).opacity)))
    expect(opacity).toBe('1');
  // Stats, MVP, trio report and grade live in the recap sheet.
  await page.locator('[data-action="result-recap"]').click();
  await expect(page.getByRole('dialog', { name: 'Récap du combat' })).toBeVisible();
  // The creature of the match is one of the player's trio.
  await expect(page.locator('.rs-mvp')).toContainText(/Calderoc|Kordane|Farfombre/);
  // The recap lists only non-zero totals, and those totals agree with the trio report.
  const recapStats = await page
    .locator('.rs-stats > span')
    .evaluateAll((spans) =>
      spans.map((span) => [
        span.querySelector('small').textContent,
        Number(span.querySelector('b').textContent),
      ])
    );
  for (const [, value] of recapStats) expect(value).toBeGreaterThan(0);
  // A trio column and its recap total share one label (e.g. damage dealt).
  const teamStat = (stat) => page.locator(`.rs-trio article dl > div[data-stat="${stat}"]`),
    teamTotal = (stat) =>
      teamStat(stat)
        .locator('dd')
        .evaluateAll((cells) => cells.reduce((sum, cell) => sum + Number(cell.textContent), 0));
  const dealt = await teamTotal('damage'),
    combos = await teamTotal('combos');
  expect(dealt).toBeGreaterThan(0);
  const recap = Object.fromEntries(recapStats);
  expect(recap[await teamStat('damage').locator('dt').first().textContent()]).toBe(dealt);
  if (combos > 0) expect(recap[await teamStat('combos').locator('dt').first().textContent()]).toBe(combos);
  if (victory) {
    // The grade adds up its victory, tempo and survival bonuses.
    await expect(page.locator('.rs-grade .rs-grade-part')).toHaveCount(3);
    for (const part of await page.locator('.rs-grade .rs-grade-part b').allTextContents())
      expect(part).toMatch(/^\+\d+$/);
  }
  await expect(page.locator('.rs-trio article')).toHaveCount(3);
  await expect(teamStat('actions')).toHaveCount(3);
  await page.locator('[data-action="result-log"]').click();
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
  // Lucid Arc leaves Kordane at 2 HP: a K.O. beat would wait on the replacement's sprite decode,
  // real time the clock does not pace, so the measured turn has none.
  const query = '/?seed=18&enemyHp=70&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre';
  await installCompletedTutorial(page, {
    reducedMotion: false,
    battleSpeed: 1,
    lastTeam: ['orakyn', 'abyssar', 'virelia'],
  });
  const enter = async () => {
    await page.goto(query);
    await page.locator('[data-action="quick"]').click();
    await page.getByRole('button', { name: /^Combattre/ }).click();
    await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible({ timeout: 8000 });
  };
  const arc = page.locator('[data-move="lucid_arc"]');
  await enter();
  const normal = await turnMs(page, arc);
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('arene-de-noam-save'));
    localStorage.setItem('arene-de-noam-save', JSON.stringify({ ...save, battleSpeed: 2 }));
  });
  await enter();
  const fast = await turnMs(page, arc);
  // About half: floors never compress at ×2 (§4). The lower bound proves the turn played in full.
  expect(fast).toBeLessThan(normal * 0.7);
  expect(fast).toBeGreaterThan(normal * 0.4);
  await playVisibleBattle(page, { maxIterations: 3000 });
  await expect(page.getByRole('heading', { name: /Victoire|Belle bataille/ })).toBeVisible();
  await page.locator('[data-action="rematch"]').click();
  await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible({ timeout: 8000 });
  const rematch = await turnMs(page, arc);
  expect(rematch).toBeLessThan(normal * 0.7);
  expect(rematch).toBeGreaterThan(normal * 0.4);
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
    await page.locator('[data-action="quick"]').click();
    await page.getByRole('button', { name: /^Combattre/ }).click();
    await expect(controls(page, '[data-move="echo_chorus"]')).toBeVisible({ timeout: 8000 });
  };
  const chorus = page.locator('[data-move="echo_chorus"]');
  await enter();
  const normal = await turnMs(page, chorus);
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
  const held = await turnMs(page, chorus, { hold: true });
  // About a third: everything, floors included, runs HURRY_RATE× faster (§6.5).
  expect(held).toBeLessThan(normal * 0.6);
  expect(held).toBeGreaterThan(normal / (HURRY_RATE + 1));
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
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="open-options"]').click();
  await expect(page.locator('[data-rule-pick]')).toHaveCount(6);
  // The note under the rule explains the one picked.
  const note = page.locator('.ts-rule-note');
  await page.locator('[data-rule-pick="relay_rush"]').click();
  await expect(note).toContainText('+24 ✦');
  await page.locator('[data-rule-pick="fortress_duel"]').click();
  await expect(note).toContainText('barrière');
  await page.keyboard.press('Escape');
  // Back on team select, the rival card keeps the chosen rule in sight.
  await expect(page.locator('.ts-rival')).toContainText('Duel des forteresses');
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
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
  await page.locator('[data-action="quick"]').click();
  await chooseQuickRule(page, 'relay_rush');
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled({ timeout: 8000 });
  await recordBanners(page);
  await page.locator('[data-action="open-switch"]').click();
  await expect(page.locator('.switch-bonus')).toContainText('+24 ✦');
  await page.locator('[data-switch-index]').first().click();
  await controlsBack(page);
  expect(await banners(page)).toContainEqual(
    expect.objectContaining({ kind: 'switch-in', side: 'player', text: expect.stringContaining('+24 ✦') })
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
  // With the League won, JOUER heads for the Circuit, and the team button telegraphs its rule.
  const play = page.getByRole('button', { name: /Circuit des champions/ });
  await expect(play).toBeVisible();
  await page.locator('[data-action="team"]').click();
  await expect(page.locator('.ts-rival')).toContainText('Orage de Signatures');
  await page.locator('[data-action="open-rival"]').click();
  await expect(page.locator('.rival-condition')).toContainText('Orage de Signatures');
  await expect(page.locator('.rival-condition')).toContainText('Signatures ✦ sont prêtes');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="back"]').click();
  await play.click();
  await arenaReady(page);
  await expect(page.locator('#hud-player .surge-row')).toContainText('100/100');
  await openCodex(page);
  await expect(page.locator('.circuit-codex')).toContainText('Orage de Signatures');
});

test('move choices expose distinct damage and support tiles with a readable forecast', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=14&animations=0');
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
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
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
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
    plain = shownLines.findIndex((line) => /Arc lucide\s*[.!]?\s*$/.test(line)),
    stressed = shownLines.findIndex((line) => /Arc lucide.*Super efficace/.test(line));
  expect(plain).toBeGreaterThanOrEqual(0);
  expect(stressed).toBeGreaterThan(plain);
});

test('multi-hit techniques count every hit in words under the running total', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['lumivox', 'orakyn', 'virelia'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto('/?seed=24&player=lumivox,orakyn,virelia&enemy=kordane,calderoc,farfombre');
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await expect(controls(page, '[data-move="echo_chorus"]')).toBeVisible({ timeout: 8000 });
  // The count rides under the target's number ("−31" over "3 coups"), never as a "×3" multiplier.
  await page.evaluate(() => {
    window.__chain = [];
    const layer = document.querySelector('#fx-text');
    new MutationObserver(() => {
      const node = layer.querySelector('.fx-number[data-side="enemy"] .fx-hits:not([hidden])');
      const text = node?.textContent.trim();
      if (text && window.__chain.at(-1) !== text) window.__chain.push(text);
    }).observe(layer, { childList: true, subtree: true, characterData: true, attributes: true });
  });
  await page.locator('[data-move="echo_chorus"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__chain), { timeout: 6000 })
    .toEqual(['1 coup', '2 coups', '3 coups']);
});

test('Coach cleanses penalties, grants 15 Surge, costs no action, and is once per battle', async ({
  page,
}) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto(
    '/?seed=14&player=kordane,abyssar,virelia&enemy=orakyn,calderoc,farfombre&enemyMove=slowing_riddle'
  );
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
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
  // Épreuves open at 4 League badges (GAME-11) and live in the Défis sheet.
  await installCompletedTutorial(page, {
    lastTeam: ['nymbloom', 'abyssar', 'virelia'],
    ladderVictories: 4,
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto('/?seed=61&enemyMove=supernova');
  await page.locator('[data-action="challenges"]').click();
  await page.locator('[data-action="trials"]').click();
  await page.locator('[data-trial-select="4"]').click();
  await page.locator('[data-action="trial-4"]').click();
  await expect(page.getByRole('heading', { name: 'La Dernière Lueur' })).toBeVisible();
  await page.getByRole('button', { name: /^Combattre/ }).click();
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
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
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
  await page.locator('[data-action="quick"]').click();
  await expect(page.locator('[data-doctrine], #contract-select, .contract-preview, .team-bonds')).toHaveCount(
    0
  );
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await expect(page.locator('.intro-contract, #contract-chip, .flow-chip, .arena-resonance')).toHaveCount(0);
  await openCodex(page);
  await expect(page.locator('.contract-codex, .flow-codex, .resonance-codex')).toHaveCount(0);
});

test('Eclipse of Grace purges the rival team after its aimed transaction', async ({ page }) => {
  await installCompletedTutorial(page);
  // Aubéastre's Kindred Halo (priority +1) makes its whole trio Concentré first; the slower
  // Eclipse then lands on Aubéastre and purges the bench as well.
  await page.goto(
    '/?seed=814201&animations=0&player=deuilastre,orakyn,kordane&enemy=aubeastre,virelia,pactigon&enemyMove=kindred_halo'
  );
  await page.locator('[data-action="quick"]').click();
  await chooseQuickRule(page, 'starstorm');
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
  await expect(controls(page, '[data-move="eclipse_of_grace"]')).toBeVisible();
  await page.locator('[data-move="eclipse_of_grace"]').click();
  await controlsBack(page);
  const log = await openLog(page);
  const entries = log.locator('.battle-log li');
  await expect(entries.filter({ hasText: 'Éclipse des grâces' })).toHaveCount(1);
  // Journal sentences name each creature with its side ("Virelia rival perd …").
  for (const benched of ['Virelia', 'Pactigon'])
    await expect(entries.filter({ hasText: new RegExp(`${benched} rival perd .*Concentré`) })).toHaveCount(1);
});

test('Immaculate Relay reuses the selector and switches only after the aimed attack', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto(
    '/?seed=814202&animations=0&player=aubeastre,deuilastre,pactigon&enemy=orakyn,kordane,virelia&enemyMove=lucid_arc'
  );
  await page.locator('[data-action="quick"]').click();
  await chooseQuickRule(page, 'starstorm');
  await page.getByRole('button', { name: /^Combattre/ }).click();
  const relay = page.locator('[data-move="immaculate_relay"]');
  await relay.click();
  await expect(page.getByRole('heading', { name: /Qui entre après les attaques/ })).toBeVisible();
  await expect(page.locator('.signature-relay [data-switch-index]')).toHaveCount(2);
  await expect(page.locator('.signature-relay .switch-incoming')).toHaveText([
    /Aucun dégât.*sans malus.*Concentré/,
    /Aucun dégât.*sans malus.*Concentré/,
  ]);
  await page.getByRole('button', { name: 'Annuler' }).click();
  await expect(relay).toBeFocused();
  await relay.click();
  await page.locator('.signature-relay [data-switch-index="1"]').click();
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-creature', 'deuilastre');
  await controlsBack(page);
  const log = await openLog(page);
  await expect(log).toContainText('Arc lucide');
  await expect(log).toContainText(/Deuilastre entre sans malus et Concentré/);
});

test('ladder rivals telegraph and trigger their unique ace phase', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=18&animations=0&enemyHp=1');
  // The hub's team button opens the League team select, whose rival sheet telegraphs the ace.
  await page.locator('[data-action="team"]').click();
  await page.locator('[data-action="open-rival"]').click();
  await expect(page.locator('.rival-ace')).toContainText('Nouveau souffle');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
  // Every rival starts at 1 HP. Arc 1 K.O.s the lead; the rival's Virelia heals itself before
  // arc 2 lands; arc 3 K.O.s it, and the last rival standing triggers the ace.
  for (let arc = 0; arc < 3; arc++) {
    await expect(controls(page, '[data-move="lucid_arc"]')).toBeVisible();
    await page.locator('[data-move="lucid_arc"]').click();
  }
  await controlsBack(page);
  await openCodex(page);
  await expect(page.locator('.ace-codex.triggered')).toContainText('Nouveau souffle');
});

test('keyboard numbers choose moves and C opens switching', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=12&animations=0');
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
  await expect(page.getByText('Tour 1')).toBeVisible();
  await expect(page.locator('.intent-read')).toBeVisible();
  await expect(page.locator('.intent-read')).not.toContainText('Illisible');
  await page.keyboard.press('1');
  await expect(page.getByText('Tour 2')).toBeVisible();
  await controlsBack(page);
  await page.keyboard.press('c');
  await expect(page.getByRole('heading', { name: /Qui entre/ })).toBeVisible();
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
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
  await expect(page.locator('.intent-read')).toContainText('Frappe cristal');
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled({ timeout: 8000 });
  await recordBanners(page);
  await recordLines(page);
  await page.keyboard.press('c');
  const relay = page.locator('.switch-option.perfect-read');
  await expect(relay).toHaveCount(1);
  await expect(relay).toContainText(/Bon changement\s*!\s*\+6 ✦/);
  await relay.click();
  await controlsBack(page);
  expect(await banners(page)).toContainEqual(
    expect.objectContaining({ kind: 'perfect-relay', text: expect.stringMatching(/bon changement/i) })
  );
  expect(await lines(page)).toContainEqual(expect.stringMatching(/bon changement/i));
});

test('Burning powers Venom Harvest without consuming a Combo setup', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['thornox', 'nymbloom', 'riptalon'],
    reducedMotion: false,
    battleSpeed: 2,
  });
  await page.goto('/?seed=1');
  await page.locator('[data-action="quick"]').click();
  await chooseQuickRule(page, 'starstorm');
  await page.getByRole('button', { name: /^Combattre/ }).click();
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
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  const codex = await openCodex(page);
  await expect(codex.getByText('Météo de l’arène')).toBeVisible();
  // The type-triangle reminder gives both cycles and all three multipliers.
  const triangles = codex.locator('.affinity-reminder');
  await expect(triangles).toContainText('Eau → Feu → Plante → Eau');
  await expect(triangles).toContainText('Psy → Combat → Ténèbres → Psy');
  for (const multiplier of ['×2', '×0,5', '×1']) await expect(triangles).toContainText(multiplier);
  await expect(page.locator('.trainer-command-codex')).toContainText('Coup de pouce');
  await expect(codex.getByText(/remplit ta jauge Signature ✦/)).toBeVisible();
  await expect(page.locator('.flow-codex, .contract-codex, .resonance-codex')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(codex).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('versus intro stays focused on the teams and arena', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/?seed=32');
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
  await expect(page.locator('#fx-text > .fx-banner[data-kind="intro"]')).toBeVisible();
  await expect(page.locator('.intro-contract')).toHaveCount(0);
  // The intro hands the controls back within its 2 s budget.
  await controlsBack(page, 4000);
  await expect(page.locator('#fx-text > .fx-banner[data-kind="intro"]')).toBeHidden();
});

test('battle chronicle records semantic events and opens from the keyboard', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=1025&animations=0');
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
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
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
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
  await page.locator('[data-action="quick"]').click();
  await chooseQuickRule(page, 'starstorm');
  await page.getByRole('button', { name: /^Combattre/ }).click();
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
  await page.locator('[data-action="quick"]').click();
  await chooseQuickRule(page, 'starstorm');
  await page.getByRole('button', { name: /^Combattre/ }).click();
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
    await page.locator('[data-action="quick"]').tap();
    const card = page.locator('[data-creature="orakyn"]');
    const box = await card.boundingBox();
    expect(box.width).toBeGreaterThan(44);
    expect(box.height).toBeGreaterThan(44);
    await page.getByRole('button', { name: /^Combattre/ }).tap();
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
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await page.locator('[data-move]').first().click();
  await expect(page.getByRole('heading', { name: /Qui prend le relais/ })).toBeVisible();
  const fighter = page.locator('#fighter-player');
  await expect(fighter).toHaveAttribute('data-phase', 'fainted');
  const fallen = await fighter.getAttribute('data-creature');
  // Under ?animations=0 the entry line shows for an instant before the next prompt (here the
  // Marqué tip) replaces it: record the narration instead of polling it.
  await recordLines(page);
  await page.locator('[data-switch-index]').first().click();
  await expect(fighter).not.toHaveAttribute('data-creature', fallen);
  await expect(fighter).toHaveAttribute('data-phase', 'idle');
  await controlsBack(page);
  const incoming = await fighter.locator('img').getAttribute('alt');
  expect(await lines(page)).toContainEqual(expect.stringMatching(new RegExp(`${incoming} entre en jeu`)));
});

test('a voluntary switch recalls the outgoing creature before the replacement lands', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/?seed=31');
  await page.locator('[data-action="quick"]').click();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
  const fighter = page.locator('#fighter-player');
  const outgoingId = await fighter.getAttribute('data-creature');
  await expect(controls(page, '[data-action="open-switch"]')).toBeEnabled({ timeout: 8000 });
  // The recall lasts 180 clock ms, shorter than expect's polling steps: record every phase the
  // player's fighter goes through instead of polling for it.
  await page.evaluate(() => {
    const states = (window.__fighterStates = []),
      record = () => {
        const node = document.querySelector('#fighter-player'),
          state = node && { phase: node.dataset.phase, creature: node.dataset.creature };
        const last = states.at(-1);
        if (state && (last?.phase !== state.phase || last?.creature !== state.creature)) states.push(state);
      };
    record();
    new MutationObserver(record).observe(document.querySelector('.battle-stage'), {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase', 'data-creature'],
    });
  });
  await page.locator('[data-action="open-switch"]').click();
  await page.locator('[data-switch-index]:enabled').first().click();
  await expect(fighter).not.toHaveAttribute('data-creature', outgoingId);
  await expect(fighter).toHaveAttribute('data-phase', 'idle');
  const states = await page.evaluate(() => window.__fighterStates),
    recalled = states.findIndex(({ phase }) => phase === 'recall'),
    replaced = states.findIndex(({ creature }) => creature !== outgoingId);
  expect(states[recalled]).toEqual({ phase: 'recall', creature: outgoingId });
  expect(recalled).toBeLessThan(replaced);
});

test('a defeat produces evidence-based trainer analysis', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=22&animations=0&teamHp=1');
  await page.locator('[data-action="quick"]').click();
  const foes = page.locator('.ts-foe[data-foe]'),
    rivalTrio = () => foes.evaluateAll((nodes) => nodes.map((node) => node.dataset.foe));
  await expect(foes).toHaveCount(3);
  const rival = await rivalTrio();
  await page.getByRole('button', { name: /^Combattre/ }).click();
  await arenaReady(page);
  await playVisibleBattle(page);
  await expect(page.getByRole('heading', { name: /Belle bataille/ })).toBeVisible();
  // One tip on the results: the recap sheet's coaching list leads with it, next to MVP and stats.
  const tip = (await page.locator('.rs-tip b').textContent()).trim();
  expect(tip).not.toBe('');
  await page.locator('[data-action="result-recap"]').click();
  await expect(page.locator('.rs-sheet-advice p').first()).toHaveText(tip);
  await expect(page.locator('.rs-mvp')).toHaveCount(1);
  expect(await page.locator('.rs-stats').boundingBox()).not.toBeNull();
  await closeSheets(page);
  // "Adjust the team" goes back to team select against the same rival trio.
  await page.locator('[data-action="adjust-team"]').click();
  await expect(page.getByRole('heading', { name: 'Ton équipe', exact: true })).toBeVisible();
  await expect(foes).toHaveCount(3);
  expect(await rivalTrio()).toEqual(rival);
  await expect(page.locator('.contract-preview, [data-doctrine], .team-bonds')).toHaveCount(0);
});
