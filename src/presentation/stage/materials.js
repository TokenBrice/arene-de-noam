// Unlit stage materials. One shared ShaderMaterial program draws the backdrop plate, the floor
// (court + apron + dynamic pad pools + optional glossy reflection) and the pads; one Points
// program draws the ambient motes and the crowd flash-bulbs; high tier adds one light-shaft
// program. Textures (painted plates decoded as ImageBitmaps, or the fallback painter's canvases)
// are NoColorSpace and shaders write raw display-space sRGB, so the grade maths matches the
// fighter shader (3B): c = mix(luma, c, sat); c *= 1 + exposure; c = (c − 0.5)·contrast + 0.5.
import * as THREE from 'three';

const GRADE = /* glsl */ `
uniform vec3 uGrade;
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGrade.x) * (1.0 + uGrade.y);
  return (c - 0.5) * uGrade.z + 0.5;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

const STAGE_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying float vUp;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vUp = normalize(mat3(modelMatrix) * normal).y;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const STAGE_FRAGMENT = /* glsl */ `
${GRADE}
uniform sampler2D map;
uniform sampler2D uPlate;
uniform float uMode, uLift, uFocus, uTime, uCheer, uReflect, uGloss;
uniform vec2 uCrowd, uPlateAz, uPlateEl;
uniform vec3 uWall;          // camera base x, height, z (the panorama centre)
uniform float uWallRadius;
uniform float uCourtRadius;
uniform vec2 uCourtAxis;
uniform vec3 uApron, uPool, uPadP, uPadE, uSide, uRim;
varying vec2 vUv;
varying vec3 vWorld;
varying float vUp;

vec2 plateUv(vec3 p) {
  vec2 d = p.xz - uWall.xz;
  float az = degrees(atan(d.x, -d.y));
  float el = degrees(atan((p.y - uWall.y) / uWallRadius));
  return vec2((az - uPlateAz.x) / (uPlateAz.y - uPlateAz.x), (el - uPlateEl.x) / (uPlateEl.y - uPlateEl.x));
}

vec3 backdrop() {
  vec2 uv = vUv;
  float crowd = step(uCrowd.x, uv.y) * step(uv.y, uCrowd.y);
  // The crowd jumps in waves while cheering.
  uv.y -= crowd * uCheer * 0.004 * max(0.0, sin(uTime * 15.0 + uv.x * 220.0));
  vec3 c = texture2D(map, uv).rgb;
  // Phone screens twinkling in the stands.
  vec2 cell = floor(vec2(uv.x * 680.0, uv.y * 170.0));
  c += crowd * step(0.9982, hash(cell + floor(uTime * 3.0))) * 0.4;
  // House lights dim with tension: the stands step back, the pads hold the light.
  return c * (1.0 - uFocus * 0.26) * (1.0 + uCheer * crowd * 0.12);
}

float pool(vec3 pad, vec2 p) {
  return smoothstep(pad.z * 2.6, pad.z * 0.8, length(p - pad.xy));
}
float contact(vec3 pad, vec2 p) {
  return smoothstep(pad.z * 1.32, pad.z * 0.98, length(p - pad.xy));
}

vec3 floorColor() {
  vec2 p = vWorld.xz;
  float d = length(p);
  vec2 q = vec2(dot(p, uCourtAxis), dot(p, vec2(-uCourtAxis.y, uCourtAxis.x))) / uCourtRadius;
  vec3 court = texture2D(map, q * 0.5 + 0.5).rgb;
  float wallDist = length(p - uWall.xz) / uWallRadius;
  float away = clamp((d - uCourtRadius) / max(1.0, uWallRadius * 0.55), 0.0, 1.0);
  // Apron: the court's outer field, a track line, and the LED wall's spill at the stands' base.
  vec3 apron = uApron * mix(1.0, 0.72, away)
    + uPool * (pow(smoothstep(0.8, 1.0, wallDist), 2.0) * 0.3
    + smoothstep(0.006, 0.0, abs(d / uCourtRadius - 1.08)) * 0.14);
  float inCourt = smoothstep(uCourtRadius * 1.004, uCourtRadius * 0.996, d);
  vec3 c = mix(apron, court, inCourt);
  float lit = max(pool(uPadP, p), pool(uPadE, p));
  c += uPool * lit * (0.16 + uFocus * 0.12);
  c *= 1.0 - 0.5 * max(contact(uPadP, p), contact(uPadE, p));
  if (uReflect > 0.0 && inCourt > 0.0) {
    // Glossy court: reflect the view ray off the floor and look it up on the panorama.
    vec3 i = normalize(vWorld - cameraPosition);
    vec3 r = vec3(i.x, -i.y, i.z);
    vec2 o = vWorld.xz - uWall.xz;
    float a = dot(r.xz, r.xz), b = dot(o, r.xz), k = dot(o, o) - uWallRadius * uWallRadius;
    float t = (-b + sqrt(max(0.0, b * b - a * k))) / max(a, 1e-4);
    vec3 refl = texture2D(uPlate, plateUv(vWorld + r * t), 2.5).rgb;
    float fresnel = mix(0.18, 1.0, pow(1.0 - clamp(-i.y, 0.0, 1.0), 4.0));
    c += refl * uGloss * uReflect * fresnel * inCourt * (1.0 - 0.6 * lit);
  }
  return c * mix(1.0, 0.8, uFocus * (1.0 - lit));
}

vec3 pad() {
  if (vUp > 0.5) return texture2D(map, vUv).rgb * uLift;
  float v = vUv.y;
  return uSide * mix(0.45, 1.1, v) + uRim * smoothstep(0.55, 1.0, v) * 0.85 * uLift;
}

void main() {
  vec3 c = uMode < 0.5 ? backdrop() : uMode < 1.5 ? floorColor() : pad();
  gl_FragColor = vec4(grade(c), 1.0);
}`;

// A stage texture from a painted canvas or a decoded ImageBitmap. WebGL ignores UNPACK_FLIP_Y for
// bitmaps, so they are decoded with `imageOrientation: 'flipY'` and uploaded as-is.
export function stageTexture(image, { mipmaps = true } = {}) {
  const texture = new THREE.Texture(image);
  texture.flipY = !(typeof ImageBitmap === 'function' && image instanceof ImageBitmap);
  texture.colorSpace = THREE.NoColorSpace;
  texture.generateMipmaps = mipmaps;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const vec3 = (hex) => new THREE.Color(hex);

// Uniforms shared by reference between every stage material (one update reaches all).
export function sharedUniforms() {
  return {
    uGrade: { value: new THREE.Vector3(1, 0, 1) },
    uFocus: { value: 0 },
    uTime: { value: 0 },
    uCheer: { value: 0 },
  };
}

export function stageMaterial(shared, mode, extra = {}) {
  return new THREE.ShaderMaterial({
    name: 'stage',
    uniforms: {
      ...shared,
      map: { value: null },
      uPlate: { value: null },
      uMode: { value: mode },
      uLift: { value: 1 },
      uReflect: { value: 0 },
      uGloss: { value: 0 },
      uCrowd: { value: new THREE.Vector2() },
      uPlateAz: { value: new THREE.Vector2() },
      uPlateEl: { value: new THREE.Vector2() },
      uWall: { value: new THREE.Vector3() },
      uWallRadius: { value: 1 },
      uCourtRadius: { value: 1 },
      uCourtAxis: { value: new THREE.Vector2(1, 0) },
      uApron: { value: vec3('#000000') },
      uPool: { value: vec3('#000000') },
      uPadP: { value: new THREE.Vector3(0, 0, 1) },
      uPadE: { value: new THREE.Vector3(0, 0, 1) },
      uSide: { value: vec3('#000000') },
      uRim: { value: vec3('#000000') },
      ...extra,
    },
    vertexShader: STAGE_VERTEX,
    fragmentShader: STAGE_FRAGMENT,
    side: mode === 0 ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// Ambient motes (kind 0, in a world box) and crowd flash-bulbs (kind 1, on the panorama wall),
// animated entirely in the vertex shader: no per-frame buffer upload.
const MOTE_STYLES = { sparkle: 0, drift: 1, rain: 2, ember: 3, ash: 4 };

const POINTS_VERTEX = /* glsl */ `
attribute float aSeed;
attribute float aKind;
attribute float aFire;
uniform float uTime, uMoteTime, uStyle, uSize, uPixelRatio, uWallRadius, uFlashSize;
uniform vec3 uBoxMin, uBoxSize, uWall;
uniform vec2 uBulbSpan;
varying float vAlpha;
varying float vKind;
varying float vSeed;
void main() {
  vKind = aKind;
  vSeed = aSeed;
  vec3 world;
  float size;
  if (aKind < 0.5) {
    vec3 p = position;
    float t = uMoteTime * (0.55 + aSeed * 0.9);
    if (uStyle < 0.5) { p.y = fract(p.y + t * 0.035); p.x += sin(t * 0.7 + aSeed * 30.0) * 0.015; }
    else if (uStyle < 1.5) { p.x = fract(p.x + t * 0.05); p.y = fract(p.y - t * 0.018 + sin(t + aSeed * 20.0) * 0.01); }
    else if (uStyle < 2.5) { p.y = fract(p.y - t * 0.55); p.x = fract(p.x - t * 0.04); }
    else if (uStyle < 3.5) { p.y = fract(p.y + t * 0.09); p.x += sin(t * 2.2 + aSeed * 40.0) * 0.02; }
    else { p.y = fract(p.y - t * 0.03); p.x += sin(t * 1.3 + aSeed * 25.0) * 0.03; }
    world = uBoxMin + p * uBoxSize;
    float twinkle = uStyle < 0.5 ? 0.45 + 0.55 * abs(sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 50.0)) : 1.0;
    vAlpha = smoothstep(0.0, 0.12, p.y) * (1.0 - smoothstep(0.75, 1.0, p.y)) * twinkle;
    size = uSize * (0.55 + aSeed * 0.9);
  } else {
    float az = radians(mix(uBulbSpan.x, uBulbSpan.y, position.x));
    world = vec3(uWall.x + sin(az) * uWallRadius, uWall.y + tan(radians(position.y)) * uWallRadius, uWall.z - cos(az) * uWallRadius);
    float age = uTime - aFire;
    float f = age < 0.0 ? 0.0 : exp(-age * 16.0) + 0.6 * exp(-max(0.0, age - 0.09) * 20.0) * step(0.09, age);
    vAlpha = min(1.0, f);
    size = vAlpha > 0.01 ? uFlashSize * (0.7 + aSeed * 0.6) : 0.0;
  }
  vec4 mv = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aKind < 0.5 ? size * uPixelRatio * 60.0 / -mv.z : size * uPixelRatio;
}`;

const POINTS_FRAGMENT = /* glsl */ `
${GRADE}
uniform vec3 uColor;
uniform float uStyle;
varying float vAlpha;
varying float vKind;
varying float vSeed;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a;
  vec3 col;
  if (vKind < 0.5) {
    a = uStyle > 1.5 && uStyle < 2.5
      ? exp(-(q.x * q.x * 60.0 + q.y * q.y * 1.4))
      : exp(-dot(q, q) * 4.0);
    col = grade(uColor);
  } else {
    float core = exp(-dot(q, q) * 14.0);
    float cross = exp(-abs(q.x) * 22.0 - q.y * q.y * 3.0) + exp(-abs(q.y) * 22.0 - q.x * q.x * 3.0);
    a = core + cross * 0.55;
    col = mix(vec3(1.0), uColor, 0.25);
  }
  a *= vAlpha;
  gl_FragColor = vec4(col * a, a);
}`;

export function pointsMaterial(shared, theme) {
  return new THREE.ShaderMaterial({
    name: 'stage-points',
    uniforms: {
      uGrade: shared.uGrade,
      uTime: shared.uTime,
      uMoteTime: { value: 0 },
      uStyle: { value: MOTE_STYLES[theme.motes.kind] },
      uSize: { value: theme.motes.size },
      uColor: { value: vec3(theme.motes.color) },
      uPixelRatio: { value: 1 },
      uWallRadius: { value: 1 },
      uFlashSize: { value: 22 },
      uBoxMin: { value: new THREE.Vector3() },
      uBoxSize: { value: new THREE.Vector3(1, 1, 1) },
      uWall: { value: new THREE.Vector3() },
      uBulbSpan: { value: new THREE.Vector2(-10, 10) },
    },
    vertexShader: POINTS_VERTEX,
    fragmentShader: POINTS_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// High tier: two soft spotlight shafts falling onto the pads (one draw, additive, narrow).
const SHAFT_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SHAFT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uTime, uStrength;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float body = pow(across, 2.2) * smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  float shimmer = 0.8 + 0.2 * sin(uTime * 1.7 + vUv.y * 9.0 + vUv.x * 4.0);
  float a = body * shimmer * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}`;

export function shaftMaterial(shared, theme) {
  return new THREE.ShaderMaterial({
    name: 'stage-shaft',
    uniforms: { uTime: shared.uTime, uColor: { value: vec3(theme.glow) }, uStrength: { value: 0.16 } },
    vertexShader: SHAFT_VERTEX,
    fragmentShader: SHAFT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}
