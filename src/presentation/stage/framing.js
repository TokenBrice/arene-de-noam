// Framing solver: fits the camera and both battle pads to the `.battle-stage` box.
//
// The composition is solved in screen space first (contract §7.6): each side gets a target feet
// point and a target canvas height as fractions of the stage, the feet are unprojected onto the
// pad plane, and each side's canvas world height follows from its depth. Fighter planes face the
// camera (3B), so a world length L at view depth d spans L·f/d px exactly.
//
// Precedence when constraints collide: (1) the opaque bbox of both fighters (the roster's typical
// extent here; `fitCreatures` slides or shrinks wider outliers) and both pads stay inside the stage
// with margins, (2) the owner's height ranges (`frac`, inside `height`), then the ≈ feet targets move.
import * as THREE from 'three';
import { BACKDROP_K } from './painter.js';

export const PAD_TOP = 0.1;
// Pad radius and visible side height, in units of the side's canvas height.
export const PAD_RADIUS = 0.38;
const PAD_SIDE = 0.045;
// World height of the player's canvas: fixes the scene scale.
const REF_CANVAS = 2.2;
// The solver keeps 4.5 % margins so the showdown push (1 %) still leaves ≥ 4 %.
export const MARGIN = 0.045;
// The far pad's back rim keeps this share of the backdrop wall's radius (floor line in front).
const WALL_CLEAR = 0.99;

// Feet targets (`x`, `y`) are shares of the stage. The player's canvas height is the smaller of
// `frac` × stage height (the owner's range) and `width(aspect)` × stage width; the enemy's is
// `ratio` × the player's. The portrait `width` caps were measured 3 % under the largest share at
// which the near player hides no enemy pixel in any of the 30 × 30 roster pairings (pixel-level
// check at rest with `fitCreatures` and snapping, Gate 3), so portrait phones get the largest
// creatures that never occlude each other. Snapping may only shrink, which keeps that guarantee.
export const PRESETS = Object.freeze({
  // Portrait (w/h < 1.25): diagonal Pokémon staging, player near-left and larger, enemy far-right.
  portrait: {
    fov: 38,
    horizon: 0.3,
    player: {
      x: 0.2,
      y: 0.93,
      frac: 0.66,
      width: [
        [0.5, 0.82],
        [0.58, 0.788],
        [0.62, 0.746],
        [0.68, 0.684],
        [0.7, 0.665],
        [0.72, 0.638],
        [0.736, 0.625],
        [0.755, 0.605],
        [0.77, 0.605],
        [0.79, 0.597],
        [0.82, 0.579],
        [0.92, 0.574],
        [1, 0.553],
        [1.1, 0.552],
        [1.18, 0.539],
        [1.25, 0.528],
      ],
    },
    enemy: { x: 0.8, y: 0.435, ratio: 0.86 },
  },
  // Landscape (and wide desktop stages): pads spread apart.
  wide: {
    fov: 32,
    horizon: 0.4,
    player: { x: 0.26, y: 0.9, frac: 0.625, width: [[1.25, 1]] },
    enemy: { x: 0.74, y: 0.64, ratio: 0.82 },
  },
  // Very wide, short stages (landscape phones, aspect > 3.5).
  ultrawide: {
    fov: 30,
    horizon: 0.36,
    player: { x: 0.3, y: 0.93, frac: 0.78, width: [[3.5, 1]] },
    enemy: { x: 0.7, y: 0.74, ratio: 0.8 },
  },
});
// Texel snapping (§7.6 precedence 3): the far enemy, whose texels are the smallest on screen, may
// shrink by up to this share of its fitted target to land them on whole device px. Shrink only:
// growing could cross the occlusion-safe width caps and lift it into the hierarchy cap of more
// players. The near player is not snapped: its larger texels read evenly, and a snapped-down player
// would lower the hierarchy cap and resize the enemy on switches.
const ENEMY_SNAP = 0.9;
// Visible-height normalisation (see `fitCreatures`): 0 = every creature as tall, 1 = mass only.
const HEIGHT_KEEP = 0.1;
// Near player ≥ 1.15 × the far enemy's visible height in every pairing; the extra 1 % absorbs the
// half-px rounding of the rest anchors.
export const HIERARCHY = 1.16;
// How far a creature too wide for its room may slide off its pad centre, in pad radii, and the
// stage px a slid player keeps from the enemy's zone (both sprites snap to the pixel grid).
const SHIFT = 0.6;
const SLIDE_GUARD = 2;

export function presetFor(aspect) {
  if (aspect < 1.25) return 'portrait';
  return aspect > 3.5 ? 'ultrawide' : 'wide';
}

// Piecewise-linear lookup in an ascending [[x, y], …] table, clamped at both ends.
function lookup(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

const SIDES = ['player', 'enemy'];

// Camera at the origin, `1` above the pad plane, pitched down by `pitch`, looking toward −z.
function makeView(width, height, fov, pitch) {
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(fov) / 2),
    aspect = width / height;
  const forward = new THREE.Vector3(0, -Math.sin(pitch), -Math.cos(pitch)),
    up = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch)),
    right = new THREE.Vector3(1, 0, 0);
  return {
    width,
    height,
    focal: height / 2 / tanHalf,
    // Screen px → point on the plane y = planeY (below the camera).
    ground(sx, sy, planeY = -1) {
      const dir = forward
        .clone()
        .addScaledVector(right, ((2 * sx) / width - 1) * tanHalf * aspect)
        .addScaledVector(up, (1 - (2 * sy) / height) * tanHalf);
      if (dir.y >= -1e-4) return null;
      const t = planeY / dir.y;
      return { point: dir.multiplyScalar(t), depth: t };
    },
    project(point) {
      const d = point.dot(forward);
      return {
        x: ((point.dot(right) / (d * tanHalf * aspect) + 1) / 2) * width,
        y: ((1 - point.dot(up) / (d * tanHalf)) / 2) * height,
        depth: d,
      };
    },
  };
}

// Screen bbox of a pad (top ring plus its visible side) centred on `feet` (solver units).
function padBox(view, feet, radius, side) {
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity },
    p = new THREE.Vector3();
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const dy of [0, -side]) {
      p.set(feet.x + Math.cos(a) * radius, feet.y + dy, feet.z + Math.sin(a) * radius);
      const s = view.project(p);
      box.x0 = Math.min(box.x0, s.x);
      box.x1 = Math.max(box.x1, s.x);
      box.y0 = Math.min(box.y0, s.y);
      box.y1 = Math.max(box.y1, s.y);
    }
  }
  return box;
}

/**
 * Solves the base framing for a stage box.
 * @param {{ width: number, height: number }} rect stage size in CSS px
 * @param {{ halfWidth: number, height: number }} extent design opaque extent in canvas heights
 *   (feet-centred half-width, feet-to-head height) kept inside the margins
 */
export function solveFraming({ width, height }, extent) {
  const W = Math.max(1, width),
    H = Math.max(1, height),
    preset = presetFor(W / H),
    P = PRESETS[preset];
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(P.fov) / 2),
    pitch = Math.atan((0.5 - P.horizon) * 2 * tanHalf),
    view = makeView(W, H, P.fov, pitch),
    mx = MARGIN * W,
    my = MARGIN * H;
  const size = Math.min(P.player.frac, (lookup(P.player.width, W / H) * W) / H),
    state = {
      player: { x: P.player.x * W, y: P.player.y * H, frac: size },
      enemy: { x: P.enemy.x * W, y: P.enemy.y * H, frac: size * P.enemy.ratio },
    };
  // Iterative repair: move feet first, shrink only when moving cannot fit.
  const place = (side) => {
    const s = state[side];
    for (let i = 0; i < 48; i++) {
      const hit = view.ground(s.x, s.y);
      if (!hit) {
        s.y = Math.min(H - my, s.y + 0.05 * H);
        continue;
      }
      const px = s.frac * H,
        worldCanvas = (px * hit.depth) / view.focal,
        pad = padBox(view, hit.point, PAD_RADIUS * worldCanvas, PAD_SIDE * worldCanvas),
        hw = Math.max(extent.halfWidth * px, (pad.x1 - pad.x0) / 2);
      let moved = false;
      // Horizontal: shift inside, or shrink when wider than the stage.
      if (2 * hw > W - 2 * mx) {
        s.frac *= (W - 2 * mx) / (2 * hw);
        s.x = W / 2;
        moved = true;
      } else if (s.x - hw < mx) {
        s.x = mx + hw;
        moved = true;
      } else if (s.x + hw > W - mx) {
        s.x = W - mx - hw;
        moved = true;
      }
      // Vertical (one repair per pass, the pad box depends on y): the pad's front edge inside the
      // bottom margin, then the head inside the top one (move down while the pad has room), then
      // the pad's back rim in front of the backdrop wall (a cylinder around the camera, BACKDROP_K ×
      // its height; the player's canvas fixes the scale, so the far pad is checked once it is known).
      const top = s.y - extent.height * px,
        room = H - my - pad.y1,
        wall = state.player.worldCanvas
          ? BACKDROP_K * (1 + (PAD_TOP * state.player.worldCanvas) / REF_CANVAS) * WALL_CLEAR
          : Infinity;
      if (room < -0.5) {
        s.y += room;
        moved = true;
      } else if (top < my - 0.5) {
        if (room > 1) s.y += Math.min(room * 0.8, my - top);
        else s.frac *= (s.y - my) / (extent.height * px);
        moved = true;
      } else if (Math.hypot(hit.point.x, hit.point.z) + PAD_RADIUS * worldCanvas > wall && room > 1) {
        s.y += Math.min(room * 0.8, 0.0015 * H);
        moved = true;
      }
      Object.assign(s, { depth: hit.depth, point: hit.point, px, worldCanvas, hw });
      if (!moved) return;
    }
  };
  SIDES.forEach(place);
  // Scene scale: the player's canvas is REF_CANVAS world units tall.
  const scale = REF_CANVAS / state.player.worldCanvas,
    camHeight = scale + PAD_TOP;
  const mid = new THREE.Vector2(
    ((state.player.point.x + state.enemy.point.x) / 2) * scale,
    ((state.player.point.z + state.enemy.point.z) / 2) * scale
  );
  const camera = {
    fov: P.fov,
    position: new THREE.Vector3(-mid.x, camHeight, -mid.y),
    pitch,
  };
  const sides = {};
  for (const side of SIDES) {
    const s = state[side],
      canvasHeight = s.worldCanvas * scale;
    sides[side] = {
      feet: new THREE.Vector3(s.point.x * scale - mid.x, PAD_TOP, s.point.z * scale - mid.y),
      canvasHeight,
      padRadius: PAD_RADIUS * canvasHeight,
      screen: { x: s.x, y: s.y },
      frac: s.frac,
      depth: s.depth * scale,
    };
  }
  // Court: centred between the pads, wide enough for both pools and for the stage's bottom edge.
  let radius = 0;
  for (const side of SIDES)
    radius = Math.max(
      radius,
      Math.hypot(sides[side].feet.x, sides[side].feet.z) + sides[side].padRadius * 1.9
    );
  for (const sx of [0, W / 2, W]) {
    const hit = view.ground(sx, H);
    if (hit)
      radius = Math.max(radius, Math.hypot(hit.point.x * scale - mid.x, hit.point.z * scale - mid.y) * 1.04);
  }
  const axis = new THREE.Vector2(
    sides.enemy.feet.x - sides.player.feet.x,
    sides.enemy.feet.z - sides.player.feet.z
  ).normalize();
  return {
    preset,
    width: W,
    height: H,
    design: extent,
    focal: view.focal,
    camera,
    sides,
    court: { radius, axis },
    wall: { radius: BACKDROP_K * camHeight, x: camera.position.x, z: camera.position.z, height: camHeight },
  };
}

/**
 * Canvas world heights, snapping ranges and feet shifts for the two creatures on the pads
 * (contract §7.6). Visible heights are normalised per side: a creature keeps `HEIGHT_KEEP` of its
 * own height difference from the design creature, so a squat creature is not dwarfed by a tall one.
 * Then, in precedence order:
 * 1. the opaque bbox stays inside the stage margins. A creature too wide for its pad's room shrinks,
 *    except the near player (always the left pad), which may first slide right off its pad centre
 *    (≤ `SHIFT` pad radii; the pad never moves) while its bbox stays clear of every enemy pixel:
 *    below the enemy's feet or left of the enemy's room (the enemy never slides);
 * 2. hierarchy: the near player stands ≥ `HIERARCHY` × the far enemy's visible height, so the enemy
 *    gives way for the few players the stage cannot grow;
 * 3. texel snapping, enemy only: the largest height ≤ that target, and ≥ `ENEMY_SNAP` × it, whose
 *    texels span a whole number of device px. The returned range pins the height for the fighters.
 * @param {object} framing `solveFraming` result
 * @param {{ player?: object, enemy?: object }} extents rest extents of the current creatures
 *   (`restExtent` plus `rows`, the opaque bbox height in texels); a missing side uses the design extent
 * @param {{ devicePx?: number }} [options] drawing-buffer px per stage px; 0 when the browser rescales
 *   the buffer (no texel lands on a whole device px then)
 * @returns {{ player: Fit, enemy: Fit }} `Fit` = `{ canvasHeight, range: [lo, hi], shift }` in world
 *   units; `shift` moves the feet along +x
 */
export function fitCreatures(framing, extents, { devicePx = 0 } = {}) {
  const { width: W, height: H, design, sides } = framing,
    mx = MARGIN * W,
    my = MARGIN * H,
    room = (s) => [s.screen.x - mx, W - mx - s.screen.x],
    enemy = sides.enemy.screen,
    enemyLeft = enemy.x - Math.min(...room(sides.enemy)),
    fits = {};
  // Sizes below are screen px of the side's canvas height at the feet.
  const fit = (side, extent, capPx) => {
    const s = sides[side],
      base = s.frac * H,
      [left, right] = room(s),
      { halfWidth, height, rows } = extent,
      // Head inside the top margin, then the width room (centred or slid).
      upright = (s.screen.y - my) / height,
      centred = Math.min(upright, Math.min(left, right) / halfWidth),
      slid =
        side === 'player'
          ? Math.min(
              upright,
              (left + SHIFT * PAD_RADIUS * base) / halfWidth,
              (left + right) / 2 / halfWidth,
              Math.max(
                (s.screen.y - enemy.y - SLIDE_GUARD) / height,
                (enemyLeft - mx - SLIDE_GUARD) / 2 / halfWidth
              )
            )
          : 0,
      norm = base * (design.height / height) ** (1 - HEIGHT_KEEP);
    // Normalised size inside the room; the enemy's shrinks onto whole device px per texel when the
    // window allows. The hierarchy cap then clamps it only where it binds (no re-snap), so the far
    // enemy keeps one size for every player the stage lets stand tall enough.
    const target = Math.min(norm, Math.max(centred, slid)),
      whole =
        side === 'enemy' && devicePx > 0 && rows
          ? (Math.floor((target * height * devicePx) / rows) * rows) / (devicePx * height)
          : 0,
      px = Math.min(whole >= ENEMY_SNAP * target ? whole : target, capPx / height);
    const world = s.canvasHeight / base;
    fits[side] = {
      canvasHeight: px * world,
      range: [px * world * (1 - 1e-6), px * world * (1 + 1e-6)],
      shift: Math.max(0, px * halfWidth - left) * world,
    };
    return px * height;
  };
  const player = fit('player', extents.player ?? design, Infinity);
  fit('enemy', extents.enemy ?? design, player / HIERARCHY);
  return fits;
}
