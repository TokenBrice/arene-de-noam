import { ctx, registerRoutes, route } from '../app/context.js';

const { activeOf, screen, persist } = ctx;
const { renderCurrent, goBack, trapModalTab } = route;

function startInput() {
  document.addEventListener('keydown', (event) => {
    if (trapModalTab(event)) return;
    // Letter shortcuts never fire while typing (Bestiary search).
    if (
      event.key.toLowerCase() === 'm' &&
      !event.target.matches?.('input[type="search"], input[type="text"]')
    ) {
      if (screen.dataset.page === 'battle') route.setBattleMuted(!ctx.save.muted);
      else {
        ctx.save.muted = !ctx.save.muted;
        persist();
        renderCurrent();
      }
      return;
    }
    if (event.key === 'Escape') {
      goBack();
      return;
    }
    if (screen.dataset.page !== 'battle') return;
    const modalOpen =
      screen.querySelector('[role="dialog"][aria-modal="true"]') ||
      screen.querySelector('#replacement-root')?.childElementCount > 0;
    if (modalOpen) return;
    // The journal is a covering sheet like the pause sheet: it opens while a turn plays and
    // freezes it (docs/battle-presentation.md §11.5). Commands wait for the controls.
    if (event.key.toLowerCase() === 'l') {
      route.openBattleLog();
      return;
    }
    if (ctx.locked) return;
    if (['1', '2', '3'].includes(event.key)) {
      const move = activeOf(ctx.battleSession.state, 'player').moves[Number(event.key) - 1];
      const button = screen.querySelector(`[data-move="${move}"]`);
      if (button && !button.disabled) button.click();
    }
    if (event.key.toLowerCase() === 'c') screen.querySelector('[data-action="open-switch"]')?.click();
  });
}

registerRoutes({ startInput });
