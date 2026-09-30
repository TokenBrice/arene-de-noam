import { ctx, registerRoutes, route } from '../app/context.js';
import { hapticsSupported, previewHaptics, stopHaptics } from '../app/haptics.js';
import { applyQualityChoice } from '../app/quality.js';
import { QUALITY_CHOICES } from '../save.js';

const { freshDefaultSave, SAVE_KEY, i18n, t, screen, sound, persist, disposeArena, topbar } = ctx;
const { bindCommon, icon, openSheet, renderTitle, rerenderPreservingFocus } = route;

const QUALITY_LABEL_KEYS = Object.freeze({
  auto: 'settings.qualityAuto',
  low: 'settings.qualityLow',
  mid: 'settings.qualityMid',
  high: 'settings.qualityHigh',
});

const volumePercent = (value) => t('app.percent', { value: Math.round(Number(value) * 100) });

// A card: its heading row may carry one control on the right (the mute switch, the reset button).
const card = (id, iconName, titleKey, rows, headControl = '') =>
  `<section class="settings-card settings-card--${id}" aria-labelledby="settings-${id}-title"><div class="settings-card-head"><h2 class="settings-card-title" id="settings-${id}-title">${icon(iconName)}<span>${t(titleKey)}</span></h2>${headControl}</div>${rows}</section>`;

const label = (id, text, hint = '') =>
  `<span class="settings-label"><b id="${id}-label">${text}</b>${hint ? `<small id="${id}-hint">${hint}</small>` : ''}</span>`;

const sliderRow = (id, text, value) => {
  const percent = volumePercent(value);
  return `<div class="settings-row settings-slider"><label class="settings-label" for="${id}"><b>${text}</b></label><input id="${id}" type="range" min="0" max="1" step=".05" value="${value}" style="--fill:${Math.round(value * 100)}%" aria-valuetext="${percent}" data-focus-key="settings-${id}"><output for="${id}" id="${id}-output" class="num">${percent}</output></div>`;
};

// A switch: a whole row (≥ 48 px target) or, `inline`, a compact control in a card heading. The
// track carries a check so "on" never depends on colour alone.
const switchRow = (id, text, on, { hint = '', disabled = false, inline = false } = {}) =>
  `<button type="button" class="${inline ? 'settings-switch settings-switch--inline' : 'settings-row settings-switch'}" role="switch" id="${id}" aria-checked="${on}" aria-labelledby="${id}-label"${hint ? ` aria-describedby="${id}-hint"` : ''}${disabled ? ' disabled' : ''} data-focus-key="settings-${id}">${label(id, text, hint)}<span class="switch-track" aria-hidden="true"><span class="switch-knob">${icon('check')}</span></span></button>`;

const segment = (attr, value, text, active) =>
  `<button type="button" class="subtle-btn${active ? ' active' : ''}" data-${attr}="${value}" data-focus-key="${attr}-${value}" aria-pressed="${active}">${text}</button>`;

const choiceRow = (id, text, buttons, { hint = '', stacked = false } = {}) =>
  `<div class="settings-row settings-choice${stacked ? ' settings-choice--stacked' : ''}">${label(id, text, hint)}<div class="settings-segments" role="group" aria-labelledby="${id}-label"${hint ? ` aria-describedby="${id}-hint"` : ''}>${buttons}</div></div>`;

function settingsHtml() {
  const { save } = ctx,
    soundCard = card(
      'sound',
      save.muted ? 'sound-off' : 'sound-on',
      'settings.groupSound',
      sliderRow('music-volume', t('settings.music'), save.musicVolume) +
        sliderRow('sfx-volume', t('settings.sfx'), save.sfxVolume),
      switchRow('muted', t('settings.mute'), save.muted, { inline: true })
    ),
    displayCard = card(
      'display',
      'sparkle',
      'settings.groupDisplay',
      choiceRow(
        'quality',
        t('settings.quality'),
        QUALITY_CHOICES.map((choice) =>
          segment('quality', choice, t(QUALITY_LABEL_KEYS[choice]), save.quality === choice)
        ).join(''),
        { hint: t(`settings.qualityHint.${save.quality}`), stacked: true }
      ) +
        switchRow('motion', t('settings.motion'), save.reducedMotion, { hint: t('settings.motionHint') }) +
        switchRow('high-contrast', t('settings.contrast'), save.highContrast, {
          hint: t('settings.contrastHint'),
        }) +
        switchRow('expert-mode', t('settings.expertMode'), save.expertMode, {
          hint: t('settings.expertModeHint'),
        }) +
        choiceRow(
          'speed',
          t('settings.speedShort'),
          segment('speed', 1, t('settings.normal'), save.battleSpeed === 1) +
            segment('speed', 2, t('settings.fast'), save.battleSpeed === 2)
        )
    ),
    gameCard = card(
      'game',
      'play',
      'settings.groupGame',
      choiceRow(
        'language',
        t('settings.language'),
        segment('lang', 'fr', 'FR', i18n.lang === 'fr') + segment('lang', 'en', 'EN', i18n.lang === 'en')
      ) +
        switchRow('haptics', t('settings.haptics'), hapticsSupported && save.haptics, {
          hint: t(hapticsSupported ? 'settings.hapticsHint' : 'settings.hapticsUnavailable'),
          disabled: !hapticsSupported,
        })
    ),
    dataCard = card(
      'data',
      'book',
      'settings.groupData',
      '',
      `<button type="button" class="danger-btn" data-action="reset-save" data-focus-key="reset-save">${icon('refresh')}<span>${t('settings.resetShort')}</span></button>`
    );
  // The shared page header; Réglages swaps the settings button for help.
  return `<div class="shell settings-page">${topbar(t('settings.title'), { actions: `<button type="button" class="icon-btn" data-action="settings-help" data-focus-key="settings-help" aria-label="${t('title.help')}">${icon('info')}</button>`, settings: false })}<div class="settings-grid">${soundCard}${displayCard}${gameCard}${dataCard}</div></div>`;
}

// Segmented choices patch in place: only the pressed state (and the quality hint) change.
function selectSegment(button) {
  button
    .closest('.settings-segments')
    .querySelectorAll('button')
    .forEach((item) => {
      item.classList.toggle('active', item === button);
      item.setAttribute('aria-pressed', String(item === button));
    });
}

function updateSlider(input) {
  const percent = volumePercent(input.value);
  input.style.setProperty('--fill', `${Math.round(Number(input.value) * 100)}%`);
  input.setAttribute('aria-valuetext', percent);
  const output = screen.querySelector(`#${input.id}-output`);
  output.value = percent;
  output.textContent = percent;
}

const SWITCHES = {
  muted: (on) => {
    ctx.save.muted = on;
    const soundIcon = icon(on ? 'sound-off' : 'sound-on'),
      topbarMute = screen.querySelector('.topbar [data-action="toggle-mute"]');
    screen.querySelector('#settings-sound-title .ico').outerHTML = soundIcon;
    topbarMute.querySelector('.ico').outerHTML = soundIcon;
    topbarMute.setAttribute('aria-pressed', String(on));
  },
  motion: (on) => {
    ctx.save.reducedMotion = on;
  },
  'high-contrast': (on) => {
    ctx.save.highContrast = on;
  },
  'expert-mode': (on) => {
    ctx.save.expertMode = on;
  },
  haptics: (on) => {
    ctx.save.haptics = on;
    if (on) previewHaptics();
    else stopHaptics();
  },
};

function openReset() {
  openSheet({
    title: t('settings.reset'),
    body: `<p class="settings-reset-warning">${icon('warning')}<b>${t('settings.resetWarning')}</b></p><p>${t('settings.resetConfirm')}</p>`,
    actions: [
      { label: t('app.cancel'), variant: 'subtle', action: 'reset-cancel' },
      {
        label: t('settings.resetConfirmAction'),
        variant: 'danger',
        action: 'reset-confirm',
        onSelect: () => {
          localStorage.removeItem(SAVE_KEY);
          ctx.save = freshDefaultSave();
          ctx.save.language = i18n.lang;
          persist();
          stopHaptics();
          applyQualityChoice(ctx.save.quality);
          renderTitle();
        },
      },
    ],
  });
}

function openHelp() {
  openSheet({
    title: t('title.help'),
    body: `<div class="settings-help"><p>${t('settings.controls')}</p><p class="settings-help-cycle">${t('settings.affinities')}</p></div>`,
  });
}

function renderSettings() {
  disposeArena();
  ctx.battleSession = null;
  screen.dataset.page = 'settings';
  screen.className = 'screen';
  screen.innerHTML = settingsHtml();
  bindCommon();
  screen.querySelectorAll('[data-lang]').forEach((button) =>
    button.addEventListener('click', () => {
      i18n.setLang(button.dataset.lang);
      ctx.save.language = i18n.lang;
      persist();
      rerenderPreservingFocus(() => renderSettings());
    })
  );
  for (const [id, key] of [
    ['music-volume', 'musicVolume'],
    ['sfx-volume', 'sfxVolume'],
  ])
    screen.querySelector(`#${id}`).addEventListener('input', (event) => {
      updateSlider(event.target);
      ctx.save[key] = Number(event.target.value);
      persist();
      if (key === 'sfxVolume') sound.ui();
    });
  screen.querySelectorAll('.settings-switch').forEach((row) =>
    row.addEventListener('click', () => {
      const on = row.getAttribute('aria-checked') !== 'true';
      row.setAttribute('aria-checked', String(on));
      SWITCHES[row.id](on);
      persist();
    })
  );
  screen.querySelectorAll('[data-speed]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.save.battleSpeed = Number(button.dataset.speed);
      persist();
      selectSegment(button);
    })
  );
  screen.querySelectorAll('[data-quality]').forEach((button) =>
    button.addEventListener('click', () => {
      ctx.save.quality = button.dataset.quality;
      persist();
      applyQualityChoice(ctx.save.quality);
      selectSegment(button);
      screen.querySelector('#quality-hint').textContent = t(`settings.qualityHint.${ctx.save.quality}`);
    })
  );
  screen.querySelector('[data-action="reset-save"]').addEventListener('click', openReset);
  screen.querySelector('[data-action="settings-help"]').addEventListener('click', openHelp);
}

registerRoutes({ renderSettings });
