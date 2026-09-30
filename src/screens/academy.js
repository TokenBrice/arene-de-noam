import { ctx, registerRoutes, route } from '../app/context.js';

const {
  AFFINITIES,
  AFFINITY_ORDER,
  AFFINITY_TRIANGLES,
  ARENAS,
  ARENA_WEATHER,
  CLASSES,
  CLASS_ORDER,
  CREATURES,
  MOVES,
  STATUS_DEFINITIONS,
  STATUS_DISPLAY_ORDER,
  statusIcon,
  t,
  screen,
  sound,
  sprite,
  creatureName,
  affinityName,
  affinityIcon,
  classIcon,
  className,
  disposeArena,
  topbar,
} = ctx;
const { arenaWeatherHtml, bindCommon, icon, renderBestiary } = route;

const TRIANGLE_KEYS = ['elemental', 'tactical'];
// Node centres in each triangle's 150 × 162 box: top, bottom right, bottom
// left, so every triangle reads clockwise in its "beats" order. The top node's
// name sits above its disc, the bottom ones below.
const VERTICES = [
  [75, 46],
  [126, 118],
  [24, 118],
];
const NODE_RADIUS = 22;
const CORE_ICONS = ['heart', 'swap', 'refresh', 'sword', 'speed', 'sparkle', 'star', 'mountain'];

// Type selected in the wheel; defaults to the lead of the player's team.
let selectedType = null;

function triangleOf(type) {
  const triangle = AFFINITY_TRIANGLES.find((members) => members.includes(type)),
    index = triangle.indexOf(type);
  return { triangle, beats: triangle[(index + 1) % 3], beatenBy: triangle[(index + 2) % 3] };
}

// One arrow per edge, stopping short of both discs, with its head drawn in the
// same path so it takes the edge's colour.
function edgePath(from, to) {
  const [x1, y1] = VERTICES[from],
    [x2, y2] = VERTICES[to],
    length = Math.hypot(x2 - x1, y2 - y1),
    ux = (x2 - x1) / length,
    uy = (y2 - y1) / length,
    gap = NODE_RADIUS + 4,
    tipX = x2 - ux * gap,
    tipY = y2 - uy * gap,
    point = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  return `M${point(x1 + ux * gap, y1 + uy * gap)}L${point(tipX, tipY)}M${point(tipX - ux * 8 - uy * 6, tipY - uy * 8 + ux * 6)}L${point(tipX, tipY)}L${point(tipX - ux * 8 + uy * 6, tipY - uy * 8 - ux * 6)}`;
}

function triangleHtml(triangle, key) {
  const edges = triangle
      .map(
        (type, index) =>
          `<path class="type-edge" data-from="${type}" data-to="${triangle[(index + 1) % 3]}" d="${edgePath(index, (index + 1) % 3)}"/>`
      )
      .join(''),
    nodes = triangle
      .map((type, index) => {
        const [x, y] = VERTICES[index];
        return `<button type="button" class="type-node${index === 0 ? ' top' : ''}" data-academy-type="${type}" aria-pressed="false" style="--node-x:${x}px;--node-y:${y}px;--type-color:${AFFINITIES[type].color}"><span class="type-node-disc">${affinityIcon(type)}</span><b>${affinityName(type)}</b></button>`;
      })
      .join('');
  return `<div class="type-tri ${key}" role="group" aria-label="${t(`academy.triangle.${key}`)}"><svg class="type-edges" viewBox="0 0 150 162" aria-hidden="true" focusable="false">${edges}</svg>${nodes}</div>`;
}

function typeChip(type) {
  return `<span class="type-chip" style="--type-color:${AFFINITIES[type].color}">${affinityIcon(type)}${affinityName(type)}</span>`;
}

function detailHtml(type) {
  const { triangle, beats, beatenBy } = triangleOf(type),
    others = AFFINITY_ORDER.filter((id) => !triangle.includes(id)),
    weather = ARENAS.map((arena) => ({ arena, value: ARENA_WEATHER[arena][type] })).filter(
      ({ value }) => value
    ),
    weatherRows = weather
      .sort((a, b) => b.value - a.value)
      .map(({ arena, value }) => {
        const up = value > 1,
          percent = Math.round(Math.abs(value - 1) * 100);
        return `<li class="${up ? 'good' : 'bad'}">${icon(up ? 'arrow-up' : 'arrow-down')}<span>${t(up ? 'academy.weatherUp' : 'academy.weatherDown', { arena: t(`arena.${arena}`) })}</span><b class="num">${t('battle.weatherTag', { value: `${up ? '+' : '−'}${percent}` })}</b></li>`;
      })
      .join(''),
    coverage = Object.entries(MOVES)
      .filter(([, move]) => move.affinity === type && CREATURES[move.owner].affinity !== type)
      .map(
        ([moveId, move]) =>
          `<li><img src="${sprite(move.owner)}" alt="" width="128" height="128"><b>${creatureName(move.owner)}</b><small>${t(`move.${moveId}`)}</small></li>`
      )
      .join('');
  return `<div class="type-detail" style="--type-color:${AFFINITIES[type].color}"><h3 class="type-detail-title">${affinityIcon(type)}<span>${affinityName(type)}</span></h3><ul class="type-matchups"><li class="good">${icon('arrow-up')}<span><b>${t('academy.strongVs')}</b>${typeChip(beats)}<small>${t('academy.strongNote')}</small></span><em class="num">${t('academy.mult.double')}</em></li><li class="bad">${icon('arrow-down')}<span><b>${t('academy.weakVs')}</b>${typeChip(beatenBy)}<small>${t('academy.weakNote')}</small></span><em class="num">${t('academy.mult.half')}</em></li><li class="neutral">${icon('swap')}<span><b>${t('academy.neutralVs')}</b><span class="type-chips">${others.map(typeChip).join('')}</span></span><em class="num">${t('academy.mult.same')}</em></li></ul><ul class="type-weather">${weatherRows}</ul><div class="type-coverage"><p><b>${t('academy.coverageTitle')}</b> ${t('academy.coverageFor', { type: affinityName(type) })}</p><ul>${coverage}</ul></div></div>`;
}

function selectType(type, { announce = true } = {}) {
  selectedType = type;
  screen.querySelectorAll('[data-academy-type]').forEach((node) => {
    const pressed = node.dataset.academyType === type;
    node.classList.toggle('selected', pressed);
    node.setAttribute('aria-pressed', String(pressed));
  });
  const { beats, beatenBy } = triangleOf(type);
  screen.querySelectorAll('.type-edge').forEach((edge) => {
    const role =
      edge.dataset.from === type && edge.dataset.to === beats
        ? 'good'
        : edge.dataset.from === beatenBy && edge.dataset.to === type
          ? 'bad'
          : '';
    edge.setAttribute('class', `type-edge${role ? ` ${role}` : ''}`);
  });
  screen.querySelector('.type-wheel').dataset.selected = type;
  screen.querySelector('.type-detail-slot').innerHTML = detailHtml(type);
  if (announce) sound.ui();
}

function renderAcademy() {
  disposeArena();
  ctx.battleSession = null;
  ctx.selection = null;
  screen.dataset.page = 'academy';
  screen.className = 'screen';
  selectedType ??= CREATURES[ctx.save.lastTeam[0]]?.affinity ?? AFFINITY_ORDER[0];
  const wheel = `<section class="academy-card academy-types" aria-labelledby="academy-types-title"><h2 id="academy-types-title">${t('academy.core.3.title')}</h2><p class="academy-hint">${icon('info')}<span>${t('academy.wheelHint')}</span></p><div class="type-wheel">${AFFINITY_TRIANGLES.map((triangle, index) => triangleHtml(triangle, TRIANGLE_KEYS[index])).join('')}</div><p class="academy-rule">${t('academy.core.3.desc')}</p><div class="type-detail-slot" aria-live="polite"></div></section>`;
  const weather = `<section class="academy-card academy-weather" aria-labelledby="academy-weather-title"><h2 id="academy-weather-title">${t('academy.weatherTitle')}</h2><p>${t('academy.weatherText')}</p><ul>${ARENAS.map((arena) => `<li>${arenaWeatherHtml(arena)}</li>`).join('')}</ul></section>`;
  const statuses = STATUS_DISPLAY_ORDER.map((id) => {
    const meta = STATUS_DEFINITIONS[id],
      polarity = meta.positive ? 'positive' : 'negative';
    return `<article class="academy-status ${polarity}${meta.lightInk ? ' light-ink' : ''}" data-status="${id}" data-icon="${meta.iconKey}" style="--status-color:${meta.color}"><i>${statusIcon(id)}</i><span><em>${icon(meta.positive ? 'arrow-up' : 'arrow-down')}${t(`status.polarity.${polarity}`)}</em><b>${t(`status.${id}`)}${meta.stackable ? ` <u>×${meta.maxStacks}</u>` : ''}</b><small>${t(`status.effect.${id}`)}</small></span></article>`;
  }).join('');
  const statusSection = `<section class="academy-card academy-statuses" aria-labelledby="academy-status-title"><h2 id="academy-status-title">${t('academy.statuses')}</h2><div class="academy-status-grid">${statuses}</div></section>`;
  const essentials = CORE_ICONS.map(
    (name, index) =>
      `<li class="academy-core">${icon(name)}<span><b>${t(`academy.core.${index + 1}.title`)}</b><small>${t(`academy.core.${index + 1}.desc`)}</small></span></li>`
  ).join('');
  const essentialSection = `<section class="academy-card academy-essentials" aria-labelledby="academy-core-title"><h2 id="academy-core-title">${t('academy.essentials')}</h2><ol>${essentials}</ol></section>`;
  const classes = CLASS_ORDER.map(
    (id) =>
      `<li class="academy-class" style="--class-color:${CLASSES[id].color}"><i>${classIcon(id)}</i><span><b>${className(id)}</b><small>${t(`class.effect.${id}`)}</small></span></li>`
  ).join('');
  const classSection = `<section class="academy-card academy-classes" aria-labelledby="academy-class-title"><h2 id="academy-class-title">${t('academy.classes')}</h2><ul>${classes}</ul></section>`;
  screen.innerHTML = `<div class="shell academy-page">${topbar(t('academy.title'))}<p class="academy-lede">${t('academy.subtitle')}</p>${essentialSection}${wheel}${weather}${statusSection}${classSection}<div class="sticky-cta"><button type="button" class="primary-btn wide" data-action="academy-bestiary">${icon('book')}<span>${t('academy.openBestiary')}</span></button></div></div>`;
  bindCommon();
  selectType(selectedType, { announce: false });
  screen.querySelector('.type-wheel').addEventListener('click', (event) => {
    const node = event.target.closest('[data-academy-type]');
    if (node) selectType(node.dataset.academyType);
  });
  screen.querySelector('[data-action="academy-bestiary"]').addEventListener('click', () => renderBestiary());
}

registerRoutes({ renderAcademy });
