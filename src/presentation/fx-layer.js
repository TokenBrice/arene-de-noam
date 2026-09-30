// GPU FX layer (docs/battle-presentation.md §9). One THREE.InstancedMesh of camera-facing quads
// sampling one 1024² atlas, one custom ShaderMaterial (per-instance colour, atlas cell, age/life,
// additive or alpha-over through premultiplied blending), CPU integration at a fixed 1/60 s step
// in preallocated Float32Arrays: one draw call and no per-frame allocation. The layer lives in the
// lazy arena chunk (ArenaScene creates it); it never touches the DOM.
import * as THREE from 'three';
import { ATLAS } from '../data/choreo.js';
import { fxRandom, fxSeed } from '../battle-ui/beats.js';

const STEP_MS = 1000 / 60;
const MAX_STEPS = 8;
// Buffers are sized once for the highest tier budget (§14); lower tiers use a prefix.
const CAPACITY = 256;
const MAX_EMITTERS = 48;
const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Status loops of one creature share this many quads (§9.5 recipes are ≤ 8 each).
const LOOP_QUADS_PER_SIDE = 10;
// Mip sharpening at DPR 1 (low tier): quads cover half the device pixels of high, and a mip one
// level coarser blurs soft cells into blocks.
const LOW_DPR_LOD = 0.6;
// Default blend, between alpha-over (0) and additive (1): a quad hides 60 % of what its alpha
// covers and adds its colour, so type colours stay saturated on bright courts where a purely
// additive glow washes out to white.
const GLOW_OVER = 0.4;
// Depth bias sentinel (`front: true` bursts and rings): drawn in front of every fighter.
const OVERLAY_BIAS = 1e6;

const MODE_BILLBOARD = 0;
const MODE_PILLAR = 1; // billboard pivoting on its bottom edge
const MODE_DECAL = 2; // flat on the court (world XZ plane)
const MODE_STRETCH = 3; // stretched along a world axis (streaks, velocity streaks)
const MODE_SPAN = 4; // a strip from its position to position + axis, each end at its own depth (beams)

const MOVE_FREE = 0; // velocity + gravity + drag
const MOVE_TRAVEL = 1; // lerp from → to (optional parabola)
const MOVE_ORBIT = 2; // circles its emitter's live anchor
const MOVE_FALL = 3; // free fall that dies on the court
const MOVE_STATIC = 4; // parked (in-place fades, decals, trail afterimages)

const CURVE_EASE = 0; // size s0 → s1, ease-out
const CURVE_POP = 1; // 0 → s1 over the first quarter (ease-out-back), then holds

const PERSISTENT_EMITTERS = new Set(['orbit', 'trailFollow']);
const EMITTERS = new Set([
  'burst',
  'ring',
  'streak',
  'beamQuad',
  'pillar',
  'rain',
  'orbit',
  'trailFollow',
  'groundDecal',
]);

const DEFAULTS = {
  burst: { cell: 'spark', size: 0.12, life: 450, speed: 1.2, spread: TAU, gravity: 0.8, drag: 0.9, hot: 0.6 },
  ring: { cell: 'ring', life: 420, r0: 0.1, r1: 0.7, hot: 0.3 },
  streak: { cell: 'streak', size: 0.12, length: 0.45, travelMs: 180, life: 90, arc: 0, hot: 0.7 },
  beamQuad: { cell: 'streak', width: 0.18, scroll: 2, life: 380, hot: 0.5 },
  pillar: { cell: 'glow', at: 'feet', height: 1.2, width: 0.25, staggerMs: 60, life: 520, hot: 0.4 },
  rain: { cell: 'drop', size: 0.1, area: 1.2, fall: 3, life: 700, hot: 0.2 },
  orbit: { cell: 'star', size: 0.16, radius: 0.45, periodMs: 1400, tilt: 0.3, life: Infinity, hot: 0.2 },
  trailFollow: { cell: 'glow', size: 0.5, intervalMs: 30, life: 300, fade: 180, hot: 0 },
  groundDecal: { cell: 'glow', at: 'feet', radius: 0.6, life: 360, hot: 0.3 },
};

const VERTEX = /* glsl */ `
attribute vec4 aPos;   // world centre (or pivot), w = view-space bias toward the camera
attribute vec4 aShape; // width (negative = mirrored art), height (world), rotation, mode
attribute vec4 aAxis;  // MODE_STRETCH / MODE_SPAN: world axis from tail to head; w: span head width scale
attribute vec4 aColor; // rgb (sRGB), alpha
attribute vec4 aCell;  // atlas cell, additive, uv scroll (cells/s), hot core
attribute vec4 aLife;  // age, life, fade-in, fade-out (virtual ms)
uniform float uAreaScale;
uniform float uNear;
uniform float uGrid;
varying vec2 vLocal;   // 0–1 across the quad (u along the stretch axis)
varying vec2 vOrigin;  // atlas cell origin
varying vec2 vTile;    // x: repeats along a scrolled stretch quad (0 = untiled), y: scroll offset
varying vec4 vColor;
varying float vAdditive;
varying float vHot;
void main() {
  vec2 corner = position.xy;
  vec2 size = aShape.xy * uAreaScale;
  float mode = aShape.w;
  float c = cos(aShape.z), s = sin(aShape.z);
  vec4 mv;
  vTile = vec2(0.0);
  if (mode > 3.5) {
    // Span: each end sits at its anchor's depth, so the ray meets both fighters; each end is as
    // wide as its fighter's scale (w = head / tail) and overshoots by half a width (the flares
    // cover the joins).
    vec4 tail = viewMatrix * vec4(aPos.xyz, 1.0), head = viewMatrix * vec4(aPos.xyz + aAxis.xyz, 1.0);
    vec2 screen = head.xy / max(1e-3, -head.z) - tail.xy / max(1e-3, -tail.z);
    vec2 dir = length(screen) > 1e-6 ? normalize(screen) : vec2(1.0, 0.0);
    float end = corner.x < 0.0 ? 1.0 : aAxis.w;
    mv = corner.x < 0.0 ? tail : head;
    mv.xy += (dir * sign(corner.x) * 0.5 * size.x + vec2(-dir.y, dir.x) * corner.y * size.y) * end;
    // A scrolled span tiles its cell every ~2 widths instead of stretching it.
    if (aCell.z != 0.0) vTile = vec2(max(1.0, floor((length(aAxis.xyz) + size.x) / max(1e-4, (1.0 + aAxis.w) * size.y) + 0.5)), aCell.z * aLife.x * 0.001);
  } else if (mode > 2.5) {
    mv = viewMatrix * vec4(aPos.xyz, 1.0);
    vec2 axis = (viewMatrix * vec4(aAxis.xyz, 0.0)).xy;
    float len = length(axis);
    vec2 dir = len > 1e-5 ? axis / len : vec2(1.0, 0.0);
    vec2 perp = vec2(-dir.y, dir.x);
    mv.xy += dir * corner.x * (len + size.x) + perp * corner.y * size.y;
  } else if (mode > 1.5) {
    vec2 ground = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    mv = viewMatrix * vec4(aPos.xyz + vec3(ground.x, 0.0, ground.y), 1.0);
  } else {
    mv = viewMatrix * vec4(aPos.xyz, 1.0);
    vec2 p = corner;
    if (mode > 0.5) p.y += 0.5;
    p *= size;
    mv.xy += vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  // Depth bias toward the camera (w) moves the quad along its view ray, so only the depth test
  // changes, never its screen footprint; OVERLAY_BIAS pulls it in front of every fighter (the
  // blade arc over a lunging attacker).
  float z = min(mv.z, -uNear), pulled = aPos.w > 1e5 ? -uNear * 1.5 : min(z + aPos.w, -uNear * 1.5);
  mv.xyz *= pulled / z;
  gl_Position = projectionMatrix * mv;
  float cell = aCell.x;
  vOrigin = vec2(mod(cell, uGrid), uGrid - 1.0 - floor(cell / uGrid)) / uGrid;
  vLocal = corner + 0.5;
  float fadeIn = aLife.z > 0.0 ? clamp(aLife.x / aLife.z, 0.0, 1.0) : 1.0;
  float fadeOut = aLife.w > 0.0 ? clamp((aLife.y - aLife.x) / aLife.w, 0.0, 1.0) : 1.0;
  vColor = vec4(aColor.rgb, aColor.a * fadeIn * fadeOut);
  vAdditive = aCell.y;
  vHot = aCell.w;
}`;

// Tiled (scrolled) quads wrap u per fragment inside the cell's art span (texels 4.5–123.5, the
// `beam` cell's period) and sample with the unwrapped gradients, so the wrap never picks a coarse
// mip. `uLod` < 1 sharpens the mip choice (low tier: half-resolution quads would otherwise sample
// a mip where the soft cells blur into blocks). `hot` whitens only the brightest texels (the art's
// lit highlights and glow cores), so pixel cells keep their type colour on the body.
const FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uGrid;
uniform float uLod;
varying vec2 vLocal;
varying vec2 vOrigin;
varying vec2 vTile;
varying vec4 vColor;
varying float vAdditive;
varying float vHot;
void main() {
  vec2 cellUv = vLocal * (1.0 - 2.0 / 128.0) + 1.0 / 128.0, unwrapped = vLocal;
  float ends = 1.0;
  if (vTile.x > 0.0) {
    unwrapped.x = vLocal.x * vTile.x - vTile.y;
    cellUv.x = (4.5 + 119.0 * fract(unwrapped.x)) / 128.0;
    ends = smoothstep(0.0, 0.05, vLocal.x) * smoothstep(1.0, 0.95, vLocal.x);
  }
  vec2 grad = unwrapped * (uLod / uGrid);
  vec4 tex = textureGrad(uAtlas, vOrigin + cellUv / uGrid, dFdx(grad), dFdy(grad));
  float alpha = tex.a * vColor.a * ends;
  if (alpha < 0.004) discard;
  float lum = tex.r / max(tex.a, 1e-3);
  float hot = clamp(vHot * tex.a * tex.a * smoothstep(0.78, 1.0, lum), 0.0, 1.0);
  vec3 tint = mix(vColor.rgb, vec3(1.0), hot);
  gl_FragColor = vec4(tint * tex.rgb * vColor.a * ends, alpha * (1.0 - vAdditive));
}`;

const colorCache = new Map();
function rgbOf(color) {
  const key = color || '#ffffff';
  let rgb = colorCache.get(key);
  if (!rgb) {
    const value = Number.parseInt(key.replace('#', ''), 16);
    rgb = Number.isFinite(value)
      ? [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
      : [1, 1, 1];
    colorCache.set(key, rgb);
  }
  return rgb;
}

function easeOutCubic(t) {
  const u = 1 - t;
  return 1 - u * u * u;
}
function easeOutBack(t) {
  const c1 = 1.70158,
    c3 = c1 + 1,
    u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
function easeInSine(t) {
  return 1 - Math.cos((t * Math.PI) / 2);
}

// Per-quad CPU state, structure of arrays. Every array is swapped together when a quad dies.
const QUAD_FIELDS = [
  'px',
  'py',
  'pz',
  'qx',
  'qy',
  'qz', // current and previous (interpolation) position
  'vx',
  'vy',
  'vz', // velocity, world units per virtual ms
  'fx',
  'fy',
  'fz',
  'tx',
  'ty',
  'tz', // travel endpoints
  'arc',
  'travel', // travel parabola height (world) and duration (ms)
  'age',
  'life',
  'fadeIn',
  'fadeOut',
  's0w',
  's0h',
  's1w',
  's1h',
  'curve',
  'rot',
  'spin',
  'drag',
  'grav',
  'floor',
  'stretch',
  'mode',
  'bias',
  'cell',
  'additive',
  'scroll',
  'hot',
  'r',
  'g',
  'b',
  'a',
  'move',
  'emitter',
  'persistent',
  'phase',
  'radius',
  'period',
  'tilt',
  'rise',
  'span',
  'flip', // 1 = mirrored art (face the travel / attack direction)
  // Travelling quads (streaks, beams, crack lines) measure sizes in the emitter's fighter height h;
  // the far fighter stands several times deeper and larger in the world, so a quad keeps the
  // on-screen scale of the fighters it passes by growing to `reach` × its size at the far end.
  'reach',
  'pop', // CURVE_POP: ms to reach full size
];

export class FxLayer {
  mesh;
  texture;
  ready;
  #scene;
  #worldAnchor;
  #reducedMotion;
  #instant;
  #wake;
  #budget = 96;
  #areaBudget = 0.6;
  #lod = 1;
  #quads = {};
  #fields;
  #live = 0;
  #peak = 0;
  #area = 0;
  #accumulator = 0;
  #paused = false;
  #disposed = false;
  #uploaded = false;
  #serial = 0;
  #emitters = [];
  #attributes;
  #uniforms;
  #right = new THREE.Vector3(1, 0, 0);
  #up = new THREE.Vector3(0, 1, 0);
  #forward = new THREE.Vector3(0, 0, 1);
  #a = new THREE.Vector3();
  #b = new THREE.Vector3();
  #c = new THREE.Vector3();
  #d = new THREE.Vector3();

  // `wake` (optional): ArenaScene's render-loop kick, so a spawn on an idle arena (no ambient
  // frames under reduced motion) is drawn.
  constructor({ scene, worldAnchor, quality, reducedMotion = false, testAnimationScale = 1, wake = null }) {
    this.#scene = scene;
    this.#worldAnchor = worldAnchor;
    this.#reducedMotion = Boolean(reducedMotion);
    this.#instant = testAnimationScale === 0;
    this.#wake = typeof wake === 'function' ? wake : null;
    for (const field of QUAD_FIELDS) this.#quads[field] = new Float32Array(CAPACITY);
    this.#fields = QUAD_FIELDS.map((field) => this.#quads[field]);
    for (let index = 0; index < MAX_EMITTERS; index++)
      this.#emitters.push({ active: false, generation: 0, anchor: new THREE.Vector3() });
    this.#applyBudget(quality);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3)
    );
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    const attribute = (name, size) => {
      const buffer = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * size), size);
      buffer.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(name, buffer);
      return buffer;
    };
    this.#attributes = {
      pos: attribute('aPos', 4),
      shape: attribute('aShape', 4),
      axis: attribute('aAxis', 4),
      color: attribute('aColor', 4),
      cell: attribute('aCell', 4),
      life: attribute('aLife', 4),
    };

    this.texture = new THREE.Texture();
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.#uniforms = {
      uAtlas: { value: this.texture },
      uAreaScale: { value: 1 },
      uNear: { value: 0.1 },
      uGrid: { value: ATLAS.grid },
      uLod: { value: this.#lod },
    };
    const material = new THREE.ShaderMaterial({
      name: 'FxLayer',
      uniforms: this.#uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // Court decals (flat rings, cracks, scorches) and mirrored art (`face`, upright crests) wind
      // clockwise on screen: no culling, in one pass (one draw call).
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    this.mesh.name = 'fx-layer';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    // Visible until the atlas is on the GPU, so warmUp compiles the program and the first
    // frames upload the texture before any contact needs it.
    this.mesh.visible = true;
    this.mesh.onBeforeRender = (renderer, _scene, camera) => this.#beforeRender(renderer, camera);
    scene.add(this.mesh);
    this.ready = this.#loadAtlas();
  }

  // Spawns an emitter (§9.3). `null` under ?animations=0, when disposed, or when `count` rounds to 0.
  // `max` caps the scaled count: one-off shapes (a flare, a crest, a seal) stay single at every
  // tier and quality instead of stacking copies.
  emit(emitter, opts = {}) {
    if (this.#instant || this.#disposed) return null;
    if (!EMITTERS.has(emitter)) throw new TypeError(`Unknown FX emitter: ${emitter}`);
    const defaults = DEFAULTS[emitter],
      loop = emitter === 'orbit' && !Number.isFinite(opts.life ?? defaults.life),
      // Status loops share a per-creature quad cap, so several statuses never bury the sprite;
      // each new loop starts phase-staggered from the ones already circling.
      loops = loop ? this.#sideLoops(opts.side) : null,
      count = Math.min(
        this.#budget,
        loops ? Math.max(1, LOOP_QUADS_PER_SIDE - loops.quads) : Infinity,
        opts.max ?? Infinity,
        Math.round(opts.count ?? 1)
      );
    if (!(count > 0)) return null;
    const record = this.#emitters.find((candidate) => !candidate.active) ?? this.#stealEmitter();
    const options = { ...defaults, ...opts, count },
      h = this.#height(options.side);
    Object.assign(record, {
      active: true,
      generation: record.generation + 1,
      type: emitter,
      options,
      side: options.side,
      at: opts.at ?? defaults.at ?? 'center',
      h,
      lift: (options.lift ?? 0) * h,
      phase: loops ? loops.loops * GOLDEN_ANGLE : 0,
      rng: fxRandom((options.seed ?? fxSeed(emitter, this.#serial++)) ^ fxSeed(emitter, options.cell)),
      elapsed: 0,
      spawned: 0,
      stopped: false,
      reduced: this.#reducedMotion,
      // Never stolen for a new emitter: status loops and running afterimage trails.
      persistent: emitter === 'trailFollow' || loop,
    });
    this.#worldAnchor(record.side, record.at, record.anchor);
    const index = this.#emitters.indexOf(record),
      generation = record.generation;
    if (record.reduced) this.#spawnReduced(record, index);
    else this.#start(record, index);
    this.#wake?.();
    return {
      stop: () => {
        if (record.generation !== generation || !record.active) return;
        this.#stop(record, index);
        this.#wake?.();
      },
    };
  }

  // Advances the simulation by the virtual dt (0 during a hit-stop). Fixed 1/60 s steps; the
  // rendered state interpolates between the last two steps so motion stays smooth at any fps.
  update(fxDtMs) {
    if (this.#disposed || this.#paused) return;
    this.#accumulator = Math.min(this.#accumulator + Math.max(0, fxDtMs || 0), STEP_MS * MAX_STEPS);
    while (this.#accumulator >= STEP_MS) {
      this.#accumulator -= STEP_MS;
      this.#step(STEP_MS);
    }
    this.#upload(this.#accumulator / STEP_MS);
  }

  clear() {
    for (const record of this.#emitters) record.active = false;
    this.#live = 0;
    this.#accumulator = 0;
    this.#upload(0);
  }

  setPaused(paused) {
    this.#paused = Boolean(paused);
  }

  setQuality(quality) {
    this.#applyBudget(quality);
    while (this.#live > this.#budget) {
      const oldest = this.#oldest(true);
      if (oldest < 0) break;
      this.#kill(oldest);
    }
    this.#upload(this.#accumulator / STEP_MS);
  }

  // Choreography in flight (→ the arena's active fps). Persistent status loops alone ride the
  // ambient frames instead, so a creature that stays Sonné does not keep the arena at full rate.
  isActive() {
    const q = this.#quads;
    for (let slot = 0; slot < this.#live; slot++) if (!q.persistent[slot]) return true;
    return this.#emitters.some(
      (record) => record.active && !(record.type === 'orbit' && !Number.isFinite(record.options.life))
    );
  }

  stats() {
    return { live: this.#live, peak: this.#peak, budget: this.#budget, areaViewports: this.#area };
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clear();
    this.#scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
    this.texture.dispose();
  }

  // --- internals -------------------------------------------------------------------------------

  #applyBudget(quality) {
    this.#budget = Math.min(CAPACITY, Math.max(1, quality?.fx?.quads ?? 96));
    this.#areaBudget = quality?.fx?.quadArea ?? 0.6;
    this.#lod = (quality?.arena?.maxPixelRatio ?? 1) < 1.5 ? LOW_DPR_LOD : 1;
    if (this.#uniforms) this.#uniforms.uLod.value = this.#lod;
  }

  // Active persistent status loops of one side and the quads they hold.
  #sideLoops(side) {
    let loops = 0,
      quads = 0;
    for (const record of this.#emitters)
      if (record.active && record.persistent && record.type === 'orbit' && record.side === side) {
        loops++;
        quads += record.options.count;
      }
    return { loops, quads };
  }

  async #loadAtlas() {
    try {
      const response = await fetch(ATLAS.url);
      if (!response.ok) throw new Error(`FX atlas ${ATLAS.url}: HTTP ${response.status}`);
      const blob = await response.blob();
      let image;
      // The atlas PNG stores premultiplied colour (rgb = luminance × alpha): uploaded as-is.
      if (typeof createImageBitmap === 'function') {
        image = await createImageBitmap(blob, {
          premultiplyAlpha: 'none',
          imageOrientation: 'flipY',
          colorSpaceConversion: 'none',
        });
        this.texture.flipY = false;
      } else {
        image = new Image();
        image.src = URL.createObjectURL(blob);
        await image.decode();
        URL.revokeObjectURL(image.src);
        this.texture.flipY = true;
      }
      this.texture.premultiplyAlpha = false;
      if (this.#disposed) {
        image.close?.();
        return false;
      }
      this.texture.image = image;
      this.texture.needsUpdate = true;
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }

  #beforeRender(renderer, camera) {
    const m = camera.matrixWorld.elements;
    this.#right.set(m[0], m[1], m[2]).normalize();
    this.#up.set(m[4], m[5], m[6]).normalize();
    this.#forward.set(m[8], m[9], m[10]).normalize();
    if (!this.#uploaded && this.texture.image) {
      renderer.initTexture(this.texture);
      this.#uploaded = true;
    }
    // Summed quad area in stage viewports (§14 quality.fx.quadArea): over budget, every quad
    // shrinks by the same factor, so fill cost stays bounded without changing the composition.
    const q = this.#quads,
      view = camera.matrixWorldInverse.elements,
      projection = camera.projectionMatrix.elements,
      scale = (projection[0] * projection[5]) / 4;
    let area = 0;
    for (let index = 0; index < this.#live; index++) {
      const t = this.#progress(index),
        reach = this.#reachScale(index),
        width = (q.s0w[index] + (q.s1w[index] - q.s0w[index]) * t) * reach,
        height = (q.s0h[index] + (q.s1h[index] - q.s0h[index]) * t) * reach;
      if (q.mode[index] === MODE_SPAN) {
        area += this.#spanArea(index, width, height, view, projection);
        continue;
      }
      const depth = -(view[2] * q.px[index] + view[6] * q.py[index] + view[10] * q.pz[index] + view[14]);
      if (depth <= 0.05) continue;
      let extent = width * height;
      if (q.mode[index] === MODE_STRETCH) extent = (width + this.#stretchLength(index) * reach) * height;
      else if (q.mode[index] === MODE_DECAL) {
        // A court decal is foreshortened by the angle between the court and the view ray.
        const dx = m[12] - q.px[index],
          dy = m[13] - q.py[index],
          dz = m[14] - q.pz[index];
        extent *= Math.abs(dy) / Math.max(1e-6, Math.hypot(dx, dy, dz));
      }
      area += (extent * scale) / (depth * depth);
    }
    const areaScale = area > this.#areaBudget ? Math.sqrt(this.#areaBudget / area) : 1;
    this.#uniforms.uAreaScale.value = areaScale;
    this.#uniforms.uNear.value = camera.near;
    this.#area = Math.round(area * areaScale * areaScale * 1000) / 1000;
  }

  // A span's screen footprint in stage viewports: the trapezoid between its projected ends, each
  // end as wide as the strip at that depth (the head `reach` times wider in the world), plus the
  // half-width overshoot at both ends.
  #spanArea(index, width, thickness, view, projection) {
    const q = this.#quads,
      x0 = q.px[index],
      y0 = q.py[index],
      z0 = q.pz[index],
      x1 = x0 + q.tx[index],
      y1 = y0 + q.ty[index],
      z1 = z0 + q.tz[index],
      d0 = Math.max(0.05, -(view[2] * x0 + view[6] * y0 + view[10] * z0 + view[14])),
      d1 = Math.max(0.05, -(view[2] * x1 + view[6] * y1 + view[10] * z1 + view[14])),
      dx =
        ((view[0] * x1 + view[4] * y1 + view[8] * z1 + view[12]) / d1 -
          (view[0] * x0 + view[4] * y0 + view[8] * z0 + view[12]) / d0) *
        projection[0],
      dy =
        ((view[1] * x1 + view[5] * y1 + view[9] * z1 + view[13]) / d1 -
          (view[1] * x0 + view[5] * y0 + view[9] * z0 + view[13]) / d0) *
        projection[5],
      ends = projection[5] / d0 + (projection[5] / d1) * q.reach[index],
      length = Math.hypot(dx, dy) + (width * ends) / 2;
    return (length * thickness * ends) / 8;
  }

  #height(side) {
    const feet = this.#worldAnchor(side, 'feet', this.#a),
      head = this.#worldAnchor(side, 'head', this.#b);
    return Math.max(0.2, head.distanceTo(feet));
  }

  #stealEmitter() {
    // Every slot busy: reuse the oldest non-persistent emitter (its live quads keep fading).
    let chosen = null;
    for (const record of this.#emitters)
      if (!record.persistent && (!chosen || record.elapsed > chosen.elapsed)) chosen = record;
    chosen ??= this.#emitters[0];
    chosen.active = false;
    return chosen;
  }

  #stop(record, index) {
    record.stopped = true;
    if (record.type === 'orbit') {
      const q = this.#quads;
      for (let slot = 0; slot < this.#live; slot++)
        if (q.emitter[slot] === index && q.persistent[slot]) {
          q.persistent[slot] = 0;
          q.life[slot] = q.age[slot] + 180;
          q.fadeOut[slot] = 180;
        }
      record.active = false;
    }
  }

  // Emitter kick-off: immediate quads now, staggered ones from #step.
  #start(record, index) {
    const o = record.options;
    switch (record.type) {
      case 'burst':
        for (let i = 0; i < o.count; i++) this.#spawnBurst(record, index);
        record.spawned = o.count;
        break;
      case 'orbit':
        for (let i = 0; i < o.count; i++) this.#spawnOrbit(record, index, i);
        record.spawned = o.count;
        break;
      case 'groundDecal':
        if (o.to) this.#spawnDue(record, index);
        else {
          for (let i = 0; i < o.count; i++) this.#spawnDecal(record, index, i);
          record.spawned = o.count;
        }
        break;
      case 'beamQuad':
        this.#spawnBeam(record, index);
        record.spawned = o.count;
        break;
      default:
        this.#spawnDue(record, index);
    }
    // Orbits keep their record while their quads live (the anchor follows the fighter);
    // trailFollow keeps spawning until its life or stop().
    if (record.type !== 'orbit' && record.type !== 'trailFollow' && record.spawned >= o.count)
      record.active = false;
  }

  // Staggered spawns (ring, streak, pillar, rain, trailFollow) as their emitter time advances.
  #spawnDue(record, index) {
    const o = record.options;
    if (record.type === 'trailFollow') {
      if (record.stopped || record.elapsed >= o.life) {
        record.active = false;
        return;
      }
      while (record.spawned * o.intervalMs <= record.elapsed) {
        this.#spawnTrail(record, index);
        record.spawned++;
      }
      return;
    }
    const interval =
      record.type === 'ring'
        ? 70
        : record.type === 'pillar' || record.type === 'groundDecal'
          ? (o.staggerMs ?? 40)
          : record.type === 'streak'
            ? (o.travelMs * 0.6) / Math.max(1, o.count - 1)
            : (o.life * 0.55) / Math.max(1, o.count);
    while (record.spawned < o.count && record.spawned * interval <= record.elapsed) {
      const i = record.spawned++;
      if (record.type === 'ring') this.#spawnRing(record, index);
      else if (record.type === 'streak') this.#spawnStreak(record, index, i);
      else if (record.type === 'pillar') this.#spawnPillar(record, index, i);
      else if (record.type === 'groundDecal') this.#spawnDecal(record, index, i);
      else this.#spawnRain(record, index);
    }
    if (record.spawned >= o.count) record.active = false;
  }

  // One slot, filled with neutral values; callers set what differs. Recycles the oldest
  // non-persistent quad when the tier budget is full; persistent status loops are never stolen.
  #alloc(record, index) {
    let slot = this.#live;
    if (slot >= this.#budget) {
      const oldest = this.#oldest(false);
      if (oldest < 0) return -1;
      this.#kill(oldest);
      slot = this.#live;
    }
    this.#live++;
    if (this.#live > this.#peak) this.#peak = this.#live;
    const q = this.#quads,
      o = record.options,
      [r, g, b] = rgbOf(o.color);
    for (const field of this.#fields) field[slot] = 0;
    q.life[slot] = o.life;
    q.cell[slot] = ATLAS.cells[o.cell] ?? 0;
    q.additive[slot] =
      o.additive === false
        ? 0
        : o.additive === true
          ? 1
          : Number.isFinite(o.additive)
            ? o.additive
            : GLOW_OVER;
    q.hot[slot] = o.hot ?? 0;
    q.r[slot] = r;
    q.g[slot] = g;
    q.b[slot] = b;
    q.a[slot] = o.alpha ?? 1;
    q.emitter[slot] = index;
    q.bias[slot] = o.front ? OVERLAY_BIAS : record.h * 0.3;
    q.stretch[slot] = o.stretch ?? 0;
    q.reach[slot] = 1;
    return slot;
  }

  #place(slot, vector) {
    const q = this.#quads;
    q.px[slot] = q.qx[slot] = vector.x;
    q.py[slot] = q.qy[slot] = vector.y;
    q.pz[slot] = q.qz[slot] = vector.z;
  }

  #size(slot, w0, h0, w1 = w0, h1 = h0, curve = CURVE_EASE) {
    const q = this.#quads;
    q.s0w[slot] = w0;
    q.s0h[slot] = h0;
    q.s1w[slot] = w1;
    q.s1h[slot] = h1;
    q.curve[slot] = curve;
  }

  // Screen-plane direction for an angle (0 = right, π/2 = up), written into `out`.
  #screenDirection(angle, out) {
    return out.copy(this.#right).multiplyScalar(Math.cos(angle)).addScaledVector(this.#up, Math.sin(angle));
  }

  #coneCentre(record) {
    const to = record.options.to;
    if (!to) return Math.PI / 2;
    const target = this.#worldAnchor(to.side, to.at ?? 'center', this.#c).sub(record.anchor);
    return Math.atan2(target.dot(this.#up), target.dot(this.#right));
  }

  // Screen-space direction of the attack through this emitter's side: from the other fighter to
  // this one (`'away'`) or back (`'toward'`), as an angle (0 = right, π/2 = up).
  #attackAngle(record, face) {
    const other = this.#worldAnchor(record.side === 'player' ? 'enemy' : 'player', 'center', this.#c),
      self = this.#worldAnchor(record.side, 'center', this.#d),
      delta = face === 'toward' ? other.sub(self) : self.sub(other);
    return Math.atan2(delta.dot(this.#up), delta.dot(this.#right));
  }

  #spawnBurst(record, index) {
    const slot = this.#alloc(record, index);
    if (slot < 0) return;
    const q = this.#quads,
      o = record.options,
      rng = record.rng,
      h = record.h,
      full = o.spread >= TAU - 1e-3,
      facing = o.face ? this.#attackAngle(record, o.face) : null,
      centre = o.to || facing === null ? this.#coneCentre(record) : facing,
      angle = full ? rng() * TAU : centre + (rng() - 0.5) * o.spread,
      direction = this.#screenDirection(angle, this.#a).addScaledVector(this.#forward, (rng() - 0.5) * 0.5),
      speed = (o.speed * h * (0.45 + 0.55 * rng())) / 1000,
      jitter = o.sizeJitter ?? 0.8,
      size = o.size * h * (1 - jitter / 2 + jitter * rng()),
      grow = o.grow ?? 0.35;
    this.#place(slot, this.#b.copy(record.anchor).addScaledVector(direction, (o.offset ?? 0.08) * h));
    q.vx[slot] = direction.x * speed;
    q.vy[slot] = direction.y * speed;
    q.vz[slot] = direction.z * speed;
    q.grav[slot] = (o.gravity * h) / 1e6;
    q.drag[slot] = Math.log(Math.min(1, Math.max(0.01, o.drag))) / 100;
    q.life[slot] = o.life * (0.7 + 0.3 * rng());
    q.fadeOut[slot] = q.life[slot] * (o.fade ?? 0.5);
    // Authored orientation (`rot` ± `rotJitter` / 2, fixed `spin`) or a random tumble. Art
    // faces +u (right); `face` mirrors billboards to the attack direction, their turn included.
    q.flip[slot] = facing !== null && Math.cos(facing) < 0 && !(q.stretch[slot] > 0) ? 1 : 0;
    const rot = o.rot === undefined ? rng() * TAU : o.rot + (rng() - 0.5) * (o.rotJitter ?? 0);
    q.rot[slot] = q.flip[slot] ? -rot : rot;
    q.spin[slot] =
      o.spin === undefined
        ? o.rot === undefined
          ? (rng() - 0.5) * 0.006
          : 0
        : q.flip[slot]
          ? -o.spin
          : o.spin;
    q.move[slot] = MOVE_FREE;
    q.mode[slot] = q.stretch[slot] > 0 ? MODE_STRETCH : MODE_BILLBOARD;
    this.#size(slot, size, size, size * grow, size * grow);
  }

  #spawnRing(record, index) {
    const slot = this.#alloc(record, index);
    if (slot < 0) return;
    const q = this.#quads,
      o = record.options,
      h = record.h;
    this.#worldAnchor(record.side, record.at, record.anchor);
    this.#place(slot, record.anchor);
    q.fadeOut[slot] = o.life * 0.6;
    q.rot[slot] = record.rng() * TAU;
    q.move[slot] = MOVE_STATIC;
    // `flat`: a shockwave lying on the court instead of a camera-facing ring.
    q.mode[slot] = o.flat ? MODE_DECAL : MODE_BILLBOARD;
    if (o.flat) q.bias[slot] = 0;
    this.#size(slot, o.r0 * 2 * h, o.r0 * 2 * h, o.r1 * 2 * h, o.r1 * 2 * h);
  }

  #spawnStreak(record, index, i) {
    const slot = this.#alloc(record, index);
    if (slot < 0) return;
    const q = this.#quads,
      o = record.options,
      rng = record.rng,
      h = record.h,
      to = o.to ?? { side: record.side === 'player' ? 'enemy' : 'player' },
      reach = this.#height(to.side) / h,
      from = this.#worldAnchor(record.side, record.at, this.#a),
      target = this.#worldAnchor(to.side, to.at ?? 'center', this.#b),
      jitter = o.count > 1 ? 0.12 * h : 0,
      spreadFrom = this.#screenDirection(rng() * TAU, this.#c).multiplyScalar(jitter * rng());
    from.add(spreadFrom);
    const spreadTo = this.#screenDirection(rng() * TAU, this.#c).multiplyScalar(jitter * reach * 0.8 * rng());
    target.add(spreadTo);
    q.reach[slot] = reach;
    if (o.overshoot) target.addScaledVector(this.#c.subVectors(target, from), o.overshoot);
    q.fx[slot] = from.x;
    q.fy[slot] = from.y;
    q.fz[slot] = from.z;
    q.tx[slot] = target.x;
    q.ty[slot] = target.y;
    q.tz[slot] = target.z;
    q.arc[slot] = ((o.arc || 0) * h * (1 + reach)) / 2;
    q.travel[slot] = o.travelMs * (i === 0 ? 1 : 0.9 + 0.2 * rng());
    q.life[slot] = q.travel[slot] + o.life;
    q.fadeIn[slot] = 30;
    q.fadeOut[slot] = o.life;
    q.move[slot] = MOVE_TRAVEL;
    this.#place(slot, from);
    const thickness = o.size * h;
    if (o.upright) {
      // A travelling upright sprite standing on its path (a rolling crest), art mirrored to face
      // the travel direction; it swells by `grow` over its life.
      q.mode[slot] = MODE_PILLAR;
      q.stretch[slot] = 0;
      q.bias[slot] = h * 0.1;
      q.flip[slot] = this.#c.subVectors(target, from).dot(this.#right) < 0 ? 1 : 0;
      const grow = o.grow ?? 1;
      this.#size(slot, thickness, thickness, thickness * grow, thickness * grow);
      return;
    }
    q.stretch[slot] = (o.length * h) / Math.max(1e-3, from.distanceTo(target) / q.travel[slot]);
    q.mode[slot] = MODE_STRETCH;
    this.#size(slot, thickness, thickness);
  }

  // `sky` lifts the tail `sky` fighter heights straight up (screen up): a column falling from the
  // sky onto `to` instead of a ray between the fighters.
  #spawnBeam(record, index) {
    const o = record.options,
      h = record.h,
      to = o.to ?? { side: record.side === 'player' ? 'enemy' : 'player' },
      reach = this.#height(to.side) / h,
      from = this.#d
        .copy(this.#worldAnchor(record.side, record.at, this.#a))
        .addScaledVector(this.#up, (o.sky ?? 0) * h),
      target = this.#worldAnchor(to.side, to.at ?? 'center', this.#b);
    for (let i = 0; i < Math.min(2, o.count); i++) {
      const slot = this.#alloc(record, index);
      if (slot < 0) return;
      const q = this.#quads,
        width = o.width * h * (i === 0 ? 1 : 0.4);
      this.#place(slot, from);
      q.tx[slot] = target.x - from.x;
      q.ty[slot] = target.y - from.y;
      q.tz[slot] = target.z - from.z;
      q.reach[slot] = reach;
      q.fadeIn[slot] = o.fadeIn ?? 60;
      q.fadeOut[slot] = o.life * 0.5;
      q.scroll[slot] = o.scroll;
      // The inner quad is the white-hot core: fully additive over the coloured tube.
      q.hot[slot] = i === 0 ? o.hot : 1;
      if (i > 0) q.additive[slot] = 1;
      q.move[slot] = MOVE_STATIC;
      q.mode[slot] = MODE_SPAN;
      q.stretch[slot] = -1; // fixed axis: tx/ty/tz hold the tail→head vector
      q.bias[slot] = h * 0.15;
      const grow = o.grow ?? 0.35;
      this.#size(slot, width, width, width * grow, width * grow);
    }
  }

  #spawnPillar(record, index, i) {
    const slot = this.#alloc(record, index);
    if (slot < 0) return;
    // Pillars stand side by side, centred on the anchor (`shift`: h to the right of it).
    const q = this.#quads,
      o = record.options,
      rng = record.rng,
      h = record.h,
      offset = ((o.shift ?? 0) + (i - (o.count - 1) / 2) * o.width * 0.9 + (rng() - 0.5) * o.width * 0.4) * h,
      base = this.#worldAnchor(record.side, record.at, this.#a).addScaledVector(this.#right, offset),
      height = o.height * h * (0.75 + 0.5 * rng());
    this.#place(slot, base);
    q.fadeOut[slot] = o.life * 0.45;
    q.move[slot] = MOVE_STATIC;
    q.mode[slot] = MODE_PILLAR;
    q.bias[slot] = h * 0.2;
    q.pop[slot] = o.popMs ?? o.life / 4;
    this.#size(slot, o.width * h, 0, o.width * h, height, CURVE_POP);
  }

  #spawnRain(record, index) {
    const slot = this.#alloc(record, index);
    if (slot < 0) return;
    const q = this.#quads,
      o = record.options,
      rng = record.rng,
      h = record.h,
      feet = this.#worldAnchor(record.side, 'feet', this.#a),
      start = this.#b
        .copy(feet)
        .addScaledVector(this.#right, (rng() - 0.5) * o.area * h)
        .addScaledVector(this.#up, h * (1.7 + 0.4 * rng())),
      speed = (o.fall * h * (0.85 + 0.3 * rng())) / 1000;
    this.#place(slot, start);
    q.vx[slot] = -this.#up.x * speed;
    q.vy[slot] = -this.#up.y * speed;
    q.vz[slot] = -this.#up.z * speed;
    q.floor[slot] = feet.y;
    q.life[slot] = (start.y - feet.y) / Math.max(1e-6, speed * this.#up.y) + 60;
    q.fadeIn[slot] = 40;
    q.fadeOut[slot] = 60;
    q.move[slot] = MOVE_FALL;
    q.mode[slot] = q.stretch[slot] > 0 ? MODE_STRETCH : MODE_BILLBOARD;
    const size = o.size * h;
    this.#size(slot, size, size);
  }

  #spawnOrbit(record, index, i) {
    const slot = this.#alloc(record, index);
    if (slot < 0) return;
    const q = this.#quads,
      o = record.options,
      h = record.h,
      size = o.size * h;
    this.#place(slot, record.anchor);
    q.life[slot] = Number.isFinite(o.life) ? o.life : 1e9;
    q.fadeIn[slot] = 200;
    q.fadeOut[slot] = Number.isFinite(o.life) ? 200 : 0;
    q.phase[slot] = record.phase + (i / o.count) * TAU;
    q.radius[slot] = o.radius * h;
    q.period[slot] = o.periodMs;
    q.tilt[slot] = o.tilt;
    // Optional climb (burning embers): quads drift up by `rise` h/s and wrap over `height` h.
    q.rise[slot] = ((o.rise ?? 0) * h) / 1000;
    q.span[slot] = (o.height ?? 0) * h;
    q.persistent[slot] = Number.isFinite(o.life) ? 0 : 1;
    q.move[slot] = MOVE_ORBIT;
    q.mode[slot] = MODE_BILLBOARD;
    q.bias[slot] = 0;
    this.#size(slot, size, size);
    this.#orbitPosition(slot, record);
    q.qx[slot] = q.px[slot];
    q.qy[slot] = q.py[slot];
    q.qz[slot] = q.pz[slot];
  }

  #spawnTrail(record, index) {
    const slot = this.#alloc(record, index);
    if (slot < 0) return;
    const q = this.#quads,
      o = record.options,
      size = o.size * record.h;
    this.#place(slot, this.#worldAnchor(record.side, record.at, this.#a));
    q.life[slot] = o.fade;
    q.fadeOut[slot] = o.fade;
    q.a[slot] = (o.alpha ?? 1) * 0.6;
    q.move[slot] = MOVE_STATIC;
    q.mode[slot] = MODE_BILLBOARD;
    q.bias[slot] = -record.h * 0.05;
    this.#size(slot, size, size, size * 0.8, size * 0.8);
  }

  // One court decal under the anchor; with `to`, decal i of n lands along the court from the
  // anchor to that fighter's feet, `staggerMs` apart (a crack racing across the floor), scaled
  // along the way from this fighter's h to that one's.
  #spawnDecal(record, index, i) {
    const slot = this.#alloc(record, index);
    if (slot < 0) return;
    const q = this.#quads,
      o = record.options,
      h = record.h,
      along = o.to ? (i + 1) / o.count : 0,
      reach = o.to ? 1 + (this.#height(o.to.side) / h - 1) * along : 1,
      diameter = o.radius * 2 * h * reach * (i === 0 && !o.to ? 1 : 0.7 + 0.3 * record.rng()),
      where = this.#a.copy(record.anchor);
    if (o.to) where.lerp(this.#worldAnchor(o.to.side, 'feet', this.#b), along);
    this.#place(slot, where.setY(where.y + 0.01 * h * reach));
    q.fadeOut[slot] = o.life * 0.7;
    q.rot[slot] = record.rng() * TAU;
    q.move[slot] = MOVE_STATIC;
    q.mode[slot] = MODE_DECAL;
    q.bias[slot] = 0;
    const grow = o.grow ?? 0.7;
    this.#size(slot, diameter * grow, diameter * grow, diameter, diameter);
  }

  // Reduced motion (§9.3): no travel or expansion; one in-place glow quad per call that fades
  // over `life`. A persistent orbit shows one static motif until stop().
  #spawnReduced(record, index) {
    const o = record.options,
      travel = record.type === 'streak' || record.type === 'beamQuad',
      slot = this.#alloc(record, index);
    record.spawned = o.count;
    if (slot < 0) {
      record.active = false;
      return;
    }
    const q = this.#quads,
      h = record.h,
      to = o.to,
      where = travel && to ? this.#worldAnchor(to.side, to.at ?? 'center', this.#a) : record.anchor,
      size = Math.min(0.8, Math.max(0.3, (o.size ?? 0.15) * 3)) * h;
    this.#place(slot, where);
    if (record.type === 'orbit') {
      q.px[slot] = q.qx[slot] = where.x + this.#right.x * o.radius * h * 0.7 + this.#up.x * record.lift;
      q.py[slot] = q.qy[slot] = where.y + this.#right.y * o.radius * h * 0.7 + this.#up.y * record.lift;
      q.pz[slot] = q.qz[slot] = where.z + this.#right.z * o.radius * h * 0.7 + this.#up.z * record.lift;
      q.life[slot] = Number.isFinite(o.life) ? o.life : 1e9;
      q.persistent[slot] = Number.isFinite(o.life) ? 0 : 1;
      this.#size(slot, o.size * h * 1.4, o.size * h * 1.4);
    } else {
      q.life[slot] = Number.isFinite(o.life) ? Math.max(150, o.life + (o.travelMs ?? 0)) : 400;
      q.fadeOut[slot] = q.life[slot] * 0.6;
      q.cell[slot] = ATLAS.cells[record.type === 'orbit' ? o.cell : 'glow'] ?? 0;
      this.#size(slot, size, size);
    }
    q.fadeIn[slot] = 60;
    q.move[slot] = MOVE_STATIC;
    q.mode[slot] = MODE_BILLBOARD;
    record.active = record.type === 'orbit' && q.persistent[slot] === 1;
  }

  #orbitPosition(slot, record) {
    const q = this.#quads,
      angle = q.phase[slot] + (TAU * q.age[slot]) / Math.max(1, q.period[slot]),
      radius = q.radius[slot],
      cos = Math.cos(angle),
      sin = Math.sin(angle),
      lift = this.#orbitLift(slot) * q.span[slot] + record.lift,
      anchor = record.anchor;
    q.px[slot] = anchor.x + this.#right.x * cos * radius + this.#up.x * (sin * radius * q.tilt[slot] + lift);
    q.py[slot] = anchor.y + this.#right.y * cos * radius + this.#up.y * (sin * radius * q.tilt[slot] + lift);
    q.pz[slot] = anchor.z + this.#right.z * cos * radius + this.#up.z * (sin * radius * q.tilt[slot] + lift);
    // Behind the fighter half of the circle: pushed back in depth and dimmed.
    q.px[slot] -= this.#forward.x * sin * radius * 0.6;
    q.py[slot] -= this.#forward.y * sin * radius * 0.6;
    q.pz[slot] -= this.#forward.z * sin * radius * 0.6;
  }

  // 0–1 position of a climbing orbit quad inside its wrap span (0 without a span).
  #orbitLift(slot) {
    const q = this.#quads,
      span = q.span[slot];
    if (!(span > 0)) return 0;
    const start = (q.phase[slot] / TAU) * span,
      travelled = start + q.rise[slot] * q.age[slot];
    return (travelled % span) / span;
  }

  #step(dt) {
    for (let index = 0; index < MAX_EMITTERS; index++) {
      const record = this.#emitters[index];
      if (!record.active) continue;
      record.elapsed += dt;
      if (record.type === 'orbit' || record.type === 'trailFollow')
        this.#worldAnchor(record.side, record.at, record.anchor);
      if (record.type === 'orbit') {
        if (record.elapsed >= record.options.life) record.active = false;
      } else if (!record.reduced) this.#spawnDue(record, index);
    }
    const q = this.#quads;
    let slot = 0;
    while (slot < this.#live) {
      q.qx[slot] = q.px[slot];
      q.qy[slot] = q.py[slot];
      q.qz[slot] = q.pz[slot];
      q.age[slot] += dt;
      if (q.age[slot] >= q.life[slot]) {
        this.#kill(slot);
        continue;
      }
      q.rot[slot] += q.spin[slot] * dt;
      switch (q.move[slot]) {
        case MOVE_FREE: {
          const keep = Math.exp(q.drag[slot] * dt);
          q.vx[slot] *= keep;
          q.vz[slot] *= keep;
          q.vy[slot] = q.vy[slot] * keep - q.grav[slot] * dt;
          q.px[slot] += q.vx[slot] * dt;
          q.py[slot] += q.vy[slot] * dt;
          q.pz[slot] += q.vz[slot] * dt;
          break;
        }
        case MOVE_FALL:
          q.px[slot] += q.vx[slot] * dt;
          q.py[slot] += q.vy[slot] * dt;
          q.pz[slot] += q.vz[slot] * dt;
          if (q.py[slot] <= q.floor[slot]) {
            q.py[slot] = q.floor[slot];
            q.vx[slot] = q.vy[slot] = q.vz[slot] = 0;
            q.life[slot] = Math.min(q.life[slot], q.age[slot] + 60);
            q.fadeOut[slot] = 60;
          }
          break;
        case MOVE_TRAVEL: {
          const t = Math.min(1, q.age[slot] / Math.max(1, q.travel[slot])),
            eased = easeInSine(t),
            lift = q.arc[slot] * 4 * t * (1 - t);
          const x = q.fx[slot] + (q.tx[slot] - q.fx[slot]) * eased,
            y = q.fy[slot] + (q.ty[slot] - q.fy[slot]) * eased + lift,
            z = q.fz[slot] + (q.tz[slot] - q.fz[slot]) * eased;
          q.vx[slot] = t < 1 ? (x - q.px[slot]) / dt : 0;
          q.vy[slot] = t < 1 ? (y - q.py[slot]) / dt : 0;
          q.vz[slot] = t < 1 ? (z - q.pz[slot]) / dt : 0;
          q.px[slot] = x;
          q.py[slot] = y;
          q.pz[slot] = z;
          break;
        }
        case MOVE_ORBIT:
          this.#orbitPosition(slot, this.#emitters[q.emitter[slot]]);
          break;
        default:
          break;
      }
      slot++;
    }
  }

  #oldest(includePersistentLast) {
    const q = this.#quads;
    let best = -1,
      bestPersistent = -1;
    for (let slot = 0; slot < this.#live; slot++) {
      if (q.persistent[slot]) {
        if (includePersistentLast && (bestPersistent < 0 || q.age[slot] > q.age[bestPersistent]))
          bestPersistent = slot;
        continue;
      }
      if (best < 0 || q.age[slot] > q.age[best]) best = slot;
    }
    return best >= 0 ? best : bestPersistent;
  }

  #kill(slot) {
    const last = --this.#live;
    if (slot === last) return;
    for (const field of this.#fields) field[slot] = field[last];
  }

  #progress(slot) {
    const q = this.#quads;
    if (q.curve[slot] === CURVE_POP)
      return Math.min(1.1, easeOutBack(Math.min(1, q.age[slot] / Math.max(1, q.pop[slot]))));
    return easeOutCubic(Math.min(1, q.age[slot] / Math.max(1, Math.min(q.life[slot], 1e8))));
  }

  #stretchLength(slot) {
    const q = this.#quads;
    if (q.stretch[slot] < 0) return Math.hypot(q.tx[slot], q.ty[slot], q.tz[slot]);
    return Math.hypot(q.vx[slot], q.vy[slot], q.vz[slot]) * q.stretch[slot];
  }

  // Size factor of a travelling quad: 1 at the emitter, `reach` on arrival (eased like the travel).
  #reachScale(slot) {
    const q = this.#quads;
    if (q.move[slot] !== MOVE_TRAVEL) return 1;
    return 1 + (q.reach[slot] - 1) * easeInSine(Math.min(1, q.age[slot] / Math.max(1, q.travel[slot])));
  }

  #upload(alpha) {
    const q = this.#quads,
      live = this.#live,
      { pos, shape, axis, color, cell, life } = this.#attributes,
      P = pos.array,
      S = shape.array,
      X = axis.array,
      C = color.array,
      L = cell.array,
      A = life.array;
    for (let slot = 0; slot < live; slot++) {
      const i4 = slot * 4,
        t = this.#progress(slot),
        reach = this.#reachScale(slot);
      let x = q.qx[slot] + (q.px[slot] - q.qx[slot]) * alpha,
        y = q.qy[slot] + (q.py[slot] - q.qy[slot]) * alpha,
        z = q.qz[slot] + (q.pz[slot] - q.qz[slot]) * alpha;
      let ax = 0,
        ay = 0,
        az = 0;
      if (q.mode[slot] === MODE_SPAN) {
        ax = q.tx[slot];
        ay = q.ty[slot];
        az = q.tz[slot];
      } else if (q.mode[slot] === MODE_STRETCH) {
        const k = q.stretch[slot] * reach;
        ax = q.vx[slot] * k;
        ay = q.vy[slot] * k;
        az = q.vz[slot] * k;
        // The head rides the particle position; the tail trails behind it.
        x -= ax * 0.5;
        y -= ay * 0.5;
        z -= az * 0.5;
      }
      P[i4] = x;
      P[i4 + 1] = y;
      P[i4 + 2] = z;
      P[i4 + 3] = q.bias[slot];
      S[i4] = Math.max(0, q.s0w[slot] + (q.s1w[slot] - q.s0w[slot]) * t) * reach * (q.flip[slot] ? -1 : 1);
      S[i4 + 1] = Math.max(0, q.s0h[slot] + (q.s1h[slot] - q.s0h[slot]) * t) * reach;
      S[i4 + 2] = q.rot[slot];
      S[i4 + 3] = q.mode[slot];
      X[i4] = ax;
      X[i4 + 1] = ay;
      X[i4 + 2] = az;
      X[i4 + 3] = q.mode[slot] === MODE_SPAN ? q.reach[slot] : 1;
      C[i4] = q.r[slot];
      C[i4 + 1] = q.g[slot];
      C[i4 + 2] = q.b[slot];
      C[i4 + 3] = q.move[slot] === MOVE_ORBIT ? q.a[slot] * this.#orbitShade(slot) : q.a[slot];
      L[i4] = q.cell[slot];
      L[i4 + 1] = q.additive[slot];
      L[i4 + 2] = q.scroll[slot];
      L[i4 + 3] = q.hot[slot];
      // Rendered state lags the simulation by up to one step (position interpolation).
      A[i4] = Math.max(0, q.age[slot] - (1 - alpha) * STEP_MS);
      A[i4 + 1] = Math.min(q.life[slot], 1e8);
      A[i4 + 2] = q.fadeIn[slot];
      A[i4 + 3] = q.fadeOut[slot];
    }
    for (const attribute of [pos, shape, axis, color, cell, life]) {
      attribute.clearUpdateRanges();
      if (live) {
        attribute.addUpdateRange(0, live * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    this.mesh.count = live;
    this.mesh.visible = live > 0 || !this.#uploaded;
  }

  #orbitShade(slot) {
    const q = this.#quads,
      angle = q.phase[slot] + (TAU * q.age[slot]) / Math.max(1, q.period[slot]),
      behind = Math.sin(angle) > 0 ? 0.55 : 1;
    if (!(q.span[slot] > 0)) return behind;
    // Climbing quads fade in at the bottom and out at the top of their span.
    const lift = this.#orbitLift(slot);
    return behind * Math.min(1, lift / 0.2, (1 - lift) / 0.2);
  }
}
