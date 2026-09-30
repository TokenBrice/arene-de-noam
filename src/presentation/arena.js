// ArenaScene v2, "Stade Lumière" (docs/battle-presentation.md §7): a baked, unlit stadium
// diorama fitted to the `.battle-stage` box. The canvas is the stage; one camera frames both
// battle pads (diagonal Pokémon staging in portrait, spread pads when wide), shots run on the
// session fx-clock, and the fighters (3B) and the GPU FX layer (3C-1) live in the same scene.
import * as THREE from 'three';
import { AFFINITIES } from '../data/affinities.js';
import { CREATURES } from '../data/creatures.js';
import { SPRITE_METRICS } from '../data/sprite-metrics.js';
import { fxRandom, fxSeed } from '../battle-ui/beats.js';
import { FighterLayer, restExtent } from './fighters.js';
import { FxLayer } from './fx-layer.js';
import { THEMES, themeFor } from './stage/themes.js';
import {
  CROWD_BAND,
  PLATE_AZ,
  PLATE_EL_MAX,
  PLATE_EL_MIN,
  paintBackdrop,
  paintCourt,
  paintPad,
} from './stage/painter.js';
import { PAD_TOP, fitCreatures, solveFraming } from './stage/framing.js';
import {
  canvasTexture,
  pointsMaterial,
  shaftMaterial,
  sharedUniforms,
  stageMaterial,
} from './stage/materials.js';
import { CameraRig, SHOTS } from './stage/rig.js';

const SIDES = ['player', 'enemy'];
const POINTS = ['feet', 'center', 'head'];
// The framing is solved for the roster, not the current pair, so pads never jump on a switch: the
// median creature fits at the owner's size; `fitCreatures` sizes the current pair on those pads
// (§7.6 precedence 1, then the near-player hierarchy).
const DESIGN_EXTENT = (() => {
  const extents = Object.keys(SPRITE_METRICS).map(restExtent),
    median = (key) => extents.map((e) => e[key]).sort((a, b) => a - b)[Math.floor((extents.length - 1) / 2)];
  return { halfWidth: median('halfWidth'), height: median('height') };
})();
const BULB_POOL = 20;
const MOTE_CAPACITY = 170;
const CHEER_MS = 1300;
const PAD_REST_LIFT = 1;
const PAD_DIM_LIFT = 0.35;
// A standing enemy eases to a new hierarchy cap over this many fx-ms when the player switches.
const ENEMY_EASE_MS = 250;

// Frame-rate-independent exponential approach that settles exactly on target.
function approach(value, target, rate) {
  const delta = target - value;
  return Math.abs(delta) < 1e-3 ? target : value + delta * (1 - Math.exp(-rate));
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
// Pad light-up during the intro: dim, a bright flash, then settle on the rest level.
const padFlash = (u) =>
  u < 0
    ? PAD_DIM_LIFT
    : u < 1
      ? PAD_DIM_LIFT + 1.1 * easeOutCubic(u)
      : 1.45 - 0.45 * Math.min(1, (u - 1) / 1.4);

// Camera-centred panorama band: vertices at (sin az, tan el, −cos az), exact angular uv.
function panoramaGeometry() {
  const cols = 72,
    rows = 14,
    positions = [],
    uvs = [],
    index = [];
  for (let r = 0; r <= rows; r++) {
    const el = THREE.MathUtils.degToRad(PLATE_EL_MIN + ((PLATE_EL_MAX - PLATE_EL_MIN) * r) / rows);
    for (let c = 0; c <= cols; c++) {
      const az = THREE.MathUtils.degToRad(-PLATE_AZ + (2 * PLATE_AZ * c) / cols);
      positions.push(Math.sin(az), Math.tan(el), -Math.cos(az));
      uvs.push(c / cols, r / rows);
    }
  }
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c,
        b = a + cols + 1;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
  geometry.setIndex(index);
  return geometry;
}

// Motes (a unit box, animated in the vertex shader) after the crowd flash-bulb pool.
function pointsGeometry(seed) {
  const count = BULB_POOL + MOTE_CAPACITY,
    rnd = fxRandom(seed),
    position = new Float32Array(count * 3),
    aSeed = new Float32Array(count),
    aKind = new Float32Array(count),
    aFire = new Float32Array(count).fill(-1000);
  for (let i = 0; i < count; i++) {
    const bulb = i < BULB_POOL;
    aKind[i] = bulb ? 1 : 0;
    aSeed[i] = rnd();
    position[i * 3] = rnd();
    position[i * 3 + 1] = bulb ? CROWD_BAND[0] + 0.4 + rnd() * (CROWD_BAND[1] - CROWD_BAND[0] - 0.8) : rnd();
    position[i * 3 + 2] = rnd();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
  geometry.setAttribute('aKind', new THREE.BufferAttribute(aKind, 1));
  geometry.setAttribute('aFire', new THREE.BufferAttribute(aFire, 1).setUsage(THREE.DynamicDrawUsage));
  return geometry;
}

export class ArenaScene {
  constructor(
    canvas,
    theme = 'crystal',
    { quality, governor = null, reducedMotion = false, highContrast = false, testAnimationScale = 1 } = {}
  ) {
    this.canvas = canvas;
    this.stage = canvas.parentElement;
    this.themeId = themeFor(theme);
    this.theme = THEMES[this.themeId];
    this.reducedMotion = reducedMotion;
    this.instant = testAnimationScale === 0;
    this.quality = quality;
    this.applyProfile(quality.arena);
    this.disposed = false;
    this.paused = false;
    this.clock = null;
    this.lastFx = null;
    this.lastRealAt = 0;
    this.realTime = 0;
    this.moteTime = 0;
    this.tension = 0;
    this.targetTension = 0;
    this.showdown = 0;
    this.targetShowdown = 0;
    this.grade = { saturation: 1, exposure: 0, contrast: 1 };
    this.gradeTween = null;
    this.gradeKey = '';
    this.cheerLevel = 0;
    this.bulbsUntil = 0;
    this.cheerSerial = 0;
    this.shotRecord = null;
    this.creatures = { player: null, enemy: null };
    this.cachedAnchors = null;
    this.rect = null;
    this.enemyLayout = null;
    this.enemyEase = null;
    this.framing = null;
    // Frame governor: activeFps while anything moves, ambientFps otherwise (2A values); the quality
    // governor samples this loop's own animation frames.
    this.governor = governor;
    this.lastFrameAt = 0;
    this.nextRender = 0;
    this.frame = undefined;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: this.profile.antialias,
        alpha: false,
        powerPreference: this.profile.powerPreference,
      });
    } catch (error) {
      throw new Error('WEBGL_UNAVAILABLE', { cause: error });
    }
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(this.theme.sky[0]);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 1000);
    this.restCamera = this.camera.clone();
    this.rig = new CameraRig(this.camera);
    this.projected = new THREE.Vector3();
    this.animateBound = this.animate.bind(this);
    this.buildStage();
    this.fighters = new FighterLayer({
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      stage: this.stage,
      quality,
      reducedMotion,
      highContrast,
      testAnimationScale,
      wake: () => this.wake(),
      onPlaced: (side, creatureId) => this.placed(side, creatureId),
    });
    this.fighters.setLight({
      rim: this.theme.rim,
      rimAmount: this.theme.rimAmount,
      lightDir: [0, 1],
      tint: this.theme.tint,
    });
    this.fx = new FxLayer({
      scene: this.scene,
      worldAnchor: (side, point, out) => this.worldAnchor(side, point, out),
      quality,
      reducedMotion,
      testAnimationScale,
      wake: () => this.wake(),
    });
    const screen = canvas.closest('.battle-screen');
    screen?.style.setProperty('--arena-sky-top', this.theme.sky[0]);
    screen?.style.setProperty('--arena-sky-bottom', this.theme.sky[1]);
    screen?.style.setProperty('--arena-accent', this.theme.glow);
    this.onVisibilityChange = () => {
      if (this.disposed) return;
      if (document.hidden) this.stopLoop();
      else this.wake();
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.contextLost = (event) => {
      event.preventDefault();
      canvas.dispatchEvent(new CustomEvent('arena-context-lost', { bubbles: true }));
    };
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.fitToStage(this.stage.getBoundingClientRect());
    this.resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => this.fitToStage(this.stage.getBoundingClientRect()))
        : null;
    this.resizeObserver?.observe(this.stage);
    this.governor?.attach(this);
    this.wake();
  }

  /* ------------------------------------------------------------------------------ building */

  buildStage() {
    const t = this.theme,
      shared = (this.shared = sharedUniforms());
    this.textures = {
      plate: canvasTexture(paintBackdrop(t, this.themeId)),
      court: canvasTexture(paintCourt(t, this.themeId)),
    };
    // Backdrop plate: a camera-centred panorama band (sky, landmark, stands, towers, LED wall).
    const backdrop = stageMaterial(shared, 0);
    backdrop.uniforms.map.value = this.textures.plate;
    backdrop.uniforms.uCrowd.value.set(
      (CROWD_BAND[0] - PLATE_EL_MIN) / (PLATE_EL_MAX - PLATE_EL_MIN),
      (CROWD_BAND[1] - PLATE_EL_MIN) / (PLATE_EL_MAX - PLATE_EL_MIN)
    );
    this.backdrop = new THREE.Mesh(panoramaGeometry(), backdrop);
    this.backdrop.renderOrder = -3;
    this.backdrop.frustumCulled = false;
    // Floor: court disc + apron to the stands, dynamic pad pools, glossy reflection on mid/high.
    const floor = stageMaterial(shared, 1);
    floor.uniforms.map.value = this.textures.court;
    floor.uniforms.uPlate.value = this.textures.plate;
    floor.uniforms.uPlateAz.value.set(-PLATE_AZ, PLATE_AZ);
    floor.uniforms.uPlateEl.value.set(PLATE_EL_MIN, PLATE_EL_MAX);
    floor.uniforms.uPool.value.set(t.glow);
    floor.uniforms.uApron.value.set(t.apron).lerp(new THREE.Color(t.court.b), 0.55);
    floor.uniforms.uGloss.value = t.court.gloss;
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 128).rotateX(-Math.PI / 2), floor);
    this.floor.renderOrder = -2;
    this.floor.frustumCulled = false;
    // Battle pads: a unit cylinder per side, affinity rim painted into its top texture.
    const padGeometry = new THREE.CylinderGeometry(1, 1, 1, 64, 1);
    this.pads = {};
    for (const side of SIDES) {
      const material = stageMaterial(shared, 2),
        canvas = paintPad(document.createElement('canvas'), t, t.glow),
        texture = canvasTexture(canvas);
      material.uniforms.map.value = texture;
      material.uniforms.uSide.value.set(t.pad.side);
      material.uniforms.uRim.value.set(t.glow);
      const mesh = new THREE.Mesh(padGeometry, material);
      mesh.renderOrder = -1;
      this.pads[side] = { mesh, material, canvas, texture, lift: PAD_REST_LIFT };
    }
    // Atmosphere: motes + flash-bulbs (one draw), high-tier light shafts (one draw).
    this.points = new THREE.Points(
      pointsGeometry(fxSeed('stage', this.themeId, 'points')),
      pointsMaterial(shared, t)
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    const shaftGeometry = new THREE.BufferGeometry();
    shaftGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24), 3));
    shaftGeometry.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2)
    );
    shaftGeometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    this.shafts = new THREE.Mesh(shaftGeometry, shaftMaterial(shared, t));
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 4;
    this.scene.add(
      this.backdrop,
      this.floor,
      this.pads.player.mesh,
      this.pads.enemy.mesh,
      this.points,
      this.shafts
    );
    this.applyTierLooks();
  }

  applyProfile(profile) {
    this.profile = profile;
    // Reduced motion has no ambient motion to show, so the loop stops entirely between effects.
    this.fps = { active: profile.activeFps, ambient: this.reducedMotion ? 0 : profile.ambientFps };
  }

  // Tier-dependent looks: motes, bulb pool, floor reflection, light shafts (§14).
  applyTierLooks() {
    const tier = this.quality.tier;
    this.bulbPool = tier === 'low' ? 12 : BULB_POOL;
    this.points.geometry.setDrawRange(0, BULB_POOL + Math.min(MOTE_CAPACITY, this.profile.dust));
    this.floor.material.uniforms.uReflect.value = tier === 'low' ? 0 : 1;
    this.shafts.visible = tier === 'high';
  }

  /* ------------------------------------------------------------------------------ layout */

  // Sizes the drawing buffer, solves the framing, places pads and fighters, recomputes and writes
  // the anchors (§7.2–7.3) and renders one frame.
  fitToStage(stageRect, { force = false } = {}) {
    if (this.disposed) return this.cachedAnchors;
    const width = Math.max(1, Math.round(stageRect.width)),
      height = Math.max(1, Math.round(stageRect.height)),
      cap = width * height > 500000 ? this.profile.largeCanvasPixelRatio : this.profile.maxPixelRatio,
      ratio = Math.min(globalThis.devicePixelRatio || 1, cap);
    if (!force && this.rect?.width === width && this.rect?.height === height && this.rect.ratio === ratio)
      return this.cachedAnchors;
    this.rect = { width, height, ratio };
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    // Integer upscale of a DPR-capped buffer stays crisp (pixel sprites) instead of bilinear.
    this.canvas.style.imageRendering = ratio < (globalThis.devicePixelRatio || 1) ? 'pixelated' : '';
    const framing = (this.framing = solveFraming({ width, height }, DESIGN_EXTENT));
    for (const cam of [this.camera, this.restCamera]) {
      cam.aspect = width / height;
      cam.near = framing.wall.height * 0.05;
      cam.far = framing.wall.radius * 3;
    }
    this.rig.setBase(framing.camera, new THREE.Vector3(0, PAD_TOP, 0));
    this.rig.showdown = this.showdown;
    this.rig.updateRest();
    this.rig.applyRest(this.camera);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.placeStage(framing);
    const { player, enemy } = this.layout();
    this.fighters.setLayout({ player });
    this.layoutEnemy(enemy, false);
    this.refreshAnchors();
    this.rig.step(0);
    this.renderFrame();
    return this.cachedAnchors;
  }

  placeStage(framing) {
    const { wall, court, sides } = framing;
    this.backdrop.position.set(wall.x, wall.height, wall.z);
    this.backdrop.scale.setScalar(wall.radius);
    this.floor.position.set(wall.x, 0, wall.z);
    this.floor.scale.set(wall.radius * 1.02, 1, wall.radius * 1.02);
    const u = this.floor.material.uniforms;
    u.uWall.value.set(wall.x, wall.height, wall.z);
    u.uWallRadius.value = wall.radius;
    u.uCourtRadius.value = court.radius;
    u.uCourtAxis.value.copy(court.axis);
    const shaft = this.shafts.geometry.attributes.position,
      right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.rig.base.quaternion),
      toCamera = new THREE.Vector3();
    SIDES.forEach((side, i) => {
      const s = sides[side],
        pad = this.pads[side],
        depth = Math.max(0.1, PAD_TOP + 0.045 * s.canvasHeight);
      pad.mesh.position.set(s.feet.x, PAD_TOP - depth / 2, s.feet.z);
      pad.mesh.scale.set(s.padRadius, depth, s.padRadius);
      u[side === 'player' ? 'uPadP' : 'uPadE'].value.set(s.feet.x, s.feet.z, s.padRadius);
      // Light shaft behind the fighter's plane, wide at the pad, narrow up high.
      toCamera.copy(framing.camera.position).sub(s.feet).setY(0).normalize();
      const base = s.feet.clone().addScaledVector(toCamera, -0.35 * s.padRadius),
        top = base.clone().setY(PAD_TOP + s.canvasHeight * 2.1),
        wBase = s.padRadius * 1.25,
        wTop = s.padRadius * 0.35;
      const corners = [
        base.clone().addScaledVector(right, -wBase),
        base.clone().addScaledVector(right, wBase),
        top.clone().addScaledVector(right, wTop),
        top.clone().addScaledVector(right, -wTop),
      ];
      corners.forEach((c, k) => shaft.setXYZ(i * 4 + k, c.x, c.y, c.z));
    });
    shaft.needsUpdate = true;
    // Motes fill the volume around the court; bulbs sit in the stands inside the view.
    const p = this.points.material.uniforms,
      reach = court.radius * 1.15,
      tall = Math.max(sides.player.canvasHeight, sides.enemy.canvasHeight) * 1.6;
    p.uBoxMin.value.set(-reach, 0, -reach);
    p.uBoxSize.value.set(reach * 2, tall, reach * 1.9);
    p.uWall.value.set(wall.x, wall.height, wall.z);
    p.uWallRadius.value = wall.radius;
    const halfFov = THREE.MathUtils.radToDeg(
      Math.atan(Math.tan(THREE.MathUtils.degToRad(framing.camera.fov / 2)) * (framing.width / framing.height))
    );
    p.uBulbSpan.value.set(-halfFov * 0.92, halfFov * 0.92);
    p.uPixelRatio.value = this.renderer.getPixelRatio();
  }

  // setLayout entries for both sides: feet on the pad (slid when a wide creature needs the room) and
  // canvas heights fitted to the current pair, the enemy's pinned on whole device px per texel when
  // the buffer is not rescaled (§7.6).
  layout() {
    const extent = (id) => {
        if (!id) return null;
        const [, y0, , y1] = SPRITE_METRICS[id].bbox;
        return { ...restExtent(id), rows: y1 - y0 + 1 };
      },
      exact = this.rect.ratio >= (globalThis.devicePixelRatio || 1) - 1e-3,
      fits = fitCreatures(
        this.framing,
        { player: extent(this.creatures.player), enemy: extent(this.creatures.enemy) },
        { devicePx: exact ? this.canvas.height / this.rect.height : 0 }
      ),
      entries = {};
    for (const side of SIDES) {
      const { canvasHeight, range, shift } = fits[side],
        feet = this.framing.sides[side].feet;
      entries[side] = { position: [feet.x + shift, feet.y, feet.z], canvasHeight, canvasRange: range };
    }
    return entries;
  }

  // A creature landed on its pad (3B `onPlaced`): affinity rim, per-creature fit, anchors (§7.3).
  placed(side, creatureId) {
    if (this.disposed) return;
    this.creatures[side] = creatureId;
    const color = AFFINITIES[CREATURES[creatureId]?.affinity]?.color ?? this.theme.glow,
      pad = this.pads[side];
    paintPad(pad.canvas, this.theme, color);
    pad.texture.needsUpdate = true;
    pad.material.uniforms.uRim.value.set(color);
    if (this.framing) {
      // The player's fit never depends on the enemy; the enemy's does on the player (hierarchy).
      const { player, enemy } = this.layout();
      if (side === 'player') this.fighters.setLayout({ player });
      this.layoutEnemy(enemy, side === 'player');
      this.refreshAnchors();
    }
    this.wake();
  }

  // Applies the enemy's fit. When an incoming player moves the hierarchy cap of a standing enemy,
  // the enemy eases to its new size on the fx-clock instead of popping (instant under reduced
  // motion and ?animations=0).
  layoutEnemy(entry, ease) {
    const from = this.enemyLayout?.canvasHeight;
    this.enemyLayout = entry;
    this.enemyEase =
      ease &&
      from &&
      !this.instant &&
      !this.reducedMotion &&
      this.fighters.phase('enemy') === 'idle' &&
      Math.abs(entry.canvasHeight - from) > 1e-6 * from
        ? { from, age: 0 }
        : null;
    if (this.enemyEase) this.stepEnemyEase(0);
    else this.fighters.setLayout({ enemy: entry });
  }

  stepEnemyEase(fxDt) {
    const ease = this.enemyEase,
      to = this.enemyLayout;
    if (!ease) return;
    ease.age = Math.min(ENEMY_EASE_MS, ease.age + fxDt);
    if (ease.age >= ENEMY_EASE_MS) {
      this.enemyEase = null;
      this.fighters.setLayout({ enemy: to });
      this.refreshAnchors();
      return;
    }
    const height = ease.from + (to.canvasHeight - ease.from) * easeOutCubic(ease.age / ENEMY_EASE_MS);
    this.fighters.setLayout({ enemy: { position: to.position, canvasHeight: height } });
  }

  // Rest anchors projected with the rest camera, cached and written as CSS vars (§7.3).
  refreshAnchors() {
    const cam = this.restCamera,
      { width, height } = this.rect;
    cam.position.copy(this.rig.rest.position);
    cam.quaternion.copy(this.rig.rest.quaternion);
    cam.fov = this.rig.rest.fov;
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const half = (v) => Math.round(v * 2) / 2,
      anchors = {};
    for (const side of SIDES) {
      const a = {};
      for (const point of POINTS) {
        const v = this.fighters.restAnchor(side, point, this.projected).project(cam);
        a[point] = { x: half(((v.x + 1) / 2) * width), y: half(((1 - v.y) / 2) * height) };
      }
      a.sizePx = half(a.feet.y - a.head.y);
      anchors[side] = a;
    }
    this.cachedAnchors = anchors;
    const style = this.stage.style;
    for (const side of SIDES) {
      const a = anchors[side];
      style.setProperty(`--${side}-x`, `${a.center.x}px`);
      style.setProperty(`--${side}-y`, `${a.center.y}px`);
      style.setProperty(`--${side}-size`, `${a.sizePx}px`);
      style.setProperty(`--${side}-head-y`, `${a.head.y}px`);
      style.setProperty(`--${side}-feet-y`, `${a.feet.y}px`);
    }
  }

  anchors() {
    return this.cachedAnchors;
  }

  worldAnchor(side, point = 'center', out = new THREE.Vector3()) {
    return this.fighters.worldAnchor(side, point, out);
  }

  /* ------------------------------------------------------------------------------ choreography */

  setClock(clock) {
    this.clock = clock ?? null;
    this.lastFx = null;
  }

  // §7.4. Resolves true at completion, false when superseded or disposed.
  shot(name, { side, duration } = {}) {
    if (!SHOTS[name]) throw new TypeError(`Unknown arena shot: ${name}`);
    if (this.disposed) return Promise.resolve(false);
    if (this.instant) return Promise.resolve(true);
    this.settleShot(false);
    this.endIntroLights();
    if (name === 'cut') {
      this.rig.cut();
      this.setGrade();
      this.wake();
      return Promise.resolve(true);
    }
    if (this.reducedMotion) {
      this.rig.cutTo(name);
      this.wake();
      return Promise.resolve(true);
    }
    const target = side ? this.shotTarget(side) : this.shotTarget('player');
    const record = {
      shot: this.rig.start(name, duration ?? SHOTS[name].duration, target),
      resolve: null,
    };
    const promise = new Promise((resolve) => (record.resolve = resolve));
    this.shotRecord = record;
    if (name === 'intro') for (const side of SIDES) this.pads[side].lift = PAD_DIM_LIFT;
    this.wake();
    return promise;
  }

  shotTarget(side) {
    const center = this.fighters.restAnchor(side, 'center', new THREE.Vector3()),
      feet = this.fighters.restAnchor(side, 'feet', new THREE.Vector3()),
      sign = (this.cachedAnchors?.[side].center.x ?? 0) > (this.rect?.width ?? 0) / 2 ? 1 : -1;
    return { center, feet, sign };
  }

  settleShot(result) {
    const record = this.shotRecord;
    if (!record) return;
    this.shotRecord = null;
    record.resolve(result);
  }

  endIntroLights() {
    for (const side of SIDES) this.pads[side].lift = PAD_REST_LIFT;
  }

  punch(targetSide, { kick = 1, shakePx = 0, shakeMs = 0 } = {}) {
    if (this.disposed || this.instant || this.reducedMotion) return;
    const sign = (this.cachedAnchors?.[targetSide].center.x ?? 0) > (this.rect?.width ?? 0) / 2 ? 1 : -1;
    this.rig.punch(sign, { kick, shakePx, shakeMs });
    this.wake();
  }

  // Colour-grade target for stage and fighters (§7.2), tweened on the fx-clock.
  setGrade({ saturation = 1, exposure = 0, contrast = 1 } = {}, { ms = 0 } = {}) {
    if (this.disposed || this.instant) return;
    const to = {
      saturation: clamp(saturation, 0, 2),
      exposure: clamp(exposure, -1, 1),
      contrast: clamp(contrast, 0.5, 1.5),
    };
    if (this.reducedMotion || !(ms > 0)) {
      this.gradeTween = null;
      this.grade = to;
    } else this.gradeTween = { from: { ...this.grade }, to, ms, age: 0 };
    this.wake();
  }

  // Crowd flash-bulbs and a jump in the stands (super-effective hits, K.O., victory).
  cheer(strength = 1) {
    if (this.disposed || this.instant || this.reducedMotion) return;
    const s = clamp(strength, 0.2, 2),
      rnd = fxRandom(fxSeed('cheer', this.themeId, this.cheerSerial++)),
      fire = this.points.geometry.attributes.aFire,
      count = Math.round(this.bulbPool * Math.min(1, 0.45 + 0.35 * s)),
      spread = 0.35 + 0.3 * s,
      now = this.realTime;
    for (let n = 0; n < count; n++) {
      const i = Math.floor(rnd() * this.bulbPool);
      fire.array[i] = now + rnd() * spread;
    }
    fire.needsUpdate = true;
    this.bulbsUntil = Math.max(this.bulbsUntil, now + spread + 0.4);
    this.cheerLevel = Math.max(this.cheerLevel, Math.min(1.5, s));
    this.wake();
  }

  setBattleState({ tension = 0, showdown = false } = {}) {
    const targetTension = clamp(tension, 0, 1),
      targetShowdown = showdown ? 1 : 0;
    if (targetTension === this.targetTension && targetShowdown === this.targetShowdown) return;
    this.targetTension = targetTension;
    this.targetShowdown = targetShowdown;
    this.wake();
  }

  /* ------------------------------------------------------------------------------ lifecycle */

  // Paused: one final frame, then no frames until resumed (covering sheets, results hand-off).
  setPaused(paused) {
    const next = Boolean(paused);
    if (this.disposed || next === this.paused) return;
    this.paused = next;
    this.fighters.setPaused(next);
    this.fx.setPaused(next);
    if (!next) {
      this.wake();
      return;
    }
    this.stopLoop();
    this.renderFrame();
  }

  // A tier change at a safe boundary: frame caps, DPR, motes, FX budget now; MSAA with the next arena.
  setQuality(quality) {
    if (this.disposed) return;
    this.quality = quality;
    this.applyProfile(quality.arena);
    this.applyTierLooks();
    this.fighters.setQuality(quality);
    this.fx.setQuality(quality);
    if (this.rect) this.fitToStage(this.rect, { force: true });
  }

  // Compiles every program (stage, fighters, FX, hidden pools) before the first contact, then
  // waits for the FX atlas. Resolves false if disposed first.
  warmUp() {
    if (this.disposed) return Promise.resolve(false);
    const hidden = [];
    this.scene.traverse((object) => {
      if (object.visible) return;
      hidden.push(object);
      object.visible = true;
    });
    let pending;
    try {
      pending = this.renderer.compile(this.scene, this.camera);
    } finally {
      for (const object of hidden) object.visible = false;
    }
    const compiled = new Promise((resolve) => {
      const poll = () => {
        if (this.disposed) return resolve(false);
        for (const material of pending)
          if (this.renderer.properties.get(material).currentProgram?.isReady() !== false)
            pending.delete(material);
        if (pending.size) setTimeout(poll, 10);
        else resolve(true);
      };
      poll();
    });
    return compiled.then((ok) =>
      ok
        ? this.fx.ready.then(
            () => !this.disposed,
            () => !this.disposed
          )
        : false
    );
  }

  stats() {
    const info = this.renderer.info,
      size = this.renderer.getDrawingBufferSize(new THREE.Vector2()),
      fx = this.fx.stats();
    return {
      draws: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      drawingBuffer: [size.x, size.y],
      pixelRatio: this.renderer.getPixelRatio(),
      fxLive: fx.live,
      fxPeak: fx.peak,
    };
  }

  // Schedule the next frame immediately (something changed; that frame always renders, even with
  // no ambient frames under reduced motion). Restarting a stopped loop flushes the timers so the
  // stop never becomes one big step.
  wake() {
    this.nextRender = 0;
    this.dirty = true;
    if (this.frame !== undefined || this.disposed || this.paused || document.hidden) return;
    this.lastFrameAt = 0;
    this.lastRealAt = 0;
    this.lastFx = null;
    this.frame = requestAnimationFrame(this.animateBound);
  }

  stopLoop() {
    cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }

  isActive() {
    const tween = this.gradeTween;
    return Boolean(
      this.shotRecord ||
      this.rig.isActive() ||
      (tween && tween.age < tween.ms) ||
      this.tension !== this.targetTension ||
      this.showdown !== this.targetShowdown ||
      this.cheerLevel > 0 ||
      this.realTime < this.bulbsUntil ||
      this.fighters.isActive() ||
      this.enemyEase ||
      this.fx.isActive()
    );
  }

  animate(now) {
    this.frame = undefined;
    if (this.disposed || this.paused || document.hidden) return;
    const active = this.isActive();
    if (this.lastFrameAt) this.governor?.sample(now - this.lastFrameAt, now, active);
    this.lastFrameAt = now;
    const rate = active || this.dirty ? this.fps.active : this.fps.ambient;
    if (rate <= 0) return;
    if (now < this.nextRender - 1) {
      this.frame = requestAnimationFrame(this.animateBound);
      return;
    }
    const interval = 1000 / rate;
    this.nextRender = now - this.nextRender >= interval ? now + interval : this.nextRender + interval;
    const realDt = this.lastRealAt ? Math.min(100, now - this.lastRealAt) : 0;
    this.lastRealAt = now;
    const fxNow = this.clock && !this.clock.disposed ? this.clock.now() : now,
      fxDt = this.lastFx === null ? 0 : clamp(fxNow - this.lastFx, 0, 100);
    this.lastFx = fxNow;
    // Scheduled before stepping, so a wake() from inside the step (a refit) keeps this loop and
    // its fx-clock baseline instead of restarting both.
    this.frame = requestAnimationFrame(this.animateBound);
    this.step(fxDt, realDt);
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  // `fxDt` (virtual ms) drives choreography: shots, punch, grade, reactions, particles.
  // `realDt` drives ambience: motes, crowd, tension lerps, idle breathing.
  step(fxDt, realDt) {
    const real = realDt / 1000;
    this.realTime += real;
    this.shared.uTime.value = this.realTime;
    this.tension = approach(this.tension, this.targetTension, real * 2.4);
    const showdown = approach(this.showdown, this.targetShowdown, real * 1.6);
    if (showdown !== this.showdown) {
      this.showdown = showdown;
      this.rig.showdown = showdown;
      this.rig.updateRest();
      // Rest anchors follow the showdown push once it settles (never per frame).
      if (showdown === this.targetShowdown) this.refreshAnchors();
    }
    const focus = this.tension * 0.6 + this.showdown * 0.4;
    this.shared.uFocus.value = focus;
    const motes = this.points.material.uniforms;
    this.moteTime += real * this.theme.motes.speed * (1 + 0.8 * this.tension + 0.5 * this.showdown);
    motes.uMoteTime.value = this.moteTime;
    this.cheerLevel = this.cheerLevel > 0.01 ? this.cheerLevel * Math.exp(-realDt / (CHEER_MS / 3)) : 0;
    this.shared.uCheer.value = this.cheerLevel;
    this.shafts.material.uniforms.uStrength.value = 0.16 * (1 + 0.6 * focus);
    const tween = this.gradeTween;
    if (tween) {
      tween.age = Math.min(tween.ms, tween.age + fxDt);
      const k = tween.age / tween.ms;
      for (const key of ['saturation', 'exposure', 'contrast'])
        this.grade[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * k;
      if (k >= 1) this.gradeTween = null;
    }
    const completed = this.rig.step(fxDt);
    const record = this.shotRecord;
    if (record && completed === record.shot) {
      if (!SHOTS[completed.name].loops) this.shotRecord = null;
      record.resolve(true);
      record.resolve = () => {};
    }
    if (record?.shot.name === 'intro' && this.rig.active === record.shot) {
      const t = record.shot.age / record.shot.duration;
      this.pads.enemy.lift = padFlash((t - 0.22) / 0.18);
      this.pads.player.lift = padFlash((t - 0.47) / 0.18);
    } else if (!this.shotRecord) this.endIntroLights();
    for (const side of SIDES) this.pads[side].material.uniforms.uLift.value = this.pads[side].lift;
    this.applyGrade();
    this.rig.apply(this.camera, this.rect.width, this.rect.height);
    this.camera.updateMatrixWorld();
    this.stepEnemyEase(fxDt);
    this.fighters.update(fxDt, realDt);
    this.fx.update(fxDt);
  }

  // Combined grade: setGrade target × shot saturation (K.O.) × tension/showdown (§7.2, §7.5).
  applyGrade() {
    const g = this.grade,
      saturation = clamp(g.saturation * this.rig.grade.saturation * (1 + 0.1 * this.tension), 0, 2),
      exposure = clamp(g.exposure + 0.03 * this.showdown, -1, 1),
      contrast = clamp(g.contrast * (1 + 0.08 * this.tension + 0.04 * this.showdown), 0.5, 1.5),
      key = `${saturation.toFixed(3)}|${exposure.toFixed(3)}|${contrast.toFixed(3)}`;
    if (key === this.gradeKey) return;
    this.gradeKey = key;
    this.shared.uGrade.value.set(saturation, exposure, contrast);
    this.fighters.setGrade({ saturation, exposure, contrast });
  }

  renderFrame() {
    if (document.hidden || !this.rect) return;
    this.rig.apply(this.camera, this.rect.width, this.rect.height);
    this.camera.updateMatrixWorld();
    this.fighters.update(0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    this.settleShot(false);
    this.governor?.detach(this);
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.fighters.dispose();
    this.fx.dispose();
    for (const mesh of [this.backdrop, this.floor, this.points, this.shafts]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.pads.player.mesh.geometry.dispose();
    for (const side of SIDES) {
      this.pads[side].material.dispose();
      this.pads[side].texture.dispose();
    }
    this.textures.plate.dispose();
    this.textures.court.dispose();
    this.renderer.dispose();
    // Free the drawing buffer (and any MSAA storage) now instead of at GC.
    this.renderer.forceContextLoss();
  }
}
