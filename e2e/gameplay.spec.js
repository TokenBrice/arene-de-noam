import { test, expect } from '@playwright/test';
import {
  expectNoRuntimeLeaks,
  installCompletedTutorial,
  playVisibleBattle,
  watchRuntime,
} from './helpers.js';

test('visible tutorial teaches types, Combo, Signature, and switch, then completes', async ({ page }) => {
  test.setTimeout(90000);
  const runtime = watchRuntime(page);
  await page.goto('/?seed=4242&animations=0');
  await page.getByRole('button', { name: /Jouer/ }).click();
  await expect(page.getByText(/Le type Combat est faible face au type Psy/)).toBeVisible();
  await page.evaluate(() => {
    const stage = document.getElementById('fx-stage');
    window.__fxLog = [];
    new MutationObserver(() =>
      window.__fxLog.push({ cls: stage.className, color: stage.style.getPropertyValue('--fx-color') })
    ).observe(stage, { attributes: true });
  });
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('#hud-enemy')).toContainText('Marqué');
  const markedToken = page.locator('#hud-enemy .plate-status[data-status="marked"]');
  await expect(markedToken).toHaveClass(/negative/);
  await expect(markedToken.locator('.status-icon-target-lock')).toHaveCount(1);
  await expect(markedToken).toHaveCSS('--status-color', '#AD1457');
  await expect
    .poll(() =>
      page.evaluate(() => window.__fxLog.find((entry) => entry.cls.includes('tactical-marked'))?.color)
    )
    .toBe('#AD1457');
  await expect(page.getByText(/Kordane est Marqué/)).toBeVisible();
  await page.locator('[data-move="slowing_riddle"]').click();
  await expect(page.locator('#hud-enemy')).not.toContainText('Marqué');
  await expect(page.getByText(/Éclat est plein/)).toBeVisible();
  await expect(page.locator('[data-move="oracle_veil"]')).toBeEnabled();
  await page.locator('[data-move="oracle_veil"]').click();
  await expect(page.getByText(/Calderoc est de type Feu.*Eau sont super efficaces/)).toBeVisible();
  await page.locator('[data-action="open-switch"]').click();
  await page.getByRole('button', { name: /Abyssar/ }).click();
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
  await expect(page.getByText(/Le type Combat est faible face au type Psy/)).toBeVisible();
  await page.locator('[data-move="lucid_arc"]').click();
  await page.locator('[data-move="slowing_riddle"]').click();
  await page.locator('[data-move="oracle_veil"]').click();
  await page.locator('[data-action="open-switch"]').click();
  await page.getByRole('button', { name: /Abyssar/ }).click();
  await expect(page.getByText(/À toi\. Observe les PV et termine le combat/)).toBeVisible();
  await page.evaluate(() => {
    window.__tutorialOutroSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('.battle-outro, .victory-pose')) window.__tutorialOutroSeen = true;
    }).observe(document.body, { attributes: true, childList: true, subtree: true });
  });
  await playVisibleBattle(page, { untilSelection: true });
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
  await playVisibleBattle(page);
  await expect(page.getByRole('heading', { name: /Victoire|Belle bataille/ })).toBeVisible();
  await expect(page.locator('.performance-grade')).toBeVisible();
  await expect(page.locator('.mastery-reward')).toHaveCount(3);
  await expect(page.locator('.result-team img')).toHaveCount(3);
  expect(
    await page
      .locator('.result-team img')
      .evaluateAll((images) => images.map((image) => getComputedStyle(image).opacity))
  ).toEqual(['1', '1', '1']);
  await expect(page.locator('.battle-recap')).toBeVisible();
  await expect(page.locator('.battle-recap')).toContainText('Combos');
  await expect(page.getByText('CRÉATURE DU MATCH')).toBeVisible();
  await expect(page.locator('.performance-grade .grade-detail > span')).toHaveCount(3);
  await expect(page.locator('.performance-grade')).toContainText('Victoire');
  await expect(page.locator('.performance-grade')).toContainText('Tours');
  await expect(page.locator('.performance-grade')).toContainText('Survivants');
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
  await expect(page.locator('.quick-rule-chip')).toContainText('Duel des forteresses');
  await expect(page.locator('#hud-player')).toContainText(/Barrière (18|24)/);
  await expect(page.locator('#hud-enemy')).toContainText(/Barrière (18|24)/);
  await page.getByRole('button', { name: 'Codex du combat' }).click();
  await expect(page.locator('.quick-rule-codex')).toContainText('Duel des forteresses');
});

test('Relay Rush turns a voluntary switch into immediate tempo', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/?seed=41');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByLabel('Règle du duel').selectOption('relay_rush');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.quick-rule-chip')).toContainText('Relais incandescent');
  await page.locator('[data-action="open-switch"]').click();
  await expect(page.locator('.switch-bonus')).toContainText('+24 Éclat');
  await page.locator('[data-switch-index]').first().click();
  await expect(page.locator('.relay-rush-call')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.relay-rush-call')).toContainText('+24 Éclat');
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await expect(page.locator('#hud-player')).toContainText('Accéléré');
  const hasteToken = page.locator('#hud-player .plate-status[data-status="haste"]');
  await expect(hasteToken).toHaveClass(/positive/);
  await expect(hasteToken.locator('.status-icon-wing')).toHaveCount(1);
  await expect(hasteToken).toHaveCSS('--status-color', '#C6FF00');
  await page.getByRole('button', { name: 'Codex du combat' }).click();
  await expect(page.locator('.quick-rule-codex')).toContainText('Relais incandescent');
});

test('conquering the League unlocks a rotating Champion Circuit', async ({ page }) => {
  await installCompletedTutorial(page, {
    ladderVictories: 12,
    emblems: [
      'dawn',
      'velocity',
      'wildheart',
      'resonance',
      'undertide',
      'ironwall',
      'inferno',
      'nightfall',
      'tempest',
      'colossus',
      'omen',
      'crown',
    ],
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
  await page.getByRole('button', { name: 'Codex du combat' }).click();
  await expect(page.locator('.circuit-codex')).toContainText('Orage de Signatures');
});

test('move choices expose distinct damage, support, and archetype silhouettes', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=14&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.move-btn.kind-damage')).toHaveCount(2);
  await expect(page.locator('.move-btn.kind-support')).toHaveCount(1);
  await expect(page.locator('.move-archetype')).toHaveCount(3);
  await expect(page.locator('[data-move="oracle_veil"] .move-archetype')).toHaveText('☄');
  await expect(page.locator('[data-move="oracle_veil"]')).toBeDisabled();
  await expect(page.locator('.exchange-preview')).toHaveCount(2);
  await expect(page.locator('.exchange-preview').first()).toContainText('Toi');
  await expect(page.locator('.team-dot img')).toHaveCount(6);
  await expect(page.locator('#hud-player .team-dot.active')).toHaveCount(1);
  await expect(page.locator('#hud-enemy .team-dot.active')).toHaveCount(1);
});

test('affinity advantage lands with a dedicated impact callout', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['orakyn', 'abyssar', 'virelia'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto('/?seed=14&player=orakyn,abyssar,virelia&enemy=kordane,calderoc,farfombre');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('[data-move="lucid_arc"]')).toBeEnabled({ timeout: 5000 });
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('.affinity-callout.effective')).toContainText(/efficace/i);
  await expect(page.locator('#action-line')).toContainText(/efficace/i);
});

test('multi-hit techniques escalate through a visible hit chain', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['lumivox', 'orakyn', 'virelia'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto('/?seed=24&player=lumivox,orakyn,virelia&enemy=kordane,calderoc,farfombre');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('[data-move="echo_chorus"]')).toBeEnabled({ timeout: 5000 });
  await page.locator('[data-move="echo_chorus"]').click();
  await expect(page.locator('.hit-chain')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.hit-chain')).toHaveAttribute('data-hit', /1|2|3/);
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
  const command = page.getByRole('button', { name: 'Ordre du dresseur' });
  await expect(command).toBeDisabled();
  await page.locator('[data-move="crystal_strike"]').click();
  await expect(page.locator('#hud-player')).toContainText('Sonné', { timeout: 5000 });
  const stunnedToken = page.locator('#hud-player .plate-status[data-status="stunned"]');
  await expect(stunnedToken).toHaveClass(/negative/);
  await expect(stunnedToken.locator('.status-icon-dizzy-stars')).toHaveCount(1);
  await expect(stunnedToken).toHaveCSS('--status-color', '#FFEA70');
  await expect(command).toBeEnabled({ timeout: 5000 });
  const before = Number(
    (await page.locator('#hud-player .plate-surge-number').textContent()).match(/\d+/)[0]
  );
  await command.click();
  await expect(page.locator('.trainer-command-fx')).toBeVisible();
  await expect(page.locator('.trainer-command-fx')).toContainText('Coup de pouce');
  await expect(command).toBeDisabled({ timeout: 5000 });
  await expect(page.locator('#hud-player')).not.toContainText('Sonné');
  const after = Number((await page.locator('#hud-player .plate-surge-number').textContent()).match(/\d+/)[0]);
  expect(after - before).toBe(15);
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await page.getByRole('button', { name: 'Codex du combat' }).click();
  await expect(page.locator('.trainer-command-codex.used')).toContainText('Ordre donné');
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
  await page.locator('[data-move="bubble_burst"]').click();
  await expect(page.locator('[data-move="healing_rain"]')).toBeEnabled({ timeout: 5000 });
  await page.locator('[data-move="healing_rain"]').click();
  await expect(page.locator('.tactical-heal .tactical-number')).toContainText(/^\+\d+$/);
});

test('reaching full Surge triggers a creature-specific Signature-ready cut-in', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto(
    '/?seed=14&player=solflare,abyssar,virelia&enemy=kordane,calderoc,farfombre&enemyMove=resonant_focus'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  for (let action = 0; action < 3; action++) {
    await expect(page.locator('[data-move="sun_spear"]')).toBeEnabled({ timeout: 5000 });
    await page.locator('[data-move="sun_spear"]').click();
  }
  await expect(page.locator('.signature-ready-call.player')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.signature-ready-call.player')).toContainText('Supernova');
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
  await page.getByRole('button', { name: 'Codex du combat' }).click();
  await expect(page.locator('.contract-codex, .flow-codex, .resonance-codex')).toHaveCount(0);
});

test('roster cards scout favorable targets and threats in the revealed rival trio', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?enemy=kordane,calderoc,virelia');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await expect(page.locator('.scout-read')).toHaveCount(30);
  await expect(page.locator('[data-creature="abyssar"] .scout-read')).toContainText('1 cibles favorables');
  await expect(page.locator('[data-creature="abyssar"] .scout-read')).toContainText('1 menaces');
  await expect(page.locator('.creature-card.scout-strong')).not.toHaveCount(0);
});

test('Eclipse of Grace purges the rival team after its aimed transaction', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto(
    '/?seed=814201&animations=0&player=deuilastre,orakyn,kordane&enemy=aubeastre,virelia,pactigon&enemyMove=kindred_halo'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('#quick-rule').selectOption('starstorm');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('[data-move="eclipse_of_grace"]')).toBeEnabled();
  await page.locator('[data-move="eclipse_of_grace"]').click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await expect(page.locator('[data-action="battle-log"]')).toBeEnabled();
  await page.locator('[data-action="battle-log"]').click();
  await expect(page.getByRole('dialog', { name: 'Journal du combat' })).toContainText('Éclipse des grâces');
  await expect(page.getByRole('dialog', { name: 'Journal du combat' })).toContainText(/barrière/i);
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
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await page.locator('[data-action="battle-log"]').click();
  const log = page.getByRole('dialog', { name: 'Journal du combat' });
  await expect(log).toContainText('Arc lucide');
  await expect(log).toContainText(/Deuilastre entre purifié et Concentré/);
});

test('ladder rivals telegraph and trigger their unique ace phase', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=18&animations=0&enemyHp=1');
  await page.getByRole('button', { name: /Jouer|Continuer/ }).click();
  await expect(page.locator('.trainer-ace')).toContainText('Second souffle');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('[data-move="lucid_arc"]')).toBeEnabled();
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await page.getByRole('button', { name: 'Codex du combat' }).click();
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
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
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
  await page.keyboard.press('c');
  const relay = page.locator('.switch-option.perfect-read');
  await expect(relay).toHaveCount(1);
  await expect(relay).toContainText('RELAIS PARFAIT · +6 Éclat');
  await relay.click();
  await expect(page.locator('.perfect-relay-fx')).toBeVisible();
  await expect(page.locator('#action-line')).toContainText('RELAIS PARFAIT');
});

test('Burning enables Venom Harvest as one visible Combo', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['thornox', 'nymbloom', 'riptalon'],
    reducedMotion: false,
    battleSpeed: 2,
  });
  await page.goto('/?seed=1');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('#quick-rule').selectOption('starstorm');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('[data-move="toxic_spines"]')).toBeEnabled();
  await page.locator('[data-move="toxic_spines"]').click();
  await expect(page.locator('[data-move="venom_harvest"]')).toBeEnabled();
  await expect(page.locator('[data-move="venom_harvest"] .move-combo-badge')).toContainText('COMBO +40%');
  const comboImpact = expect(page.locator('.combo-impact')).toBeVisible();
  await page.locator('[data-move="venom_harvest"]').click();
  await comboImpact;
  await expect(page.locator('#action-line')).toContainText(/Combo/);
});

test('battle codex explains live rules and closes with Escape', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=12&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await page.getByRole('button', { name: 'Codex du combat' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Pouvoir de l’arène')).toBeVisible();
  await expect(page.getByText('Triangles de types')).toBeVisible();
  await expect(page.getByText(/Eau → Feu → Plante → Eau/)).toBeVisible();
  await expect(page.getByText(/entre triangles : ×1/)).toBeVisible();
  await expect(page.locator('.trainer-command-codex')).toContainText('Coup de pouce');
  await expect(page.getByText(/Une attaque donne 20 Éclat/)).toBeVisible();
  await expect(page.locator('.flow-codex, .contract-codex, .resonance-codex')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('versus intro stays focused on the teams and arena', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/?seed=32');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await expect(page.locator('.battle-intro-fx')).toBeVisible();
  await expect(page.locator('.intro-contract')).toHaveCount(0);
});

test('battle chronicle records semantic events and opens from the keyboard', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=72&animations=0');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('[data-move="slowing_riddle"]')).toBeEnabled();
  await page.locator('[data-move="slowing_riddle"]').click();
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
  await page.keyboard.press('l');
  await expect(page.getByRole('dialog', { name: 'Journal du combat' })).toBeVisible();
  await expect(page.locator('.battle-log li')).not.toHaveCount(0);
  await expect(page.locator('.battle-log li.turn-start[data-turn="Tour 1"]')).toHaveCount(1);
  await expect(page.locator('.battle-log')).toContainText(/lance|perd|entre dans l’arène/);
  await expect(page.locator('.battle-log')).toContainText('Ton Orakyn');
  await expect(page.locator('.battle-log')).toContainText('Kordane rival');
  await expect(page.locator('.battle-log li').filter({ hasText: 'Combo' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.battle-log')).toHaveCount(0);
});

test('flat Surge is deterministic and has no sequence UI', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?seed=83&animations=0&enemy=kordane,calderoc,farfombre&enemyMove=resonant_focus');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  const meter = page.locator('#hud-player .plate-surge-number');
  await expect(meter).toContainText('30/100');
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('[data-move="slowing_riddle"]')).toBeEnabled();
  await expect(meter).toContainText(/\b50\/100\b/);
  await expect(page.locator('.flow-route, .flow-reset, .flow-chip, .flow-crescendo-call')).toHaveCount(0);
});

test('two ready signature moves trigger the full-screen clash intro', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['solflare', 'lumivox', 'voltide'],
    reducedMotion: false,
    battleSpeed: 1,
  });
  await page.goto('/?seed=61&enemyMove=supernova');
  await page.getByRole('button', { name: 'Épreuves' }).click();
  await page.getByRole('button', { name: 'Jouer cette épreuve' }).first().click();
  await page.getByRole('button', { name: 'Jouer cette épreuve' }).click();
  await expect(page.locator('[data-move="supernova"]')).toBeEnabled({ timeout: 4000 });
  await expect(page.locator('#hud-player .team-dot.signature-ready')).toHaveCount(3);
  await expect(page.locator('#hud-enemy .team-dot.signature-ready')).toHaveCount(3);
  await page.locator('[data-move="supernova"]').click();
  await expect(page.locator('.signature-clash')).toBeVisible({ timeout: 2500 });
  await expect(page.getByText('VS')).toBeVisible();
});

test('a switched teammate converts a setup with visible Combo credit', async ({ page }) => {
  await installCompletedTutorial(page, {
    lastTeam: ['orakyn', 'pyrolynx', 'abyssar'],
    reducedMotion: false,
    battleSpeed: 2,
  });
  await page.goto(
    '/?seed=68&player=orakyn,pyrolynx,abyssar&enemy=monolith,kordane,brontusk&enemyMove=gravity_fist,gravity_fist,gravity_fist'
  );
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.locator('#quick-rule').selectOption('starstorm');
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  await page.locator('[data-move="lucid_arc"]').click();
  await expect(page.locator('[data-action="open-switch"]')).toBeEnabled({ timeout: 5000 });
  await page.locator('[data-action="open-switch"]').click();
  await page.getByRole('button', { name: /Pyrolynx/ }).click();
  await expect(page.locator('[data-move="ninefold_inferno"]')).toBeEnabled({ timeout: 5000 });
  await expect(page.locator('[data-move="ninefold_inferno"] .move-combo-badge')).toContainText('Orakyn');
  await page.locator('[data-move="ninefold_inferno"]').click();
  await expect(page.locator('.combo-credit-call')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.combo-credit-call')).toContainText('Orakyn');
  await expect(page.locator('.combo-credit-call')).not.toContainText(/\+8|Éclat/);
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
  const replacement = page.locator('[data-switch-index]').first();
  await replacement.click();
  await expect(page.locator('#action-line')).toContainText(/entre en jeu|À toi/);
  await expect(page.locator('[data-move]:enabled').first()).toBeVisible();
});

test('a voluntary switch recalls the outgoing creature before the replacement lands', async ({ page }) => {
  await installCompletedTutorial(page, { reducedMotion: false, battleSpeed: 1 });
  await page.goto('/?seed=31');
  await page.getByRole('button', { name: /Combat rapide/ }).click();
  await page.getByRole('button', { name: /Entrer dans/ }).click();
  const fighter = page.locator('#fighter-player');
  const outgoingId = await fighter.getAttribute('data-creature');
  await page.locator('[data-action="open-switch"]').waitFor({ state: 'visible' });
  await expect(page.locator('[data-action="open-switch"]')).toBeEnabled();
  await page.locator('[data-action="open-switch"]').click();
  await page.locator('[data-switch-index]:enabled').first().click();
  await expect(fighter.locator('.switch-ghost')).toHaveAttribute(
    'src',
    new RegExp(`/assets/monsters/${outgoingId}/battle\\.png$`)
  );
  await expect(fighter).not.toHaveAttribute('data-creature', outgoingId);
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
  await expect(page.locator('.recap-mvp')).toHaveCount(0);
  const recapBox = await page.locator('.battle-recap').boundingBox();
  const statsBox = await page.locator('.recap-stats').boundingBox();
  expect(recapBox).not.toBeNull();
  expect(statsBox).not.toBeNull();
  expect(statsBox.width).toBeGreaterThanOrEqual(recapBox.width - 2);
  await page.getByRole('button', { name: /Ajuster l’équipe/ }).click();
  await expect(page.getByRole('heading', { name: 'Compose ton équipe' })).toBeVisible();
  await expect(page.locator('.enemy-list')).toContainText('Orakyn');
  await expect(page.locator('.contract-preview, [data-doctrine], .team-bonds')).toHaveCount(0);
});
