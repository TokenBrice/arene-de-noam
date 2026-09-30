// WebGL fighters (docs/battle-presentation.md §8). Each creature is a pixel sprite on a feet-anchored
// plane that copies the camera orientation, so texel rows stay uniform on screen, standing on its pad
// inside the stage diorama. Every reaction is an offset, a squash or a uniform integrated on the
// fx-clock; idle breathing is texel-quantised so the pixel art never shimmers. The DOM keeps visually
// hidden proxies for names and e2e hooks (§8.3); this layer writes their `data-phase`.
import * as THREE from 'three';
import { AFFINITIES } from '../data/affinities.js';
import { CREATURES } from '../data/creatures.js';
import { SPRITE_CANVAS, SPRITE_METRICS, spriteMassScale } from '../data/sprite-metrics.js';
import { STATUS_DEFINITIONS } from '../battle/statuses.js';
import { fxRandom, fxSeed } from '../battle-ui/beats.js';

/** Rendered sqrt(bw·bh) of a medium creature in texels: a typical medium creature keeps the nominal
 * canvas scale (`canvasHeight`), small ones shrink and large ones grow around it. */
export const MASS_REFERENCE_TEXELS = 110;

const SIDES = ['player', 'enemy'];
const OTHER = { player: 'enemy', enemy: 'player' };
const CANVAS = SPRITE_CANVAS;
// The quad covers the opaque bbox plus this many texels: the high-contrast outline and the sway.
const QUAD_MARGIN = 2;
const BREATH_PERIOD_MS = { S: 1700, M: 2300, L: 3000 };
// Personality by size class: small creatures hop higher and land lighter, large ones stomp.
const WEIGHT = { S: 0.8, M: 1, L: 1.25 };
const BLOB_ALPHA = 0.55;
const DUST_MS = 420;
// Hit: a short white frame, then a light type tint fading out, so the sprite's detail stays
// readable through a multi-hit (no flat colour blob). Pulses (blocked, NOVA caster, burn tick)
// peak lower than a full fill for the same reason.
const HIT_TINT_MS = 120;
// The white frame brightens the sprite toward white without flattening it: its texels stay
// readable, so at 30 fps (Low) the held frame reads as a flash, not a white silhouette.
const HIT_WHITE = 0.45;
const HIT_TINT_PEAK = 0.28;
const FLASH_PEAK = 0.55;
// The entrance drops in lit by its type colour; this is the fill it starts from.
const ENTER_FILL = 0.55;

/** World units per texel for `creatureId` when the nominal canvas is 1 unit tall (before snapping). */
function massTexel(creatureId) {
  return spriteMassScale(creatureId, MASS_REFERENCE_TEXELS / CANVAS);
}

/**
 * Rest extent of a creature in `canvasHeight` units (before snapping, which the stage bounds with
 * `canvasRange`): the opaque bbox half-width around the feet and the feet-to-head height.
 */
export function restExtent(creatureId) {
  const [x0, y0, x1, y1] = SPRITE_METRICS[creatureId].bbox,
    texel = massTexel(creatureId);
  return { halfWidth: ((x1 - x0 + 1) / 2) * texel, height: (y1 - y0 + 1) * texel };
}

// Sprite rows in display space: y = 0 is the bottom texel row of the 128-texel canvas.
function spriteLayout(creatureId) {
  const { bbox, sizeClass } = SPRITE_METRICS[creatureId],
    [x0, y0, x1, y1] = bbox,
    feetY = CANVAS - 1 - y1,
    headY = CANVAS - y0;
  return {
    x0,
    x1,
    feetX: (x0 + x1 + 1) / 2,
    feetY,
    headY,
    height: headY - feetY,
    width: x1 - x0 + 1,
    sizeClass,
  };
}
// Before a creature loads, anchors assume a full-height sprite on the pad.
const FULL_CANVAS = {
  x0: 0,
  x1: CANVAS - 1,
  feetX: CANVAS / 2,
  feetY: 0,
  headY: CANVAS,
  height: CANVAS,
  width: CANVAS,
  sizeClass: 'M',
};

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const easeOutQuad = (u) => 1 - (1 - u) * (1 - u);
const easeInQuad = (u) => u * u;
const easeInCubic = (u) => u * u * u;
const easeOutCubic = (u) => 1 - (1 - u) ** 3;
const easeOutExpo = (u) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u));
const easeInOutSine = (u) => (1 - Math.cos(Math.PI * u)) / 2;
const easeOutBack = (u) => 1 + 2.70158 * (u - 1) ** 3 + 1.70158 * (u - 1) ** 2;

const bodyVertex = /* glsl */ `
uniform vec4 uQuad;
uniform vec2 uFeet, uScale;
uniform float uTexelWorld, uBend, uHeight;
varying vec2 vTex;
void main() {
  vTex = mix(uQuad.xy, uQuad.zw, vec2(position.x + 0.5, position.y));
  vec2 p = vTex - uFeet;
  float h = clamp(p.y / uHeight, 0.0, 1.0);
  p.x += uBend * h * h;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p * uScale * uTexelWorld, 0.0, 1.0);
}`;

const bodyFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uFlip, uHue, uOpacity, uOcclusion;
uniform vec2 uLightStep;
uniform vec3 uBreath, uGrade, uArenaTint;
uniform vec4 uBody, uRim, uFlash, uTint, uDissolve, uOutline;
varying vec2 vTex;
vec4 texel(vec2 t) {
  if (t.x < 0.0 || t.y < 0.0 || t.x > 127.0 || t.y > 127.0) return vec4(0.0);
  if (uFlip > 0.5) t.x = 127.0 - t.x;
  return texture2D(uMap, (t + 0.5) / 128.0);
}
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
void main() {
  vec2 t = floor(vTex), s = t;
  if (s.y >= uBody.y) s.y += uBreath.x;
  if (s.y >= uBody.z) s += vec2(-uBreath.z, uBreath.y);
  vec4 c = texel(s);
  if (c.a < 0.5) {
    if (uOutline.a > 0.0 && texel(s + vec2(1.0, 0.0)).a + texel(s - vec2(1.0, 0.0)).a
        + texel(s + vec2(0.0, 1.0)).a + texel(s - vec2(0.0, 1.0)).a > 0.5) {
      gl_FragColor = vec4(uOutline.rgb, uOutline.a * uOpacity);
      return;
    }
    discard;
  }
  vec3 col = c.rgb;
  if (uHue != 0.0) col = clamp(hueShift(col, uHue), 0.0, 1.0);
  col *= uArenaTint;
  float rim = 1.0 - texel(s + uLightStep).a + 0.45 * (1.0 - texel(s + 2.0 * uLightStep).a);
  col += uRim.rgb * min(rim, 1.0) * uRim.a;
  col *= mix(0.72, 1.0, clamp((t.y - uBody.x) / uOcclusion, 0.0, 1.0));
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, uGrade.x) * (1.0 + uGrade.y);
  col = (col - 0.5) * uGrade.z + 0.5;
  col = mix(col, uTint.rgb, uTint.a);
  col = mix(col, uFlash.rgb, uFlash.a);
  if (uDissolve.a > 0.0) {
    float v = fract(sin(dot(floor(t / 2.0), vec2(127.1, 311.7))) * 43758.5453) * 0.7
      + (1.0 - clamp((t.y - uBody.x) / (uBody.w - uBody.x), 0.0, 1.0)) * 0.3;
    float edge = uDissolve.a * 1.12 - 0.06;
    if (v < edge) discard;
    if (v < edge + 0.07) col = uDissolve.rgb * 1.5 + 0.2;
  }
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), uOpacity);
}`;

// Both contact shadows (and the landing dust rings) in one draw: a soft ellipse on the pad top.
const blobVertex = /* glsl */ `
attribute float aSide;
uniform vec4 uBlob[2];
uniform vec4 uShade[2];
varying vec2 vQ;
varying vec4 vShade;
void main() {
  vec4 b = aSide < 0.5 ? uBlob[0] : uBlob[1];
  vShade = aSide < 0.5 ? uShade[0] : uShade[1];
  vQ = position.xy;
  vec3 p = vec3(b.x + position.x * b.w * 2.0, b.y, b.z + position.y * vShade.x * 2.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const blobFragment = /* glsl */ `
uniform vec3 uDustColor;
varying vec2 vQ;
varying vec4 vShade;
void main() {
  float d = length(vQ) * 2.0;
  float shadow = (1.0 - smoothstep(0.3, 1.0, d)) * vShade.y;
  float ring = 0.0;
  if (vShade.z >= 0.0) ring = (1.0 - smoothstep(0.0, 0.2, abs(d - mix(0.75, 1.85, vShade.z)))) * (1.0 - vShade.z) * vShade.w;
  float a = max(shadow, ring);
  if (a < 0.004) discard;
  gl_FragColor = vec4(uDustColor * (ring / max(1e-3, ring + shadow)), a);
}`;

/* Reactions (§8.2). `pose(u, run, s, out)` writes the reaction's own pose at normalised time u (the
   pose of the superseded reaction fades out over `blendMs`, or is kept with `keepFrom`). `visual`
   drives opacity / colour fill / dissolve / shadow; `begin` and `end` handle phase, overlay and
   visibility. `reduced` is the reduced-motion variant: 'skip' resolves at once without motion. */
const REST_POSE = Object.freeze({ ox: 0, oy: 0, oz: 0, sx: 1, sy: 1, bend: 0 });
const REACTIONS = {
  windup: {
    defaults: { ms: 120, squash: 0.08 },
    reduced: 'skip',
    duration: (o) => o.ms,
    pose(u, run, s, out) {
      const f = u < 0.6 ? easeOutQuad(u / 0.6) : 1 - easeInOutSine((u - 0.6) / 0.4);
      out.sy = 1 - run.o.squash * f;
      out.sx = 1 + run.o.squash * 0.7 * f;
      out.bend = -2 * run.screenSign * f;
    },
  },
  lunge: {
    defaults: { reach: 0.62, outMs: 110, holdMs: 70, backMs: 180 },
    reduced: 'skip',
    duration: (o) => o.outMs + o.holdMs + o.backMs,
    begin(layer, s, run) {
      run.vector = layer.floorVector(s.side, run.toward, run.vector).multiplyScalar(run.o.reach);
    },
    pose(u, run, s, out) {
      const { outMs, holdMs, backMs } = run.o,
        t = u * (outMs + holdMs + backMs),
        travel =
          t < outMs
            ? easeInQuad(t / outMs)
            : t < outMs + holdMs
              ? 1
              : 1 - easeOutCubic((t - outMs - holdMs) / backMs),
        lean = t < outMs ? travel : Math.max(0, 1 - (t - outMs) / (holdMs + backMs * 0.4));
      out.ox = run.vector.x * travel;
      out.oz = run.vector.z * travel;
      out.sx = 1 + 0.06 * lean;
      out.sy = 1 - 0.04 * lean;
      out.bend = 5 * run.screenSign * lean;
    },
  },
  hit: {
    defaults: { ms: 280, color: '#ffffff' },
    reduced: 'flash',
    duration: (o) => o.ms,
    begin(layer, s, run) {
      layer.startOverlay(s, {
        color: run.o.color,
        peak: HIT_TINT_PEAK,
        ms: HIT_TINT_MS,
        shape: 'fade',
        white: HIT_WHITE,
      });
    },
    pose(u, run, s, out) {
      const spring = (1 - u) ** 2 * Math.cos(u * Math.PI * 2.5);
      out.sy = 1 - 0.06 * spring;
      out.sx = 1 + 0.04 * spring;
    },
  },
  knockback: {
    defaults: { px: 12, ms: 200 },
    reduced: 'skip',
    duration: (o) => o.ms,
    begin(layer, s, run) {
      const from = run.o.from ?? OTHER[s.side];
      run.vector = layer
        .floorVector(from, s.side, run.vector)
        .normalize()
        .multiplyScalar(layer.pxToWorld(s, run.o.px));
    },
    pose(u, run, s, out) {
      const push = u < 0.35 ? easeOutExpo(u / 0.35) : 1 - easeInOutSine((u - 0.35) / 0.65);
      out.ox = run.vector.x * push;
      out.oz = run.vector.z * push;
      out.bend = 3 * run.screenSign * push;
    },
  },
  recoil: {
    defaults: { px: 6, ms: 180 },
    reduced: 'skip',
    duration: (o) => o.ms,
    begin(layer, s, run) {
      run.vector = layer
        .floorVector(run.toward, s.side, run.vector)
        .normalize()
        .multiplyScalar(layer.pxToWorld(s, run.o.px));
    },
    pose(u, run, s, out) {
      const flinch = u < 0.3 ? easeOutQuad(u / 0.3) : 1 - easeInOutSine((u - 0.3) / 0.7);
      out.ox = run.vector.x * flinch;
      out.oz = run.vector.z * flinch;
      out.sy = 1 - 0.03 * flinch;
      out.bend = 2 * run.screenSign * flinch;
    },
  },
  dodge: {
    defaults: { px: 18, ms: 260 },
    reduced: 'skip',
    duration: (o) => o.ms,
    begin(layer, s, run) {
      const away = layer.floorVector(run.o.from ?? OTHER[s.side], s.side, run.vector).normalize(),
        // Sidestep across the attack line, towards the back of the stage, with a little retreat.
        side = away.x > 0 ? -1 : 1;
      run.vector
        .set(-away.z * side * 0.85 + away.x * 0.35, 0, away.x * side * 0.85 + away.z * 0.35)
        .normalize()
        .multiplyScalar(layer.pxToWorld(s, run.o.px));
      run.hop = layer.pxToWorld(s, run.o.px * 0.35);
    },
    pose(u, run, s, out) {
      const step = u < 0.4 ? easeOutCubic(u / 0.4) : 1 - easeOutBack((u - 0.4) / 0.6);
      out.ox = run.vector.x * step;
      out.oz = run.vector.z * step;
      out.oy = run.hop * Math.sin(Math.PI * Math.min(1, u / 0.4));
    },
  },
  ko: {
    defaults: { ms: 250 },
    reduced: 'flash',
    duration: (o) => o.ms,
    endPose: (s, out) => koPose(s, 1, out),
    begin(layer, s) {
      layer.startOverlay(s, { color: '#ffffff', peak: 0.5, ms: 90, shape: 'fade' });
    },
    pose(u, run, s, out) {
      koPose(s, easeOutCubic(u), out);
    },
  },
  faint: {
    defaults: { ms: 700 },
    reducedMs: 300,
    duration: (o) => o.ms,
    keepFrom: true,
    begin(layer, s) {
      layer.setPhase(s, 'fainted');
    },
    pose(u, run, s, out) {
      out.oy = run.reduced ? 0 : -0.08 * s.heightWorld * easeInQuad(u);
    },
    visual(u, run, s, visual) {
      if (run.reduced) visual.opacity = 1 - u;
      else visual.dissolve = u ** 1.4;
      visual.blob = 1 - u;
    },
    end(layer, s) {
      s.visual.shown = false;
    },
  },
  recall: {
    defaults: { ms: 180 },
    reducedMs: 150,
    duration: (o) => o.ms,
    begin(layer, s, run) {
      layer.setPhase(s, 'recall');
      run.color.set(run.o.color ?? s.creature?.color ?? '#ffffff');
    },
    pose(u, run, s, out) {
      if (run.reduced) return;
      const shrink = 1 - easeInCubic(u);
      out.sx = Math.max(0.04, shrink * (1 - 0.35 * u));
      out.sy = Math.max(0.04, shrink);
    },
    visual(u, run, s, visual) {
      if (run.reduced) visual.opacity = 1 - u;
      else {
        visual.fill = clamp01(u / 0.3);
        // The colour burns to white as it collapses into a point of light.
        visual.fillColor.copy(run.color).lerp(WHITE, clamp01((u - 0.55) / 0.45));
      }
      visual.blob = 1 - u;
    },
    end(layer, s) {
      s.visual.shown = false;
    },
  },
  enter: {
    defaults: { dropPx: 20, ms: 360 },
    reducedMs: 150,
    duration: (o) => o.ms,
    begin(layer, s, run) {
      layer.setPhase(s, 'enter');
      s.visual.shown = true;
      run.drop = layer.pxToWorld(s, run.o.dropPx);
      run.color.set(s.creature?.color ?? '#ffffff');
    },
    pose(u, run, s, out) {
      if (run.reduced) return;
      const land = (u - 0.45) / 0.55,
        grow = 0.72 + 0.28 * easeOutBack(clamp01(u / 0.3)),
        squash = land > 0 ? Math.sin(land * Math.PI * 1.5) * (1 - land) ** 1.5 * 0.13 * s.weight : 0;
      out.oy = u < 0.45 ? run.drop * (1 - easeInQuad(u / 0.45)) : 0;
      out.sx = grow * (1 + 0.7 * squash);
      out.sy = grow * (1 - squash);
      if (land > 0 && !run.landed) {
        run.landed = true;
        s.dust = 0;
      }
    },
    visual(u, run, s, visual) {
      if (run.reduced) {
        visual.opacity = u;
        return;
      }
      visual.fill = ENTER_FILL * (1 - easeOutQuad(clamp01(u / 0.35)));
      visual.fillColor.copy(run.color);
      visual.blob = clamp01(u / 0.45);
    },
    end(layer, s) {
      layer.setPhase(s, 'idle');
    },
  },
  victory: {
    defaults: { hops: 2, ms: 600 },
    reduced: 'skip',
    duration: (o) => o.ms,
    begin(layer, s, run) {
      run.height = (0.16 / s.weight) * s.heightWorld;
      run.landed = -1;
    },
    // Each hop: crouch (anticipation), stretch on take-off, parabola, squash on landing (+ dust).
    pose(u, run, s, out) {
      const hops = Math.max(1, run.o.hops),
        index = Math.min(hops - 1, Math.floor(u * hops)),
        w = u >= 1 ? 1 : u * hops - index,
        air = clamp01((w - 0.18) / 0.64),
        crouch = w < 0.18 ? Math.sin((Math.PI * w) / 0.18) : 0,
        land = w > 0.82 ? Math.sin((Math.PI * (w - 0.82)) / 0.18) : 0,
        stretch = w >= 0.18 && w <= 0.82 ? Math.max(0, 1 - Math.abs(air * 2 - 0.35) * 2) : 0,
        squash = 0.12 * s.weight * (crouch + land) - 0.07 * stretch;
      if (w > 0.82 && run.landed !== index) {
        run.landed = index;
        s.dust = 0;
      }
      out.oy = run.height * 4 * air * (1 - air);
      out.sy = 1 - squash;
      out.sx = 1 + 0.7 * squash;
    },
  },
  idle: {
    defaults: {},
    reduced: 'rest',
    duration: () => 120,
    blendAll: true,
  },
};
// ko: 1-frame flash, squash and a 6 % sink into the pad.
function koPose(s, amount, out) {
  out.oy = -0.06 * s.heightWorld * amount;
  out.sy = 1 - 0.1 * amount;
  out.sx = 1 + 0.06 * amount;
}
const MOTION = new Set(Object.keys(REACTIONS));
const WHITE = new THREE.Color('#ffffff');

function copyPose(target, source) {
  target.ox = source.ox;
  target.oy = source.oy;
  target.oz = source.oz;
  target.sx = source.sx;
  target.sy = source.sy;
  target.bend = source.bend;
  return target;
}

function spriteLuminance(image) {
  const canvas =
      typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(CANVAS, CANVAS)
        : Object.assign(document.createElement('canvas'), { width: CANVAS, height: CANVAS }),
    context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, CANVAS, CANVAS);
  const data = context.getImageData(0, 0, CANVAS, CANVAS).data;
  let sum = 0,
    count = 0;
  for (let index = 0; index < data.length; index += 4)
    if (data[index + 3] > 127) {
      sum += 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
      count++;
    }
  return count ? sum / count / 255 : 0.5;
}

export class FighterLayer {
  #scratch = {
    quat: new THREE.Quaternion(),
    up: new THREE.Vector3(),
    right: new THREE.Vector3(),
    v1: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    size: new THREE.Vector2(),
    pose: { ...REST_POSE },
  };

  constructor({
    scene,
    camera,
    renderer,
    stage,
    quality,
    reducedMotion = false,
    highContrast = false,
    testAnimationScale = 1,
    wake = () => {},
    onPlaced = () => {},
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.reducedMotion = reducedMotion;
    this.instant = testAnimationScale === 0;
    this.wake = wake;
    this.onPlaced = onPlaced;
    this.tier = quality?.tier ?? 'high';
    this.disposed = false;
    this.paused = false;
    this.luminance = new Map();
    this.geometry = new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
    // Stage-wide uniforms shared by both bodies: grade, key light, arena tint, outline.
    this.shared = {
      uGrade: { value: new THREE.Vector3(1, 0, 1) },
      uArenaTint: { value: new THREE.Vector3(1, 1, 1) },
      uLightStep: { value: new THREE.Vector2(1, 1) },
      uOutline: { value: new THREE.Vector4(1, 1, 1, highContrast ? 1 : 0) },
    };
    this.rim = { color: new THREE.Color('#fff4dc'), amount: 0.5 };
    this.sides = {};
    for (const side of SIDES) this.sides[side] = this.createSide(side, stage);
    this.blob = this.createBlobs();
  }

  createSide(side, stage) {
    const material = new THREE.ShaderMaterial({
        uniforms: {
          ...this.shared,
          uMap: { value: null },
          uFlip: { value: side === 'enemy' ? 1 : 0 },
          uQuad: { value: new THREE.Vector4(-1, -1, CANVAS + 1, CANVAS + 1) },
          uFeet: { value: new THREE.Vector2(CANVAS / 2, 0) },
          uTexelWorld: { value: 0 },
          uScale: { value: new THREE.Vector2(1, 1) },
          uBend: { value: 0 },
          uHeight: { value: CANVAS },
          uBody: { value: new THREE.Vector4(0, 40, 80, CANVAS) },
          uBreath: { value: new THREE.Vector3() },
          uOcclusion: { value: 20 },
          uRim: { value: new THREE.Vector4(1, 1, 1, 0) },
          uFlash: { value: new THREE.Vector4() },
          uTint: { value: new THREE.Vector4() },
          uDissolve: { value: new THREE.Vector4() },
          uHue: { value: 0 },
          uOpacity: { value: 1 },
        },
        vertexShader: bodyVertex,
        fragmentShader: bodyFragment,
        // Opaque pass (after the stage, before the transparent FX) with blending for the fades.
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
      mesh = new THREE.Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = side === 'player' ? 3 : 2;
    mesh.matrixAutoUpdate = true;
    this.scene.add(mesh);
    return {
      side,
      proxy: stage?.querySelector(`#fighter-${side}`) ?? null,
      mesh,
      material,
      uniforms: material.uniforms,
      flip: side === 'enemy',
      base: { position: new THREE.Vector3(), canvasHeight: 0, range: [0, 0], set: false },
      rest: new THREE.Vector3(),
      restUp: new THREE.Vector3(0, 1, 0),
      texelWorld: 0,
      heightWorld: 0,
      cssPxPerWorld: 0,
      blob: { rx: 0, rz: 0 },
      creature: null,
      loading: null,
      token: 0,
      phase: 'idle',
      pose: { ...REST_POSE },
      visual: { shown: true, opacity: 1, fill: 0, fillColor: new THREE.Color(), dissolve: 0, blob: 1 },
      motion: null,
      overlay: null,
      tint: { color: new THREE.Color(), amount: 0, fromAmount: 0, to: 0, ms: 0, t: 0 },
      dust: -1,
      breathMs: 0,
      weight: 1,
    };
  }

  createBlobs() {
    const geometry = new THREE.BufferGeometry(),
      corners = [-1, -1, 1, -1, 1, 1, -1, 1];
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 1].flatMap(() => corners.flatMap((value, index) => (index % 2 ? [value, 0] : [value]))),
        3
      )
    );
    geometry.setAttribute('aSide', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 1, 1, 1], 1));
    // Counter-clockwise seen from above (+y): the quads face the camera.
    geometry.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
    const material = new THREE.ShaderMaterial({
        uniforms: {
          uBlob: { value: [new THREE.Vector4(), new THREE.Vector4()] },
          uShade: { value: [new THREE.Vector4(0, 0, -1, 0), new THREE.Vector4(0, 0, -1, 0)] },
          uDustColor: { value: new THREE.Color('#f4ead8') },
        },
        vertexShader: blobVertex,
        fragmentShader: blobFragment,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        depthWrite: false,
      }),
      mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = false;
    this.scene.add(mesh);
    return { mesh, geometry, material, uniforms: material.uniforms };
  }

  /* ---------------------------------------------------------------- public API (§8.1) */

  setCreature(side, creatureId, { variant = 'normal', hue = 0 } = {}) {
    const s = this.sides[side];
    if (!s) throw new TypeError(`Unknown fighter side: ${side}`);
    if (this.disposed) return Promise.resolve(false);
    if (s.loading?.id === creatureId && s.loading.variant === variant) return s.loading.promise;
    if (!s.loading && s.creature?.id === creatureId && s.creature.variant === variant) {
      s.uniforms.uHue.value = hue;
      return Promise.resolve(true);
    }
    s.loading?.settle(false);
    const token = ++s.token,
      image = new Image(),
      loading = { id: creatureId, variant, settle: null, promise: null };
    loading.promise = new Promise((resolve) => {
      loading.settle = (placed) => {
        if (s.loading === loading) s.loading = null;
        resolve(placed);
      };
    });
    s.loading = loading;
    image.decoding = 'async';
    image.src = `./assets/monsters/${creatureId}/${variant === 'chromatique' ? 'battle-shiny' : 'battle'}.png`;
    image.decode().then(
      () => {
        if (token !== s.token || this.disposed) return loading.settle(false);
        this.place(s, creatureId, variant, hue, image);
        loading.settle(true);
      },
      (error) => {
        if (token === s.token && !this.disposed) console.error(`Fighter sprite failed: ${creatureId}`, error);
        loading.settle(false);
      }
    );
    return loading.promise;
  }

  react(side, reaction, opts = {}) {
    const s = this.sides[side];
    if (!s) throw new TypeError(`Unknown fighter side: ${side}`);
    if (reaction === 'tint') return this.reactTint(s, opts);
    if (reaction === 'flash') return this.reactFlash(s, opts);
    const spec = REACTIONS[reaction];
    if (!MOTION.has(reaction)) throw new TypeError(`Unknown fighter reaction: ${reaction}`);
    if (this.disposed) return Promise.resolve(false);
    const o = { ...spec.defaults, ...opts },
      reduced = this.reducedMotion && !this.instant && !opts.instant;
    if (this.instant || opts.instant) {
      this.supersedeMotion(s);
      spec.begin?.(this, s, this.newRun(s, spec, o, false));
      s.overlay = null;
      copyPose(s.pose, REST_POSE);
      spec.endPose?.(s, s.pose);
      this.resetVisual(s);
      spec.end?.(this, s);
      this.syncVisibility(s);
      this.wake();
      return Promise.resolve(true);
    }
    if (reduced && spec.reduced) {
      if (spec.reduced === 'flash')
        this.startOverlay(s, { color: '#ffffff', peak: 1, ms: 0, shape: 'frame' });
      if (spec.reduced === 'rest') {
        this.supersedeMotion(s);
        copyPose(s.pose, REST_POSE);
      }
      this.wake();
      return Promise.resolve(true);
    }
    this.supersedeMotion(s);
    const run = this.newRun(s, spec, o, reduced);
    run.ms = reduced ? spec.reducedMs : spec.duration(o);
    run.blendMs = spec.blendAll ? run.ms : Math.min(90, run.ms / 2);
    s.motion = run;
    spec.begin?.(this, s, run);
    this.syncVisibility(s);
    this.wake();
    return run.promise;
  }

  phase(side) {
    return this.sides[side].phase;
  }

  /* ---------------------------------------------------------------- internal API (3A ↔ 3B) */

  /**
   * `{ player?: { position: [x, y, z], canvasHeight, canvasRange: [lo, hi] }, enemy?: … }` in world
   * units, feet on the pad top. Texel snapping keeps the effective canvas height inside `canvasRange`.
   */
  setLayout(layout) {
    for (const side of SIDES) {
      const entry = layout?.[side];
      if (!entry) continue;
      const s = this.sides[side];
      s.base.position.fromArray(entry.position);
      s.base.canvasHeight = entry.canvasHeight;
      s.base.range = entry.canvasRange ?? [entry.canvasHeight, entry.canvasHeight];
      s.base.set = true;
      this.snap(s);
    }
    this.wake();
  }

  restAnchor(side, point = 'center', out = new THREE.Vector3()) {
    const s = this.sides[side],
      height = s.heightWorld * (point === 'head' ? 1 : point === 'center' ? 0.5 : 0);
    return out.copy(s.rest).addScaledVector(s.restUp, height);
  }

  /** World size of one sprite texel of `side`'s creature (0 before the stage layout is set). */
  texelWorld(side) {
    return this.sides[side].texelWorld;
  }

  worldAnchor(side, point = 'center', out = new THREE.Vector3()) {
    const s = this.sides[side],
      height = s.heightWorld * s.pose.sy * (point === 'head' ? 1 : point === 'center' ? 0.5 : 0);
    this.camera.getWorldQuaternion(this.#scratch.quat);
    return out
      .copy(s.rest)
      .add(this.#scratch.v2.set(s.pose.ox, s.pose.oy, s.pose.oz))
      .addScaledVector(this.#scratch.up.set(0, 1, 0).applyQuaternion(this.#scratch.quat), height);
  }

  update(fxDtMs = 0, realDtMs = 0) {
    if (this.disposed) return;
    const fx = Math.max(0, fxDtMs),
      real = Math.min(100, Math.max(0, realDtMs));
    this.camera.getWorldQuaternion(this.#scratch.quat);
    for (const side of SIDES) this.step(this.sides[side], fx, real);
    this.writeBlobs();
  }

  isActive() {
    return SIDES.some((side) => {
      const s = this.sides[side];
      return Boolean(s.motion || s.overlay || s.tint.t < s.tint.ms || s.dust >= 0);
    });
  }

  setGrade({ saturation = 1, exposure = 0, contrast = 1 } = {}) {
    this.shared.uGrade.value.set(saturation, exposure, contrast);
  }

  /** Stage key light: `rim` / `tint` linear RGB 0–1, `lightDir` screen-space towards the light. */
  setLight({ rim = [1, 0.96, 0.86], rimAmount = 0.5, lightDir = [0.8, 0.6], tint = [1, 1, 1] } = {}) {
    this.rim.color.setRGB(rim[0], rim[1], rim[2]);
    this.rim.amount = rimAmount;
    const length = Math.hypot(lightDir[0], lightDir[1]) || 1;
    this.shared.uLightStep.value.set(Math.round(lightDir[0] / length), Math.round(lightDir[1] / length));
    this.shared.uArenaTint.value.set(tint[0], tint[1], tint[2]);
    this.blob.uniforms.uDustColor.value.setRGB(rim[0], rim[1], rim[2]).lerp(WHITE, 0.55);
    for (const side of SIDES) this.writeRim(this.sides[side]);
    this.wake();
  }

  setQuality(quality) {
    this.tier = quality?.tier ?? this.tier;
    for (const side of SIDES) this.sides[side].uniforms.uBreath.value.set(0, 0, 0);
    this.wake();
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
  }

  /** Both current sprites placed (or failed: `false`). */
  get ready() {
    return Promise.all(
      SIDES.map((side) => {
        const s = this.sides[side];
        return s.loading ? s.loading.promise : Promise.resolve(Boolean(s.creature));
      })
    ).then((placed) => placed.every(Boolean));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const side of SIDES) {
      const s = this.sides[side];
      s.token++;
      s.loading?.settle(false);
      s.motion?.resolve(false);
      s.overlay?.resolve?.(false);
      s.motion = s.overlay = null;
      s.creature?.texture.dispose();
      s.creature = null;
      s.material.dispose();
      this.scene.remove(s.mesh);
    }
    this.geometry.dispose();
    this.blob.geometry.dispose();
    this.blob.material.dispose();
    this.scene.remove(this.blob.mesh);
  }

  /* ---------------------------------------------------------------- placement */

  place(s, creatureId, variant, hue, image) {
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.NoColorSpace;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.renderer?.initTexture(texture);
    const lumaKey = `${creatureId}:${variant}`;
    if (!this.luminance.has(lumaKey)) this.luminance.set(lumaKey, spriteLuminance(image));
    const random = fxRandom(fxSeed(creatureId)),
      layout = spriteLayout(creatureId);
    s.creature?.texture.dispose();
    s.creature = {
      id: creatureId,
      variant,
      texture,
      layout,
      color: new THREE.Color(AFFINITIES[CREATURES[creatureId].affinity].color),
      // Dark sprites on dark arenas need more rim to separate from the stage.
      rimBoost: 1 + Math.min(0.8, Math.max(0, (0.34 - this.luminance.get(lumaKey)) * 3)),
      breath: {
        period: BREATH_PERIOD_MS[layout.sizeClass] ?? BREATH_PERIOD_MS.M,
        phase: random() * Math.PI * 2,
        sway: random() * Math.PI * 2,
      },
    };
    const u = s.uniforms;
    u.uMap.value = texture;
    u.uHue.value = hue;
    u.uBody.value.set(
      layout.feetY,
      layout.feetY + Math.round(layout.height * 0.32),
      layout.feetY + Math.round(layout.height * 0.62),
      layout.headY
    );
    u.uHeight.value = layout.height;
    const left = s.flip ? CANVAS - 1 - layout.x1 : layout.x0,
      right = s.flip ? CANVAS - 1 - layout.x0 : layout.x1;
    u.uQuad.value.set(
      Math.max(-1, left - QUAD_MARGIN),
      Math.max(-1, layout.feetY - QUAD_MARGIN),
      Math.min(CANVAS + 1, right + 1 + QUAD_MARGIN),
      Math.min(CANVAS + 1, layout.headY + QUAD_MARGIN)
    );
    u.uOcclusion.value = Math.max(1, layout.height * 0.16);
    u.uBreath.value.set(0, 0, 0);
    // A new creature starts clean; the director re-applies its status tint.
    s.tint.amount = s.tint.to = 0;
    s.tint.t = s.tint.ms = 0;
    s.overlay?.resolve?.(false);
    s.overlay = null;
    s.breathMs = 0;
    s.weight = WEIGHT[layout.sizeClass] ?? 1;
    this.writeRim(s);
    this.snap(s);
    this.syncVisibility(s);
    this.onPlaced(s.side, creatureId);
    this.wake();
  }

  // Rest placement for the current creature: mass-normalised texel size, snapped to whole device
  // pixels when close enough, and the canvas corner aligned to the pixel grid. A drawing buffer the
  // browser rescales (DPR capped below the screen's) cannot be pixel-exact, so it keeps exact sizes.
  snap(s) {
    if (!s.base.set) return;
    const { v1, v2, size } = this.#scratch,
      camera = this.camera,
      layout = s.creature?.layout ?? FULL_CANVAS,
      quat = this.#scratch.quat;
    camera.updateMatrixWorld();
    camera.getWorldQuaternion(quat);
    const right = this.#scratch.right.set(1, 0, 0).applyQuaternion(quat);
    s.restUp.set(0, 1, 0).applyQuaternion(quat);
    const depth = Math.max(1e-3, -v1.copy(s.base.position).applyMatrix4(camera.matrixWorldInverse).z),
      buffer = this.renderer.getDrawingBufferSize(size),
      devicePxPerWorld = ((buffer.y / 2) * camera.projectionMatrix.elements[5]) / depth;
    s.cssPxPerWorld = devicePxPerWorld / this.renderer.getPixelRatio();
    let texel = s.creature ? massTexel(s.creature.id) * s.base.canvasHeight : s.base.canvasHeight / CANVAS;
    const idealPx = texel * devicePxPerWorld,
      // Snapping scales the effective canvas by k / idealPx: allowed only inside the stage's range.
      [lo, hi] = s.base.range.map((height) => height / s.base.canvasHeight),
      snapped = [Math.floor(idealPx), Math.ceil(idealPx)]
        .filter((k) => k >= 1 && k / idealPx >= lo - 1e-9 && k / idealPx <= hi + 1e-9)
        .sort((a, b) => Math.abs(a / idealPx - 1) - Math.abs(b / idealPx - 1))[0];
    if (snapped && this.renderer.getPixelRatio() >= (globalThis.devicePixelRatio || 1) - 1e-3)
      texel = snapped / devicePxPerWorld;
    s.texelWorld = texel;
    s.heightWorld = layout.height * texel;
    const feetX = s.flip ? CANVAS - layout.feetX : layout.feetX;
    s.rest.copy(s.base.position);
    v2.copy(s.rest)
      .addScaledVector(right, -feetX * texel)
      .addScaledVector(s.restUp, -layout.feetY * texel)
      .project(camera);
    const px = ((v2.x + 1) / 2) * buffer.x,
      py = ((1 - v2.y) / 2) * buffer.y;
    s.rest
      .addScaledVector(right, (Math.round(px) - px) / devicePxPerWorld)
      .addScaledVector(s.restUp, -(Math.round(py) - py) / devicePxPerWorld);
    const u = s.uniforms;
    u.uTexelWorld.value = texel;
    u.uFeet.value.set(feetX, layout.feetY);
    // Contact shadow: a little narrower than the body, deep enough to read at the camera pitch.
    const toCamera = v1.copy(camera.getWorldPosition(v1)).sub(s.base.position),
      pitch = Math.max(0.08, toCamera.y / Math.max(1e-3, toCamera.length()));
    s.blob.rx = 0.42 * layout.width * texel;
    s.blob.rz = s.blob.rx * Math.min(1.1, Math.max(0.35, 0.3 / pitch));
    this.writeFrame(s);
  }

  /* ---------------------------------------------------------------- reactions */

  newRun(s, spec, o, reduced) {
    const run = {
      spec,
      o,
      reduced,
      elapsed: 0,
      ms: 0,
      blendMs: 0,
      from: copyPose({}, s.pose),
      toward: o.toward ?? OTHER[s.side],
      vector: new THREE.Vector3(),
      color: new THREE.Color(),
      screenSign: 1,
      resolve: null,
      promise: null,
    };
    run.promise = new Promise((resolve) => (run.resolve = resolve));
    // +1 when the other side is to the right on screen: leans and bends follow the screen.
    const other = this.sides[run.toward];
    this.camera.getWorldQuaternion(this.#scratch.quat);
    run.screenSign =
      Math.sign(
        this.#scratch.v1
          .copy(other.rest)
          .sub(s.rest)
          .dot(this.#scratch.right.set(1, 0, 0).applyQuaternion(this.#scratch.quat))
      ) || (s.side === 'player' ? 1 : -1);
    return run;
  }

  // A new motion reaction takes over from the current pose; the old one jumps to its end state
  // for visibility and phase (a superseded recall still leaves the pad empty).
  supersedeMotion(s) {
    const run = s.motion;
    if (!run) return;
    s.motion = null;
    this.resetVisual(s);
    run.spec.end?.(this, s);
    this.syncVisibility(s);
    run.resolve(false);
  }

  reactTint(s, { status = null, amount = 0.15, ms = 200, instant = false } = {}) {
    if (this.disposed) return Promise.resolve(false);
    const tint = s.tint,
      color = status ? STATUS_DEFINITIONS[status]?.color : null;
    if (status && !color) throw new TypeError(`Unknown status for tint: ${status}`);
    tint.fromAmount = tint.amount;
    if (color) tint.color.set(color);
    tint.to = color ? amount : 0;
    if (this.instant || instant || this.reducedMotion || ms <= 0) {
      tint.amount = tint.to;
      tint.t = tint.ms = 0;
    } else {
      tint.t = 0;
      tint.ms = ms;
    }
    this.wake();
    return Promise.resolve(true);
  }

  reactFlash(s, { color = '#ffffff', ms = 90, instant = false } = {}) {
    if (this.disposed) return Promise.resolve(false);
    if (this.instant || instant) return Promise.resolve(true);
    const overlay = this.reducedMotion
      ? this.startOverlay(s, { color, peak: 1, ms: 0, shape: 'frame' })
      : this.startOverlay(s, { color, peak: FLASH_PEAK, ms, shape: 'pulse' });
    overlay.promise = new Promise((resolve) => (overlay.resolve = resolve));
    return overlay.promise;
  }

  // Overlay channel (uFlash): hit / ko white frame then colour fade, or a `flash` pulse. `white`
  // is the opacity of that first white frame.
  startOverlay(s, { color, peak, ms, shape, white = 1 }) {
    s.overlay?.resolve?.(false);
    s.overlay = {
      color: new THREE.Color(color),
      peak,
      ms,
      shape,
      white,
      elapsed: 0,
      whiteFrames: shape === 'fade' || shape === 'frame' ? 1 : 0,
      resolve: null,
      promise: null,
    };
    this.wake();
    return s.overlay;
  }

  setPhase(s, phase) {
    s.phase = phase;
    if (s.proxy) s.proxy.dataset.phase = phase;
  }

  resetVisual(s) {
    const visual = s.visual;
    visual.opacity = 1;
    visual.fill = 0;
    visual.dissolve = 0;
    visual.blob = 1;
  }

  syncVisibility(s) {
    s.mesh.visible = Boolean(s.creature && s.visual.shown && s.base.set);
  }

  floorVector(fromSide, toSide, out) {
    return out.copy(this.sides[toSide].rest).sub(this.sides[fromSide].rest).setY(0);
  }

  pxToWorld(s, px) {
    return px / (s.cssPxPerWorld || 100);
  }

  /* ---------------------------------------------------------------- per frame */

  step(s, fx, real) {
    const run = s.motion;
    if (run) {
      run.elapsed += fx;
      const u = run.ms > 0 ? clamp01(run.elapsed / run.ms) : 1,
        target = copyPose(this.#scratch.pose, REST_POSE);
      this.resetVisual(s);
      run.spec.pose?.(u, run, s, target);
      run.spec.visual?.(u, run, s, s.visual);
      const fade = run.spec.keepFrom ? 1 : 1 - easeOutQuad(clamp01(run.elapsed / Math.max(1, run.blendMs))),
        from = run.from,
        pose = s.pose;
      pose.ox = target.ox + from.ox * fade;
      pose.oy = target.oy + from.oy * fade;
      pose.oz = target.oz + from.oz * fade;
      pose.sx = target.sx * (1 + (from.sx - 1) * fade);
      pose.sy = target.sy * (1 + (from.sy - 1) * fade);
      pose.bend = target.bend + from.bend * fade;
      if (u >= 1) {
        s.motion = null;
        if (run.spec.endPose) run.spec.endPose(s, copyPose(pose, REST_POSE));
        else copyPose(pose, REST_POSE);
        this.resetVisual(s);
        run.spec.end?.(this, s);
        this.syncVisibility(s);
        run.resolve(true);
      }
    }
    this.stepOverlay(s, fx);
    const tint = s.tint;
    if (tint.t < tint.ms) {
      tint.t = Math.min(tint.ms, tint.t + fx);
      const k = easeOutQuad(tint.t / tint.ms);
      tint.amount = tint.fromAmount + (tint.to - tint.fromAmount) * k;
    }
    if (s.dust >= 0) {
      s.dust += fx / DUST_MS;
      if (s.dust >= 1) s.dust = -1;
    }
    this.stepBreath(s, real);
    this.writeFrame(s);
  }

  stepOverlay(s, fx) {
    const overlay = s.overlay,
      flash = s.uniforms.uFlash.value;
    flash.set(0, 0, 0, 0);
    if (overlay) {
      if (overlay.whiteFrames > 0) {
        // Exactly one rendered frame of white (or the flash colour when reduced), then the fade.
        overlay.whiteFrames--;
        const c = overlay.shape === 'frame' ? overlay.color : WHITE;
        flash.set(c.r, c.g, c.b, overlay.white);
      } else if (overlay.shape === 'frame' || overlay.elapsed >= overlay.ms) {
        s.overlay = null;
        overlay.resolve?.(true);
      } else {
        overlay.elapsed += fx;
        const u = clamp01(overlay.elapsed / overlay.ms),
          amount = overlay.peak * (overlay.shape === 'pulse' ? Math.sin(Math.PI * u) : (1 - u) ** 2);
        flash.set(overlay.color.r, overlay.color.g, overlay.color.b, amount);
      }
    }
    const visual = s.visual;
    if (visual.fill > flash.w)
      flash.set(visual.fillColor.r, visual.fillColor.g, visual.fillColor.b, visual.fill);
  }

  // Idle breathing on real time, whole texels only: low drops the upper body one row at the
  // waist, mid adds a second row at the chest (a stepped squash), high adds a one-texel sway.
  stepBreath(s, real) {
    const breath = s.uniforms.uBreath.value;
    if (this.reducedMotion || this.instant || !s.creature || this.paused) {
      breath.set(0, 0, 0);
      return;
    }
    s.breathMs += real;
    const { period, phase, sway } = s.creature.breath,
      wave = Math.sin((s.breathMs / period) * Math.PI * 2 + phase);
    if (this.tier === 'low') breath.set(wave > 0.3 ? 1 : 0, 0, 0);
    else
      breath.set(
        wave > -0.15 ? 1 : 0,
        wave > 0.55 ? 1 : 0,
        this.tier === 'high'
          ? Math.round(Math.sin((s.breathMs / (period * 1.9)) * Math.PI * 2 + sway) * 1.2)
          : 0
      );
  }

  writeRim(s) {
    const boost = s.creature?.rimBoost ?? 1;
    s.uniforms.uRim.value.set(this.rim.color.r, this.rim.color.g, this.rim.color.b, this.rim.amount * boost);
  }

  writeFrame(s) {
    const { pose, visual, uniforms: u, mesh } = s;
    mesh.position.set(s.rest.x + pose.ox, s.rest.y + pose.oy, s.rest.z + pose.oz);
    mesh.quaternion.copy(this.#scratch.quat);
    u.uScale.value.set(pose.sx, pose.sy);
    u.uBend.value = pose.bend;
    u.uOpacity.value = visual.opacity;
    // A fading body stops writing depth so what stands behind it keeps showing through.
    s.material.depthWrite = visual.opacity > 0.999;
    const tint = s.tint;
    u.uTint.value.set(tint.color.r, tint.color.g, tint.color.b, tint.amount);
    const edge = s.creature?.color ?? WHITE;
    u.uDissolve.value.set(edge.r, edge.g, edge.b, visual.dissolve);
  }

  writeBlobs() {
    const { uBlob, uShade } = this.blob.uniforms;
    let any = false;
    SIDES.forEach((side, index) => {
      const s = this.sides[side],
        shown = s.mesh.visible,
        lift = s.heightWorld > 0 ? clamp01(Math.max(0, s.pose.oy) / s.heightWorld) : 0,
        shrink = 1 - 0.35 * clamp01(lift * 3),
        spread = Math.max(s.pose.sx, 0);
      uBlob.value[index].set(
        s.rest.x + s.pose.ox,
        s.base.position.y + 0.004,
        s.rest.z + s.pose.oz,
        s.blob.rx * shrink * spread
      );
      uShade.value[index].set(
        s.blob.rz * shrink * spread,
        shown ? BLOB_ALPHA * s.visual.blob * (1 - clamp01(lift * 2.5)) : 0,
        s.dust,
        this.reducedMotion ? 0 : 0.5
      );
      any ||= shown || s.dust >= 0;
    });
    this.blob.mesh.visible = any;
  }
}
