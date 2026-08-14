import { ctx, registerRoutes, route } from '../app/context.js';

const { activeOf, t, screen, sound, persist, notify } = ctx;
const { renderCurrent, handleEscape, trapModalTab } = route;

function gamepadFocusables() {
  return [
    ...screen.querySelectorAll(
      'button:not(:disabled),select:not(:disabled),input:not(:disabled),[role="button"][tabindex="0"]'
    ),
  ].filter((element) => {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
}
function moveGamepadFocus(direction) {
  const items = gamepadFocusables();
  if (!items.length) return;
  const current = items.includes(document.activeElement) ? document.activeElement : null;
  if (!current) {
    items[0].focus();
    items[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    return;
  }
  const origin = current.getBoundingClientRect(),
    ox = origin.left + origin.width / 2,
    oy = origin.top + origin.height / 2,
    candidates = items
      .filter((item) => item !== current)
      .map((item) => {
        const r = item.getBoundingClientRect(),
          dx = r.left + r.width / 2 - ox,
          dy = r.top + r.height / 2 - oy,
          valid =
            direction === 'left'
              ? dx < -3
              : direction === 'right'
                ? dx > 3
                : direction === 'up'
                  ? dy < -3
                  : dy > 3,
          primary = Math.abs(direction === 'left' || direction === 'right' ? dx : dy),
          cross = Math.abs(direction === 'left' || direction === 'right' ? dy : dx);
        return { item, valid, score: primary + cross * 1.8 };
      })
      .filter((entry) => entry.valid)
      .sort((a, b) => a.score - b.score);
  const next = candidates[0]?.item;
  if (next) {
    next.focus();
    next.scrollIntoView({
      behavior: ctx.save.reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
    sound.ui();
  }
}
function pollGamepad() {
  const pad = [...(navigator.getGamepads?.() || [])].find(Boolean);
  if (!pad) {
    ctx.gamepadLoop = 0;
    ctx.gamepadButtons = [];
    document.body.classList.remove('gamepad-active');
    return;
  }
  const current = pad.buttons.map((button) => Boolean(button?.pressed)),
    pressed = (index) => current[index] && !ctx.gamepadButtons[index],
    axisX = pad.axes?.[0] || 0,
    axisY = pad.axes?.[1] || 0,
    axisActive = Math.abs(axisX) > 0.62 || Math.abs(axisY) > 0.62;
  if (pressed(14) || (!ctx.gamepadAxisLatch && axisX < -0.62)) moveGamepadFocus('left');
  if (pressed(15) || (!ctx.gamepadAxisLatch && axisX > 0.62)) moveGamepadFocus('right');
  if (pressed(12) || (!ctx.gamepadAxisLatch && axisY < -0.62)) moveGamepadFocus('up');
  if (pressed(13) || (!ctx.gamepadAxisLatch && axisY > 0.62)) moveGamepadFocus('down');
  if (pressed(0)) {
    const items = gamepadFocusables();
    if (items.includes(document.activeElement)) document.activeElement.click();
    else items[0]?.focus();
  }
  if (pressed(1)) handleEscape();
  if (pressed(2) && screen.dataset.page === 'battle' && !ctx.locked)
    screen.querySelector('[data-action="open-switch"]')?.click();
  if (pressed(3) && screen.dataset.page === 'battle' && !ctx.locked)
    screen.querySelector('[data-action="battle-help"]')?.click();
  if (pressed(9) && screen.dataset.page === 'battle' && !ctx.locked)
    screen.querySelector('[data-action="battle-log"]')?.click();
  ctx.gamepadButtons = current;
  ctx.gamepadAxisLatch = axisActive;
  ctx.gamepadLoop = requestAnimationFrame(pollGamepad);
}

function startInput() {
  window.addEventListener('gamepadconnected', () => {
    document.body.classList.add('gamepad-active');
    notify(t('settings.gamepadConnected'));
    if (!ctx.gamepadLoop) ctx.gamepadLoop = requestAnimationFrame(pollGamepad);
  });
  window.addEventListener('gamepaddisconnected', () => {
    ctx.gamepadButtons = [];
    ctx.gamepadAxisLatch = false;
  });

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

registerRoutes({ gamepadFocusables, moveGamepadFocus, pollGamepad, startInput });
