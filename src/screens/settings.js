import { ctx, registerRoutes, route } from '../app/context.js';

const { freshDefaultSave, SAVE_KEY, i18n, t, screen, sound, persist, disposeArena, topbar } = ctx;
const { bindCommon, renderTitle, rerenderPreservingFocus } = route;

const volumePercent = (value) => `${Math.round(Number(value) * 100)}%`;
const rangeControl = (id, label, value) => {
  const percent = volumePercent(value);
  return `<div class="toggle-row"><label for="${id}"><strong>${label}</strong></label><div class="range-control"><input id="${id}" type="range" min="0" max="1" step=".05" value="${value}" aria-valuetext="${percent}"><output for="${id}" id="${id}-output">${percent}</output></div></div>`;
};
const updateRangeOutput = (input) => {
  const percent = volumePercent(input.value);
  const output = screen.querySelector(`#${input.id}-output`);
  if (output) {
    output.value = percent;
    output.textContent = percent;
  }
  input.setAttribute('aria-valuetext', percent);
};

function renderSettings() {
  disposeArena();
  ctx.battleSession = null;
  screen.dataset.page = 'settings';
  screen.className = 'screen';
  screen.innerHTML = `<div class="shell">${topbar(ctx.settingsReturn || 'title')}<div class="page-head"><div><span class="eyebrow">${t('title.help')}</span><h1>${t('settings.title')}</h1></div></div><div class="settings-grid"><section class="settings-card"><div class="toggle-row"><strong>${t('settings.language')}</strong><div class="language-buttons"><button class="subtle-btn ${i18n.lang === 'fr' ? 'active' : ''}" data-lang="fr" data-focus-key="language-fr" aria-pressed="${i18n.lang === 'fr'}">FR</button><button class="subtle-btn ${i18n.lang === 'en' ? 'active' : ''}" data-lang="en" data-focus-key="language-en" aria-pressed="${i18n.lang === 'en'}">EN</button></div></div>${rangeControl('music-volume', t('settings.musicVolume'), ctx.save.musicVolume)}${rangeControl('sfx-volume', t('settings.sfxVolume'), ctx.save.sfxVolume)}<div class="toggle-row"><label for="muted">${t('settings.mute')}</label><input id="muted" data-focus-key="settings-muted" type="checkbox" ${ctx.save.muted ? 'checked' : ''}></div><div class="toggle-row"><label for="motion">${t('settings.motion')}</label><input id="motion" data-focus-key="settings-motion" type="checkbox" ${ctx.save.reducedMotion ? 'checked' : ''}></div><div class="toggle-row contrast-row expert-mode-row"><label for="expert-mode"><strong>${t('settings.expertMode')}</strong><small>${t('settings.expertModeHint')}</small></label><input id="expert-mode" data-focus-key="settings-expert-mode" type="checkbox" ${ctx.save.expertMode ? 'checked' : ''}></div><div class="toggle-row"><strong>${t('settings.speed')}</strong><div class="speed-buttons"><button class="subtle-btn ${ctx.save.battleSpeed === 1 ? 'active' : ''}" data-speed="1" data-focus-key="speed-1" aria-pressed="${ctx.save.battleSpeed === 1}">${t('settings.normal')}</button><button class="subtle-btn ${ctx.save.battleSpeed === 2 ? 'active' : ''}" data-speed="2" data-focus-key="speed-2" aria-pressed="${ctx.save.battleSpeed === 2}">${t('settings.fast')}</button></div></div></section><section class="settings-card"><h2>${t('title.help')}</h2><p>${t('settings.controls')}</p><p class="cycle">${t('settings.affinities')}</p><button class="danger-btn" data-action="reset-save">${t('settings.reset')}</button></section></div></div>`;
  bindCommon();
  screen.querySelectorAll('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      i18n.setLang(b.dataset.lang);
      ctx.save.language = i18n.lang;
      persist();
      rerenderPreservingFocus(() => renderSettings());
    })
  );
  screen.querySelector('#music-volume').addEventListener('input', (e) => {
    updateRangeOutput(e.target);
    ctx.save.musicVolume = Number(e.target.value);
    sound.update(ctx.save);
    persist();
  });
  screen.querySelector('#sfx-volume').addEventListener('input', (e) => {
    updateRangeOutput(e.target);
    ctx.save.sfxVolume = Number(e.target.value);
    sound.update(ctx.save);
    persist();
    sound.ui();
  });
  screen.querySelector('#muted').addEventListener('change', (e) => {
    ctx.save.muted = e.target.checked;
    persist();
  });
  screen.querySelector('#motion').addEventListener('change', (e) => {
    ctx.save.reducedMotion = e.target.checked;
    persist();
  });
  screen.querySelector('#expert-mode').addEventListener('change', (e) => {
    ctx.save.expertMode = e.target.checked;
    persist();
    rerenderPreservingFocus(() => renderSettings());
  });
  screen.querySelectorAll('[data-speed]').forEach((b) =>
    b.addEventListener('click', () => {
      ctx.save.battleSpeed = Number(b.dataset.speed);
      persist();
      rerenderPreservingFocus(() => renderSettings());
    })
  );
  screen.querySelector('[data-action="reset-save"]').addEventListener('click', (event) => {
    const trigger = event.currentTarget;
    screen.insertAdjacentHTML(
      'beforeend',
      `<div class="settings-dialog-backdrop"><section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><span class="eyebrow">${t('settings.resetWarning')}</span><h2 id="reset-title">${t('settings.reset')}</h2><p id="reset-description">${t('settings.resetConfirm')}</p><div><button type="button" class="subtle-btn" data-action="reset-cancel">${t('app.cancel')}</button><button type="button" class="danger-btn" data-action="reset-confirm">${t('settings.resetConfirmAction')}</button></div></section></div>`
    );
    const backdrop = screen.querySelector('.settings-dialog-backdrop'),
      close = () => {
        backdrop.remove();
        trigger.focus();
      };
    backdrop.querySelector('[data-action="reset-cancel"]').addEventListener('click', close);
    backdrop.addEventListener('click', (clickEvent) => {
      if (clickEvent.target === backdrop) close();
    });
    backdrop.querySelector('[data-action="reset-confirm"]').addEventListener('click', () => {
      localStorage.removeItem(SAVE_KEY);
      ctx.save = freshDefaultSave();
      ctx.save.language = i18n.lang;
    });
    backdrop.querySelector('[data-action="reset-cancel"]').focus();
  });
}

registerRoutes({ renderSettings });
