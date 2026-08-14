import { ctx, registerRoutes, route } from '../app/context.js';

const { DEFAULT_SAVE, SAVE_KEY, i18n, t, screen, sound, persist, disposeArena, topbar } = ctx;
const { bindCommon, renderTitle } = route;

function renderSettings() {
  disposeArena();
  ctx.battleSession = null;
  screen.dataset.page = 'settings';
  screen.className = 'screen';
  screen.innerHTML = `<div class="shell">${topbar(ctx.previousScreen)}<div class="page-head"><div><span class="eyebrow">${t('title.help')}</span><h1>${t('settings.title')}</h1></div></div><div class="settings-grid"><section class="settings-card"><div class="toggle-row"><strong>${t('settings.language')}</strong><div class="language-buttons"><button class="subtle-btn ${i18n.lang === 'fr' ? 'active' : ''}" data-lang="fr">FR</button><button class="subtle-btn ${i18n.lang === 'en' ? 'active' : ''}" data-lang="en">EN</button></div></div><div class="toggle-row"><label for="music-volume"><strong>${t('settings.musicVolume')}</strong></label><input id="music-volume" type="range" min="0" max="1" step=".05" value="${ctx.save.musicVolume}"></div><div class="toggle-row"><label for="sfx-volume"><strong>${t('settings.sfxVolume')}</strong></label><input id="sfx-volume" type="range" min="0" max="1" step=".05" value="${ctx.save.sfxVolume}"></div><div class="toggle-row"><label for="muted">${t('settings.mute')}</label><input id="muted" type="checkbox" ${ctx.save.muted ? 'checked' : ''}></div><div class="toggle-row"><label for="motion">${t('settings.motion')}</label><input id="motion" type="checkbox" ${ctx.save.reducedMotion ? 'checked' : ''}></div><div class="toggle-row"><strong>${t('settings.speed')}</strong><div class="speed-buttons"><button class="subtle-btn ${ctx.save.battleSpeed === 1 ? 'active' : ''}" data-speed="1">${t('settings.normal')}</button><button class="subtle-btn ${ctx.save.battleSpeed === 2 ? 'active' : ''}" data-speed="2">${t('settings.fast')}</button></div></div></section><section class="settings-card"><h2>${t('title.help')}</h2><p>${t('settings.controls')}</p><p class="cycle">${t('settings.affinities')}</p><button class="danger-btn" data-action="reset-save">${t('settings.reset')}</button></section></div></div>`;
  bindCommon();
  screen.querySelectorAll('[data-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      i18n.setLang(b.dataset.lang);
      ctx.save.language = i18n.lang;
      persist();
      renderSettings();
    })
  );
  screen.querySelector('#music-volume').addEventListener('input', (e) => {
    ctx.save.musicVolume = Number(e.target.value);
    sound.update(ctx.save);
    persist();
  });
  screen.querySelector('#sfx-volume').addEventListener('input', (e) => {
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
  screen.querySelectorAll('[data-speed]').forEach((b) =>
    b.addEventListener('click', () => {
      ctx.save.battleSpeed = Number(b.dataset.speed);
      persist();
      renderSettings();
    })
  );
  screen.querySelector('[data-action="reset-save"]').addEventListener('click', () => {
    if (confirm(t('settings.resetConfirm'))) {
      localStorage.removeItem(SAVE_KEY);
      ctx.save = {
        ...DEFAULT_SAVE,
        lastTeam: [...DEFAULT_SAVE.lastTeam],
        emblems: [],
        cosmetics: ['crystal'],
        mastery: {},
        feats: [],
        trials: [],
        language: i18n.lang,
      };
      persist();
      renderTitle();
    }
  });
}

registerRoutes({ renderSettings });
