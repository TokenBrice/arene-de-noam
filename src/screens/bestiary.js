import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  CLASSES,
  CREATURES,
  CREATURE_IDS,
  MOVES,
  PASSIVES,
  FEATS,
  CURRENT_FEAT_IDS,
  masteryProgress,
  comboSetupStatus,
  sortStatusIds,
  statusBadgeHtml,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  affinity,
  affinityName,
  affinityIcon,
  classIcon,
  className,
  escapeHtml,
  disposeArena,
  ensureBattleStyles,
  topbar,
} = ctx;
const { bindCommon, beginMoveFx, impactMoveFx, tacticalFx, clearBattleFx } = route;

function displayedStatusIds(move) {
  const comboStatus = comboSetupStatus(move);
  return [
    ...new Set(
      sortStatusIds([
        ...(move.selfStatuses || []).map(({ id }) => id),
        ...(move.targetStatuses || []).map(({ id }) => id),
        ...(comboStatus ? [comboStatus] : []),
      ])
    ),
  ];
}

function moveStatusBadgesHtml(move, className = '') {
  const ids = displayedStatusIds(move);
  return ids.length
    ? `<span class="move-status-badges${className ? ` ${className}` : ''}">${ids.map((id) => statusBadgeHtml(id, { label: escapeHtml(t(`status.${id}`)), compact: true })).join('')}</span>`
    : '';
}

let theaterRequest = 0;
let theaterTrigger = null;
let bestiaryCompactQuery = null;
let bestiaryResizeBound = false;

function syncBestiaryDisclosureMode(event = bestiaryCompactQuery) {
  if (screen.dataset.page !== 'bestiary') return;
  const compact = event?.matches ?? bestiaryCompactQuery?.matches ?? false;
  screen.querySelectorAll('.record-hall, .feat-hall-disclosure').forEach((detail) => {
    detail.open = !compact;
  });
}

function installBestiaryDisclosureSync() {
  if (!bestiaryCompactQuery) {
    bestiaryCompactQuery = window.matchMedia('(max-width: 600px)');
    if (bestiaryCompactQuery.addEventListener)
      bestiaryCompactQuery.addEventListener('change', syncBestiaryDisclosureMode);
    else {
      bestiaryCompactQuery.addListener(syncBestiaryDisclosureMode);
      if (!bestiaryResizeBound) {
        window.addEventListener('resize', syncBestiaryDisclosureMode);
        bestiaryResizeBound = true;
      }
    }
  }
  syncBestiaryDisclosureMode();
}

function removeMoveTheater() {
  ctx.theaterTimers.forEach(clearTimeout);
  ctx.theaterTimers = [];
  clearBattleFx();
  screen.querySelector('.move-theater')?.remove();
  ctx.currentFxMove = null;
}

function closeMoveTheater() {
  theaterRequest += 1;
  removeMoveTheater();
  const trigger = theaterTrigger;
  theaterTrigger = null;
  if (trigger?.isConnected) trigger.focus();
}

function runMoveTheater(moveId) {
  ctx.theaterTimers.forEach(clearTimeout);
  ctx.theaterTimers = [];
  clearBattleFx();
  const move = MOVES[moveId],
    overlay = screen.querySelector('.move-theater');
  if (!move || !overlay) return;
  overlay.querySelector('#action-line').textContent = `${creatureName(move.owner)} · ${t(`move.${moveId}`)}`;
  beginMoveFx({ moveId, side: 'player', creatureId: move.owner });
  sound.call(move.owner);
  sound.move(move);
  const impactDelay = (ctx.save.reducedMotion ? 80 : move.signature ? 690 : 460) / ctx.save.battleSpeed,
    clearDelay = (ctx.save.reducedMotion ? 260 : move.signature ? 1600 : 1200) / ctx.save.battleSpeed;
  ctx.theaterTimers.push(
    setTimeout(() => {
      if (!screen.querySelector('.move-theater')) return;
      if (move.kind === 'damage') {
        const amount = Math.max(1, Math.round(move.power * (move.hits || 1)));
        impactMoveFx({ amount, hp: 1, hits: move.hits || 1, hit: move.hits || 1, combo: [], side: 'enemy' });
        sound.impact(move, { amount, hp: 1, hits: move.hits || 1, hit: move.hits || 1 });
      } else {
        const status = displayedStatusIds(move)[0] || 'focused',
          targetsEnemy =
            move.targetStatuses?.some(({ id }) => id === status) &&
            !move.selfStatuses?.some(({ id }) => id === status);
        tacticalFx({
          type: move.kind === 'heal' ? 'heal' : 'status',
          side: targetsEnemy ? 'enemy' : 'player',
          status,
        });
        move.kind === 'heal' ? sound.heal() : sound.guard();
      }
    }, impactDelay)
  );
  ctx.theaterTimers.push(
    setTimeout(() => {
      if (screen.querySelector('.move-theater')) clearBattleFx();
    }, clearDelay)
  );
}

async function openMoveTheater(moveId, trigger = null) {
  const req = ++theaterRequest;
  theaterTrigger =
    trigger?.isConnected
      ? trigger
      : document.activeElement?.matches?.('[data-preview-move]')
        ? document.activeElement
        : null;
  removeMoveTheater();
  await ensureBattleStyles();
  if (req !== theaterRequest || screen.dataset.page !== 'bestiary') return;
  const move = MOVES[moveId];
  if (!move) return;
  const ownerIndex = CREATURE_IDS.indexOf(move.owner),
    targetId = CREATURE_IDS[(ownerIndex + 7) % CREATURE_IDS.length];
  screen.insertAdjacentHTML(
    'beforeend',
    `<div class="move-theater" role="dialog" aria-modal="true" aria-labelledby="theater-title"><div class="theater-backdrop"></div><div id="fx-stage" class="fx-stage" aria-hidden="true"></div><div class="battlefield theater-battlefield"><div class="fighter enemy" id="fighter-enemy"><div class="status-orbits"></div><img src="${sprite(targetId)}" alt="${creatureName(targetId)}"></div><div class="fighter player" id="fighter-player"><div class="status-orbits"></div><img src="${sprite(move.owner)}" alt="${creatureName(move.owner)}"></div></div><div class="theater-head"><span>${t('bestiary.theaterHint')}</span><h2 id="theater-title">${t('bestiary.theater')}</h2><b>${creatureName(move.owner)} · ${t(`move.${moveId}`)}</b><small>${t(`move.effect.${moveId}`)}</small>${moveStatusBadgesHtml(move, 'theater-status-badges')}</div><div class="action-line" id="action-line"></div><div class="theater-actions"><button class="subtle-btn" data-action="replay-theater">↻ ${t('bestiary.replay')}</button><button class="icon-btn" data-action="close-theater" aria-label="${t('app.close')}">✕</button></div></div>`
  );
  if (req !== theaterRequest) return;
  const overlay = screen.querySelector('.move-theater');
  overlay.querySelector('[data-action="close-theater"]').addEventListener('click', closeMoveTheater);
  overlay
    .querySelector('[data-action="replay-theater"]')
    .addEventListener('click', () => runMoveTheater(moveId));
  overlay.querySelector('.theater-backdrop').addEventListener('click', closeMoveTheater);
  overlay.querySelector('[data-action="close-theater"]').focus();
  await sound.unlock();
  if (req !== theaterRequest || screen.dataset.page !== 'bestiary') return;
  runMoveTheater(moveId);
}
function renderBestiary() {
  disposeArena();
  ctx.battleSession = null;
  ctx.previousScreen = 'title';
  screen.dataset.page = 'bestiary';
  screen.className = 'screen';
  const visibleFeatIds = [
      ...CURRENT_FEAT_IDS,
      ...(ctx.save.feats.includes('team_assist') ? ['team_assist'] : []),
    ],
    featGallery = visibleFeatIds
      .map((id) => FEATS[id])
      .map((feat) => {
        const earned = ctx.save.feats.includes(feat.id);
        return `<div class="feat-card ${earned ? 'earned' : 'locked'}"><i>${earned ? feat.icon : '?'}</i><span><b>${earned ? t(`feat.${feat.id}`) : t('feat.unknown')}</b><small>${earned ? t(`feat.effect.${feat.id}`) : t('feat.locked')}</small></span></div>`;
      })
      .join('');
  const cards = CREATURE_IDS.map((id, index) => {
    const c = CREATURES[id],
      a = AFFINITIES[c.affinity],
      unlocked = index < 6 + ctx.save.ladderVictories * 2,
      passive = PASSIVES[c.passive],
      mastery = masteryProgress(ctx.save.mastery[id] || 0),
      signatureId = c.moves.find((moveId) => MOVES[moveId].signature);
    return `<article class="bestiary-card rank-${mastery.rank}" data-class="${c.classId}" style="--card-affinity:${a.color}"><button type="button" class="bestiary-summary" aria-expanded="false" aria-controls="bestiary-detail-${id}"><span class="bestiary-portrait"><img src="${sprite(id)}" alt="" loading="lazy" decoding="async" width="128" height="128"></span><span class="bestiary-identity"><h2>${creatureName(id)}</h2><span class="meta-row"><span class="affinity-chip" style="--chip-color:${a.color}">${affinityIcon(c.affinity)} ${affinityName(c.affinity)}</span><span class="class-chip" style="--class-color:${CLASSES[c.classId].color}">${classIcon(c.classId)} ${className(c.classId)}</span></span><span class="bestiary-key-stats">${t('bestiary.stats', { hp: c.maxHp, attack: c.attack, guard: c.guard, speed: c.speed })}</span><span class="bestiary-signature">✦ ${t(`move.${signatureId}`)}</span></span><span class="bestiary-expand" aria-hidden="true">＋</span></button><div class="bestiary-detail" id="bestiary-detail-${id}" hidden><div class="mastery-mini"><b>${'★'.repeat(mastery.rank)}${'☆'.repeat(5 - mastery.rank)}</b><i><u style="width:${mastery.ratio * 100}%"></u></i></div><div class="class-definition class-chip" style="--class-color:${CLASSES[c.classId].color}">${classIcon(c.classId)} <b>${className(c.classId)}</b><span>${t(`class.effect.${c.classId}`)}</span></div><div class="passive-line"><b>${passive.icon} ${t(`passive.${c.passive}`)}</b><span>${t(`passive.effect.${c.passive}`)}</span></div><p class="lore ${unlocked ? '' : 'locked-lore'}">${unlocked ? t(`lore.${id}`) : `🔒 ${t('bestiary.loreLocked')}`}</p><strong>${t('bestiary.moves')}</strong><div class="move-list">${c.moves.map((moveId) => `<button type="button" data-preview-move="${moveId}" class="theater-trigger ${MOVES[moveId].signature ? 'signature-entry' : ''}" aria-label="${t('bestiary.preview', { move: t(`move.${moveId}`) })}"><strong>${MOVES[moveId].signature ? '✦ ' : ''}${t(`move.${moveId}`)}</strong><span>${t(`move.effect.${moveId}`)}${moveStatusBadgesHtml(MOVES[moveId])}</span></button>`).join('')}</div></div></article>`;
  }).join('');
  const earnedVisible = visibleFeatIds.filter((id) => ctx.save.feats.includes(id)).length;
  screen.innerHTML = `<div class="shell">${topbar()}<div class="page-head"><div><span class="eyebrow">${CREATURE_IDS.length} / ${CREATURE_IDS.length}</span><h1>${t('bestiary.title')}</h1><p>${t('bestiary.subtitle')}</p></div></div><details class="record-hall" open><summary><span class="eyebrow">${t('record.hall')}</span><strong>${t('record.hall')}</strong></summary><div class="record-hall-content"></div></details><details class="feat-hall-disclosure" open><summary><span class="eyebrow">${earnedVisible}/${visibleFeatIds.length}</span><strong>${t('feat.gallery')}</strong></summary><section class="feat-hall"><div><span class="eyebrow">${earnedVisible}/${visibleFeatIds.length}</span><h2>${t('feat.gallery')}</h2></div><div class="feat-gallery">${featGallery}</div></section></details><div class="bestiary-grid">${cards}</div></div>`;
  installBestiaryDisclosureSync();
  bindCommon();
  screen.querySelectorAll('.bestiary-summary').forEach((button) =>
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true',
        detail = document.getElementById(button.getAttribute('aria-controls'));
      button.setAttribute('aria-expanded', String(!expanded));
      button.closest('.bestiary-card')?.classList.toggle('expanded', !expanded);
      button.querySelector('.bestiary-expand').textContent = expanded ? '＋' : '−';
      detail.hidden = expanded;
    })
  );
}

registerRoutes({ closeMoveTheater, runMoveTheater, openMoveTheater, renderBestiary });
