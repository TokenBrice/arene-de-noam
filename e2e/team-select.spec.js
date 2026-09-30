import { test, expect } from '@playwright/test';
import { CREATURES, CREATURE_IDS } from '../src/data/creatures.js';
import { loadDictionary } from '../src/i18n.js';
import { arenaReady, installCompletedTutorial, watchRuntime, expectNoRuntimeLeaks } from './helpers.js';

const picked = (page) =>
  page
    .locator('.ts-cell.is-picked')
    .evaluateAll((cells) => cells.map((cell) => cell.dataset.creature).sort());
const savedGame = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('arene-de-noam-save')));

test('team select fits one 360×800 viewport with a single gold Combattre and 48 px corner targets', async ({
  page,
}) => {
  await installCompletedTutorial(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/?animations=0');
  await page.locator('[data-action="quick"]').click();
  const layout = await page.evaluate(() => {
    const inView = (element) => {
      const box = element.getBoundingClientRect();
      return (
        box.width > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth
      );
    };
    const grid = document.querySelector('.ts-grid').getBoundingClientRect();
    const center = (element) => {
      const box = element.getBoundingClientRect();
      return [box.left + box.width / 2, box.top + box.height / 2];
    };
    const hits = (element, [x, y]) => element.contains(document.elementFromPoint(x, y));
    const info = document.querySelector('.ts-cell-info'),
      remove = document.querySelector('.ts-slot-remove'),
      cell = document.querySelector('.ts-cell'),
      slot = document.querySelector('.ts-slot-main'),
      [ix, iy] = center(info),
      [rx, ry] = center(remove);
    return {
      chrome: ['.ts-rival', '.ts-slots', '.ts-filters', '[data-action="start-battle"]'].every((selector) =>
        inView(document.querySelector(selector))
      ),
      creatures: [...document.querySelectorAll('.ts-cell')].filter((cell) => {
        const box = cell.getBoundingClientRect();
        return inView(cell) && box.top >= grid.top - 1 && box.bottom <= grid.bottom + 1;
      }).length,
      gold: [...document.querySelectorAll('#screen .primary-btn')].filter(
        (button) => button.getClientRects().length
      ).length,
      // A card's (i) and a slot's × answer around their small discs (a 48 px
      // target), while the centre of a portrait still picks or opens the slot.
      targets: [
        hits(info, [ix - 18, iy + 18]),
        hits(info, [ix + 14, iy - 14]),
        hits(remove, [rx - 18, ry + 18]),
        hits(cell, center(cell)),
        hits(slot, center(slot)),
      ],
    };
  });
  expect(layout.chrome).toBe(true);
  expect(layout.creatures).toBeGreaterThanOrEqual(12);
  expect(layout.gold).toBe(1);
  expect(layout.targets).toEqual([true, true, true, true, true]);
  await expect(page.locator('[data-action="start-battle"]')).toHaveText(/^Combattre/);
  // "Ton équipe" stays on one line beside its three actions, upright and held sideways.
  const titleLines = () =>
    page
      .locator('.topbar-title h1')
      .evaluate((h1) =>
        Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight))
      );
  expect(await titleLines()).toBe(1);
  await page.setViewportSize({ width: 800, height: 360 });
  expect(await titleLines()).toBe(1);
});

test('picks patch the trio: unpick, pick, the lead follows its creature, a fourth pick is refused', async ({
  page,
}) => {
  const runtime = watchRuntime(page);
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await page.locator('[data-action="quick"]').click();
  expect(await picked(page)).toEqual(['abyssar', 'orakyn', 'virelia']);
  const grid = await page.locator('.ts-grid').elementHandle();
  await page.locator('[data-lead-index="2"]').click();
  await expect(page.locator('[data-lead-index="2"]')).toHaveAttribute('aria-pressed', 'true');
  // Removing the first slot keeps Virelia as the lead (now the second slot).
  await page.locator('[data-slot-remove="0"]').click();
  await expect(page.locator('[data-creature="orakyn"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-lead-index="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-action="start-battle"]')).toBeDisabled();
  await page.locator('[data-creature="calderoc"]').click();
  await expect(page.locator('[data-creature="calderoc"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-creature="pyrolynx"]').click();
  expect(await picked(page)).toEqual(['abyssar', 'calderoc', 'virelia']);
  // The refusal toast sits above the bar, clear of the topbar and the rival header.
  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/show/);
  const toastBox = await toast.boundingBox(),
    rivalBox = await page.locator('.ts-rival').boundingBox();
  expect(toastBox.y).toBeGreaterThan(rivalBox.y + rivalBox.height);
  // Picks patch the grid in place instead of re-rendering it.
  expect(await grid.evaluate((node) => node.isConnected)).toBe(true);
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
  // The chosen lead is stored first, so the next team select opens with it.
  expect((await savedGame(page)).lastTeam).toEqual(['virelia', 'abyssar', 'calderoc']);
  await expectNoRuntimeLeaks(runtime);
});

test('tapping a slot opens its action sheet instead of dropping the creature', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-slot-open="2"]').click();
  await expect(page.locator('.sheet-title')).toHaveText('Virelia');
  expect(await picked(page)).toEqual(['abyssar', 'orakyn', 'virelia']);
  // Send in first.
  await page.locator('[data-action="slot-lead"]').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.locator('[data-lead-index="2"]')).toHaveAttribute('aria-pressed', 'true');
  // The lead's sheet has no "send in first"; its card action opens the creature sheet.
  await page.locator('[data-slot-open="2"]').click();
  await expect(page.locator('[data-action="slot-lead"]')).toHaveCount(0);
  await page.locator('[data-action="slot-info"]').click();
  await expect(page.locator('.sheet')).toHaveCount(1);
  await expect(page.locator('.sheet .creature-sheet-moves li')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet')).toHaveCount(0);
  // Remove, from the sheet: the lead follows Virelia into the second slot.
  await page.locator('[data-slot-open="0"]').click();
  await page.locator('[data-action="slot-remove"]').click();
  expect(await picked(page)).toEqual(['abyssar', 'virelia']);
  await expect(page.locator('[data-lead-index="1"]')).toHaveAttribute('aria-pressed', 'true');
});

test('every card has an (i) that opens its sheet without picking it', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await page.locator('[data-action="quick"]').click();
  await expect(page.locator('.ts-cell-info')).toHaveCount(30);
  await page.locator('[data-creature-info="nymbloom"]').click();
  await expect(page.locator('.sheet-title')).toHaveText('Nymbloom');
  await expect(page.locator('.sheet .creature-sheet-moves li')).toHaveCount(3);
  // A full team: the sheet reads, it cannot add.
  await expect(page.locator('[data-action="sheet-add"]')).toHaveCount(0);
  expect(await picked(page)).toEqual(['abyssar', 'orakyn', 'virelia']);
  await page.keyboard.press('Escape');
  await page.locator('[data-slot-remove="0"]').click();
  await page.locator('[data-creature-info="nymbloom"]').click();
  await page.locator('[data-action="sheet-add"]').click();
  expect(await picked(page)).toEqual(['abyssar', 'nymbloom', 'virelia']);
});

test('a Chromatique shows on the player side only: the rival copy stays normal', async ({ page }) => {
  await installCompletedTutorial(page, {
    version: 18,
    haptics: false,
    mastery: { orakyn: 60 },
    chromatiques: { orakyn: true },
  });
  await page.goto('/?animations=0&enemy=orakyn,calderoc,mossaur&player=orakyn,virelia,kordane');
  await page.locator('[data-action="quick"]').click();
  const shiny = /\/orakyn\/battle-shiny\.png$/,
    normal = /\/orakyn\/battle\.png$/;
  await expect(page.locator('[data-slot-open="0"] img')).toHaveAttribute('src', shiny);
  await expect(page.locator('.ts-foe[data-foe="orakyn"] img')).toHaveAttribute('src', normal);
  await page.locator('[data-action="open-options"]').click();
  await expect(page.locator('[data-enemy-pick="orakyn"] img')).toHaveAttribute('src', normal);
  await page.keyboard.press('Escape');
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-creature', 'orakyn');
  await expect(page.locator('#fighter-player img')).toHaveAttribute('src', shiny);
  await expect(page.locator('#fighter-enemy img')).toHaveAttribute('src', normal);
});

test('a type chip filters the roster and the same chip shows everyone again', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await page.locator('[data-action="quick"]').click();
  await expect(page.locator('[data-affinity-filter]')).toHaveCount(6);
  await page.locator('[data-affinity-filter="tide"]').click();
  await expect(page.locator('[data-affinity-filter="tide"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.ts-cell:visible')).toHaveCount(5);
  await expect(page.locator('[data-creature="abyssar"]')).toBeVisible();
  await expect(page.locator('[data-creature="orakyn"]')).toBeHidden();
  await page.locator('[data-affinity-filter="tide"]').click();
  await expect(page.locator('.ts-cell:visible')).toHaveCount(30);
});

test('the teams sheet loads a recommended team and saves, reloads and clears a personal squad with its lead', async ({
  page,
}) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0');
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="open-teams"]').click();
  await expect(page.locator('[data-squad]')).toHaveCount(8);
  await page.locator('[data-squad="storm_circuit"]').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  expect(await picked(page)).toEqual(['nymbloom', 'riptalon', 'voltide']);
  await page.locator('[data-lead-index="1"]').click();
  await page.locator('[data-action="open-teams"]').click();
  await page.locator('[data-custom-save="0"]').click();
  await expect(page.locator('[data-custom-slot="0"] img')).toHaveCount(3);
  // Save shape unchanged: { team, lead }.
  expect((await savedGame(page)).customSquads[0]).toEqual({
    team: ['voltide', 'nymbloom', 'riptalon'],
    lead: 1,
  });
  await page.locator('[data-squad="worldbreakers"]').click();
  expect(await picked(page)).toEqual(['abyssar', 'brontusk', 'monolith']);
  await page.locator('[data-action="open-teams"]').click();
  await page.locator('[data-custom-load="0"]').click();
  expect(await picked(page)).toEqual(['nymbloom', 'riptalon', 'voltide']);
  await expect(page.locator('[data-lead-index="1"]')).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await page.locator('[data-action="quick"]').click();
  await page.locator('[data-action="open-teams"]').click();
  await expect(page.locator('[data-custom-slot="0"] img')).toHaveCount(3);
  await page.locator('[data-custom-clear="0"]').click();
  await expect(page.locator('[data-custom-slot="0"]')).toContainText('Emplacement libre');
  await expect(page.locator('[data-custom-save="0"]')).toBeFocused();
  expect((await savedGame(page)).customSquads[0]).toBeNull();
});

test('the random team remix fields a fresh trio led by the suggested lead', async ({ page }) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0&enemy=kordane,calderoc,virelia');
  await page.locator('[data-action="quick"]').click();
  const slots = page.locator('.ts-slots'),
    order = () => page.locator('.ts-slot-name').allTextContents();
  // Leading with anyone but the best lead against this rival marks the best one Conseillé.
  await page.locator('[data-lead-index="1"]').click();
  await expect(slots).toContainText('Conseillé');
  const before = await order();
  await page.locator('[data-action="open-teams"]').click();
  await page.locator('[data-action="remix-team"]').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  const after = await order();
  expect(new Set(after).size).toBe(3);
  expect(after).not.toEqual(before);
  expect(await picked(page)).toHaveLength(3);
  // The remix sends in that best lead itself, so no other slot is marked Conseillé.
  await expect(slots.locator('[data-lead-index][aria-pressed="true"]')).toHaveCount(1);
  await expect(slots).not.toContainText('Conseillé');
  await expect(page.locator('[data-action="start-battle"]')).toBeEnabled();
});

test('quick-battle options pick difficulty, a labelled opponent, arena and rule chips; matchup badges follow', async ({
  page,
}) => {
  await installCompletedTutorial(page);
  await page.goto('/?animations=0&enemy=kordane,calderoc,virelia');
  await page.locator('[data-action="quick"]').click();
  await expect(page.locator('[data-creature="calderoc"]')).toHaveAttribute('data-matchup', 'up');
  await expect(page.locator('[data-creature="abyssar"]')).toHaveAttribute(
    'aria-label',
    /Fort contre 1 rival · Faible contre 1 rival/
  );
  await page.locator('[data-action="open-options"]').click();
  await expect(page.locator('.sheet select')).toHaveCount(0);
  await page.locator('[data-difficulty="champion"]').click();
  await expect(page.locator('[data-difficulty="champion"]')).toHaveAttribute('aria-pressed', 'true');
  for (const id of ['kordane', 'calderoc', 'virelia'])
    await page.locator(`[data-enemy-pick="${id}"]`).click();
  await expect(page.locator('[data-action="start-battle"]')).toBeDisabled();
  // Each rival choice shows its name.
  await expect(page.locator('[data-enemy-pick="abyssar"]')).toContainText('Abyssar');
  for (const id of ['abyssar', 'riptalon', 'voltide'])
    await page.locator(`[data-enemy-pick="${id}"]`).click();
  const pressedOnly = (attr) => page.locator(`[${attr}][aria-pressed="true"]`);
  await page.locator('[data-arena-pick="volcano"]').click();
  await expect(pressedOnly('data-arena-pick')).toHaveAttribute('data-arena-pick', 'volcano');
  await page.locator('[data-rule-pick="fortress_duel"]').click();
  await expect(pressedOnly('data-rule-pick')).toHaveAttribute('data-rule-pick', 'fortress_duel');
  await page.keyboard.press('Escape');
  await expect(page.locator('.ts-foe[data-foe="abyssar"]')).toHaveCount(1);
  await expect(page.locator('[data-creature="calderoc"]')).toHaveAttribute('data-matchup', 'down');
  await expect(page.locator('.ts-weather')).toHaveCount(1);
  await expect(page.locator('.ts-rival .rule-chip')).toHaveCount(1);
  await page.locator('[data-action="start-battle"]').click();
  await arenaReady(page);
  expect((await savedGame(page)).difficulty).toBe('champion');
});

test('draft: three picks, the rival reveal without Chromatiques, and the chosen lead enters first', async ({
  page,
}) => {
  // Every Chromatique unlocked and shown: only the player's picks may wear one.
  await installCompletedTutorial(page, {
    draftWins: 1,
    version: 18,
    haptics: false,
    mastery: Object.fromEntries(CREATURE_IDS.map((id) => [id, 60])),
    chromatiques: Object.fromEntries(CREATURE_IDS.map((id) => [id, true])),
  });
  await page.goto('/?seed=20260814&animations=0');
  await page.locator('[data-action="challenges"]').click();
  await page.locator('[data-action="draft"]').click();
  const chosen = [],
    french = await loadDictionary('fr');
  for (let round = 0; round < 3; round++) {
    await expect(page.locator('[data-draft-pick]')).toHaveCount(3);
    // With nothing picked yet, each offer's line says what its class does (never a role that
    // contradicts the class chip beside it).
    if (round === 0)
      for (const [id, insight] of await page
        .locator('.draft-offer')
        .evaluateAll((offers) =>
          offers.map((offer) => [
            offer.querySelector('[data-draft-pick]').dataset.draftPick,
            offer.querySelector('.draft-offer-insight').textContent,
          ])
        ))
        expect(insight).toBe(french[`class.effect.${CREATURES[id].classId}`]);
    const offer = page.locator('[data-draft-pick]').first();
    chosen.push(await offer.getAttribute('data-draft-pick'));
    await offer.click();
  }
  expect(new Set(chosen).size).toBe(3);
  await expect(page.locator('[data-focus-key="draft-lead-2"]')).toBeFocused();
  await expect(page.locator('.draft-rival-team img')).toHaveCount(3);
  for (const src of await page
    .locator('.draft-rival-team img')
    .evaluateAll((imgs) => imgs.map((img) => img.src)))
    expect(src).toMatch(/\/battle\.png$/);
  for (const src of await page.locator('.draft-slot img').evaluateAll((imgs) => imgs.map((img) => img.src)))
    expect(src).toMatch(/\/battle-shiny\.png$/);
  await expect(page.locator('.draft-slot.recommended')).toHaveCount(1);
  await expect(page.locator('#screen .primary-btn')).toHaveCount(1);
  await page.locator('[data-draft-lead="2"]').click();
  await expect(page.locator('[data-draft-lead="2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="draft-battle"]').click();
  await arenaReady(page);
  await expect(page.locator('#fighter-player')).toHaveAttribute('data-creature', chosen[2]);
  await expect(page.locator('#fighter-player img')).toHaveAttribute('src', /\/battle-shiny\.png$/);
  await expect(page.locator('#fighter-enemy img')).toHaveAttribute('src', /\/battle\.png$/);
});
