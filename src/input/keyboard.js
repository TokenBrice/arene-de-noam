import { ctx, registerRoutes, route } from '../app/context.js';

const { activeOf, screen, persist } = ctx;
const { renderCurrent, handleEscape, trapModalTab } = route;

function startInput() {
  document.addEventListener('keydown', (event) => {
    if (trapModalTab(event)) return;
    if (event.key.toLowerCase() === 'm') {
      ctx.save.muted = !ctx.save.muted;
      persist();
      renderCurrent();
      return;
    }
    if (event.key === 'Escape') {
      handleEscape();
      return;
    }
    if (screen.dataset.page === 'battle' && !ctx.locked) {
      if (['1', '2', '3'].includes(event.key)) {
        const move = activeOf(ctx.battleSession.state, 'player').moves[Number(event.key) - 1];
        const button = screen.querySelector(`[data-move="${move}"]`);
        if (button && !button.disabled) button.click();
      }
      if (event.key.toLowerCase() === 'c') screen.querySelector('[data-action="open-switch"]')?.click();
      if (event.key.toLowerCase() === 'l') screen.querySelector('[data-action="battle-log"]')?.click();
    }
  });
}

registerRoutes({ startInput });
