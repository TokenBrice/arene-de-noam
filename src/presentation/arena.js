import * as THREE from 'three';

const THEMES = {
  crystal: {
    sky: 0x07132f,
    fog: 0x101d40,
    floor: 0x142950,
    glow: 0x67eaff,
    accent: 0xa67cff,
    secondary: 0xffd97c,
    particle: 'crystal',
  },
  grove: {
    sky: 0x061b18,
    fog: 0x0b2920,
    floor: 0x16392d,
    glow: 0x79f28a,
    accent: 0xd1ff72,
    secondary: 0x4ac8a7,
    particle: 'leaf',
  },
  tidal: {
    sky: 0x021627,
    fog: 0x05283d,
    floor: 0x0a3b50,
    glow: 0x53f5ed,
    accent: 0x4d80ff,
    secondary: 0xd0fbff,
    particle: 'bubble',
  },
  volcano: {
    sky: 0x210805,
    fog: 0x34100a,
    floor: 0x351b1a,
    glow: 0xff5b31,
    accent: 0xffc052,
    secondary: 0xfff08c,
    particle: 'ember',
  },
  astral: {
    sky: 0x090822,
    fog: 0x151036,
    floor: 0x23204b,
    glow: 0xd98cff,
    accent: 0x68dfff,
    secondary: 0xffdd88,
    particle: 'star',
  },
  eclipse: {
    sky: 0x100817,
    fog: 0x1b0b25,
    floor: 0x331735,
    glow: 0xff7ab8,
    accent: 0x8455ff,
    secondary: 0xffbd68,
    particle: 'ash',
  },
};

function material(
  color,
  { emissive = 0.25, metalness = 0.3, roughness = 0.45, transparent = false, opacity = 1 } = {}
) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: emissive,
    metalness,
    roughness,
    transparent,
    opacity,
  });
}

// Frame-rate-independent exponential approach that settles exactly on target.
function approach(value, target, rate) {
  const delta = target - value;
  return Math.abs(delta) < 1e-3 ? target : value + delta * (1 - Math.exp(-rate));
}

// Burst and flash particles live on this world plane (slightly in front of
// the dais centre line); fighter anchors are unprojected onto it.
const FX_PLANE_Z = 0.4;
const BURST_POOL_SIZE = 3;
const BURST_POINTS = 180;
const SPARK_POINTS = 48;

// Soft round dot shared by every additive FX sprite (drawn once, no network).
function softDotTexture() {
  const size = 64,
    canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d'),
    gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.8)');
  gradient.addColorStop(0.65, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class ArenaScene {
  constructor(
    canvas,
    theme = 'crystal',
    { reducedMotion = false, testAnimationScale = 1, quality, governor = null } = {}
  ) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.testAnimationScale = testAnimationScale;
    this.theme = THEMES[theme] ? theme : 'crystal';
    // Tier budget (src/app/quality.js): DPR caps, MSAA, frame caps and dust.
    this.applyProfile(quality.arena);
    this.disposed = false;
    this.paused = false;
    this.animations = [];
    this.tension = 0;
    this.targetTension = 0;
    this.showdown = 0;
    this.targetShowdown = 0;
    this.flashExposure = 0;
    this.anchorResolver = null;
    // Frame governor: renders at activeFps while something is moving fast,
    // ambientFps otherwise (see applyProfile). The quality governor samples
    // this loop's own animation frames.
    this.governor = governor;
    this.lastFrameAt = 0;
    this.nextRender = 0;
    this.frame = undefined;
    this.viewport = { w: 0, h: 0, ratio: 0 };
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.cameraBase = { x: 0, y: 5.2, z: 9.4 };
    this.cameraKick = { x: 0, y: 0, z: 0 };
    this.camera.position.set(this.cameraBase.x, this.cameraBase.y, this.cameraBase.z);
    this.camera.lookAt(0, 0.55, 0);
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.animateBound = this.animate.bind(this);
    this.onVisibilityChange = () => {
      if (this.disposed) return;
      if (document.hidden) {
        this.stopLoop();
        return;
      }
      this.wake();
    };
    this.build(this.theme);
    this.resize();
    this.onResize = () => this.resize();
    globalThis.addEventListener('resize', this.onResize);
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(this.onResize) : null;
    this.resizeObserver?.observe(canvas);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.contextLost = (event) => {
      event.preventDefault();
      canvas.dispatchEvent(new CustomEvent('arena-context-lost', { bubbles: true }));
    };
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.governor?.attach(this);
    this.wake();
  }
  add(object, parent = this.scene) {
    parent.add(object);
    return object;
  }
  build(themeId) {
    const t = THEMES[themeId];
    this.colors = t;
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.FogExp2(t.fog, 0.052);
    this.hemi = this.add(new THREE.HemisphereLight(t.glow, 0x03030b, 1.8));
    this.moon = this.add(new THREE.DirectionalLight(t.secondary, 3.4));
    this.moon.position.set(-4, 8, 5);
    this.softDot = softDotTexture();
    this.buildDais(t);
    this.buildRimPool(t);
    this.buildArchitecture(themeId, t);
    this.buildParticles(t);
    this.createFxPools();
  }
  buildDais(t) {
    const dais = this.add(new THREE.Group());
    const base = this.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(5.25, 5.8, 0.48, 64),
        material(t.floor, { emissive: 0.12, metalness: 0.48, roughness: 0.5 })
      ),
      dais
    );
    base.position.y = -0.42;
    const inset = this.add(
      new THREE.Mesh(
        new THREE.CylinderGeometry(4.62, 4.86, 0.12, 64),
        material(t.floor, { emissive: 0.2, metalness: 0.25, roughness: 0.7 })
      ),
      dais
    );
    inset.position.y = -0.13;
    [4.35, 3.65, 2.15].forEach((radius, index) => {
      const ring = this.add(
        new THREE.Mesh(
          new THREE.TorusGeometry(radius, 0.035 + index * 0.008, 8, 96),
          new THREE.MeshBasicMaterial({
            color: index === 2 ? t.accent : t.glow,
            transparent: true,
            opacity: 0.62 - index * 0.1,
          })
        ),
        dais
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.04;
      this.animations.push({ object: ring, type: 'spin', speed: (index % 2 ? -0.05 : 0.04) * (index + 1) });
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rune = this.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.015, 0.46),
          new THREE.MeshBasicMaterial({
            color: i % 3 === 0 ? t.secondary : t.glow,
            transparent: true,
            opacity: 0.72,
          })
        ),
        dais
      );
      rune.position.set(Math.cos(a) * 3.05, -0.015, Math.sin(a) * 3.05);
      rune.rotation.y = -a;
    }
  }
  buildArchitecture(theme, t) {
    if (theme === 'crystal') this.buildCrystal(t);
    if (theme === 'grove') this.buildGrove(t);
    if (theme === 'tidal') this.buildTidal(t);
    if (theme === 'volcano') this.buildVolcano(t);
    if (theme === 'astral') this.buildAstral(t);
    if (theme === 'eclipse') this.buildEclipse(t);
  }
  buildCrystal(t) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2,
        h = 1.2 + (i % 5) * 0.48;
      const cluster = this.add(new THREE.Group());
      cluster.position.set(Math.cos(a) * 5.6, h * 0.35 - 0.2, Math.sin(a) * 5.6);
      cluster.rotation.z = ((i % 3) - 1) * 0.09;
      for (let s = 0; s < 3; s++) {
        const shard = this.add(
          new THREE.Mesh(
            new THREE.ConeGeometry(0.18 + s * 0.04, h * (1 - s * 0.18), 5),
            material(s === 1 ? t.accent : t.glow, {
              emissive: 0.65,
              metalness: 0.6,
              roughness: 0.2,
              transparent: true,
              opacity: 0.82,
            })
          ),
          cluster
        );
        shard.position.x = (s - 1) * 0.22;
        shard.rotation.z = (s - 1) * 0.16;
      }
      this.animations.push({ object: cluster, type: 'breathe', offset: i });
    }
    const arch = this.add(
      new THREE.Mesh(
        new THREE.TorusGeometry(3.15, 0.16, 8, 48, Math.PI),
        material(t.accent, { emissive: 0.8, metalness: 0.65, roughness: 0.18 })
      )
    );
    arch.position.set(0, 2.15, -5.3);
    arch.rotation.z = Math.PI;
    this.animations.push({ object: arch, type: 'pulse' });
  }
  buildGrove(t) {
    for (const side of [-1, 1]) {
      const trunk = this.add(
        new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.62, 5.5, 9),
          material(0x29442e, { emissive: 0.04, metalness: 0, roughness: 1 })
        )
      );
      trunk.position.set(side * 5.2, 2.1, -2.4);
      trunk.rotation.z = -side * 0.12;
      for (let i = 0; i < 8; i++) {
        const leaf = this.add(
          new THREE.Mesh(
            new THREE.SphereGeometry(0.62 + (i % 3) * 0.15, 10, 7),
            material(i % 2 ? t.glow : t.accent, {
              emissive: 0.3,
              metalness: 0,
              roughness: 0.8,
              transparent: true,
              opacity: 0.82,
            })
          )
        );
        leaf.scale.set(1.5, 0.55, 1);
        leaf.position.set(side * (4.2 + (i % 3) * 0.55), 3.8 + (i % 4) * 0.35, -2.7 + (i % 2) * 0.7);
        this.animations.push({ object: leaf, type: 'sway', offset: i + side });
      }
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const flower = this.add(
        new THREE.Mesh(
          new THREE.TorusKnotGeometry(0.12, 0.045, 32, 6, 2, 3),
          material(i % 2 ? t.glow : t.secondary, { emissive: 0.9, metalness: 0.1, roughness: 0.45 })
        )
      );
      flower.position.set(Math.cos(a) * 5.15, 0.05 + Math.sin(i) * 0.08, Math.sin(a) * 5.15);
      this.animations.push({ object: flower, type: 'float', offset: i, baseY: flower.position.y });
    }
  }
  buildTidal(t) {
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++) {
        const arch = this.add(
          new THREE.Mesh(
            new THREE.TorusGeometry(1.2 + i * 0.08, 0.12, 8, 36, Math.PI),
            material(i % 2 ? t.glow : t.accent, {
              emissive: 0.5,
              metalness: 0.45,
              roughness: 0.25,
              transparent: true,
              opacity: 0.75,
            })
          )
        );
        arch.position.set(side * (4.6 + i * 0.28), 1.25 + i * 0.18, -2.5 - i * 0.6);
        arch.rotation.z = Math.PI;
        arch.rotation.y = side * 0.25;
        this.animations.push({ object: arch, type: 'sway', offset: i + side });
      }
    const whirl = this.add(
      new THREE.Mesh(
        new THREE.TorusGeometry(2.25, 0.07, 8, 80),
        new THREE.MeshBasicMaterial({ color: t.glow, transparent: true, opacity: 0.55 })
      )
    );
    whirl.position.set(0, 2.6, -5);
    whirl.rotation.x = 0.35;
    this.animations.push({ object: whirl, type: 'spin', speed: 0.22 });
  }
  buildVolcano(t) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2,
        h = 0.7 + (i % 4) * 0.55;
      const rock = this.add(
        new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.35 + (i % 3) * 0.12, 0),
          material(i % 3 === 0 ? t.glow : 0x3b2522, {
            emissive: i % 3 === 0 ? 0.85 : 0.08,
            metalness: 0.15,
            roughness: 0.9,
          })
        )
      );
      rock.scale.y = h;
      rock.position.set(Math.cos(a) * 5.45, h * 0.25 - 0.12, Math.sin(a) * 5.45);
      this.animations.push({ object: rock, type: i % 3 === 0 ? 'pulse' : 'still', offset: i });
    }
    const sun = this.add(
      new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.25, 2),
        new THREE.MeshBasicMaterial({ color: t.secondary, transparent: true, opacity: 0.78 })
      )
    );
    sun.position.set(0, 3.5, -6);
    this.animations.push({ object: sun, type: 'pulse', speed: 2 });
  }
  buildAstral(t) {
    const orb = this.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(0.72, 24, 18),
        material(t.secondary, { emissive: 1, metalness: 0.1, roughness: 0.1 })
      )
    );
    orb.position.set(0, 3.05, -5.4);
    this.animations.push({ object: orb, type: 'float', baseY: orb.position.y });
    for (let i = 0; i < 5; i++) {
      const ring = this.add(
        new THREE.Mesh(
          new THREE.TorusGeometry(1.25 + i * 0.32, 0.035, 6, 64),
          new THREE.MeshBasicMaterial({ color: i % 2 ? t.glow : t.accent, transparent: true, opacity: 0.58 })
        )
      );
      ring.position.copy(orb.position);
      ring.rotation.set(i * 0.42, i * 0.67, 0);
      this.animations.push({ object: ring, type: 'orbit', speed: 0.08 + i * 0.035, offset: i });
    }
    for (let i = 0; i < 9; i++) {
      const crystal = this.add(
        new THREE.Mesh(
          new THREE.OctahedronGeometry(0.2 + (i % 2) * 0.1),
          material(i % 2 ? t.glow : t.accent, { emissive: 0.7, metalness: 0.5, roughness: 0.2 })
        )
      );
      const a = (i / 9) * Math.PI * 2;
      crystal.position.set(Math.cos(a) * 5.2, 1 + (i % 3) * 0.65, Math.sin(a) * 5.2);
      this.animations.push({ object: crystal, type: 'float', offset: i, baseY: crystal.position.y });
    }
  }
  buildEclipse(t) {
    const corona = this.add(
      new THREE.Mesh(
        new THREE.TorusGeometry(1.45, 0.16, 12, 80),
        material(t.secondary, { emissive: 1, metalness: 0.35, roughness: 0.18 })
      )
    );
    corona.position.set(0, 3.2, -5.5);
    this.animations.push({ object: corona, type: 'pulse', speed: 1.3 });
    const dark = this.add(
      new THREE.Mesh(new THREE.SphereGeometry(1.28, 28, 20), new THREE.MeshBasicMaterial({ color: 0x06030b }))
    );
    dark.position.copy(corona.position);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2,
        h = 1.1 + (i % 4) * 0.38;
      const blade = this.add(
        new THREE.Mesh(
          new THREE.ConeGeometry(0.2, h, 4),
          material(i % 2 ? t.accent : t.glow, { emissive: 0.5, metalness: 0.75, roughness: 0.25 })
        )
      );
      blade.position.set(Math.cos(a) * 5.4, h * 0.35, Math.sin(a) * 5.4);
      blade.rotation.z = (i % 2 ? 1 : -1) * 0.22;
      this.animations.push({ object: blade, type: 'breathe', offset: i });
    }
  }
  buildParticles(t) {
    const count = this.dustCount(),
      positions = new Float32Array(count * 3),
      colors = new Float32Array(count * 3),
      base = new THREE.Color(t.glow),
      alt = new THREE.Color(t.secondary);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (((i * 73) % 197) / 197 - 0.5) * 16;
      positions[i * 3 + 1] = (((i * 43 + 17) % 191) / 191) * 7;
      positions[i * 3 + 2] = (((i * 61 + 9) % 181) / 181 - 0.5) * 10;
      const c = i % 4 === 0 ? alt : base;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.dust = this.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          size: t.particle === 'ember' ? 0.075 : 0.045,
          transparent: true,
          opacity: 0.7,
          vertexColors: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      )
    );
    this.dust.userData.particle = t.particle;
  }
  // Baked stand-in for the old rim point light: a soft additive light pool on
  // the right of the dais whose strength follows the battle tension.
  buildRimPool(t) {
    this.rimPool = this.add(
      new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: this.softDot,
          color: t.glow,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        })
      )
    );
    this.rimPool.rotation.x = -Math.PI / 2;
    this.rimPool.position.set(2.2, -0.05, -0.6);
    this.rimPool.scale.set(6.4, 6.4, 1);
  }
  createFxPools() {
    // Separate pools: a burst never overwrites a flash, and a second burst
    // takes the emitter closest to finishing instead of the one still flying.
    this.bursts = Array.from({ length: BURST_POOL_SIZE }, () => this.createEmitter(BURST_POINTS));
    this.sparks = this.createEmitter(SPARK_POINTS);
    // Hit flash without per-pixel lights: an additive glow sprite at the
    // target plus a short tone-mapping exposure bump.
    this.glow = this.add(
      new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.softDot,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        })
      )
    );
    this.glow.visible = false;
    this.glow.renderOrder = 2;
    this.glowState = { life: 0, duration: 1, size: 1, peak: 1 };
  }
  createEmitter(count) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const points = this.add(
      new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
          map: this.softDot,
          size: 0.2,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        })
      )
    );
    points.frustumCulled = false;
    points.visible = false;
    points.renderOrder = 1;
    return { points, velocity: new Float32Array(count * 3), live: 0, life: 0, gravity: 0, drag: 1, fade: 2 };
  }
  // Reduced motion keeps a thinner field; the tier caps both.
  dustCount() {
    return this.reducedMotion ? Math.min(70, this.profile.dust) : this.profile.dust;
  }
  applyProfile(profile) {
    this.profile = profile;
    // Reduced motion has no ambient motion to show, so the loop stops entirely between effects.
    this.fps = { active: profile.activeFps, ambient: this.reducedMotion ? 0 : profile.ambientFps };
  }
  // A tier change at a safe boundary: frame caps, DPR and dust apply now without touching the
  // context; antialiasing is fixed for the context's lifetime and follows with the next arena.
  setQuality(quality) {
    if (this.disposed) return;
    this.applyProfile(quality.arena);
    this.dust?.geometry.setDrawRange(0, this.dustCount());
    this.resize();
  }
  resize() {
    if (this.disposed) return;
    const rect = this.canvas.getBoundingClientRect(),
      w = Math.max(1, this.canvas.clientWidth || rect.width),
      h = Math.max(1, this.canvas.clientHeight || rect.height),
      cap = w * h > 500000 ? this.profile.largeCanvasPixelRatio : this.profile.maxPixelRatio,
      ratio = Math.min(globalThis.devicePixelRatio || 1, cap),
      viewport = this.viewport;
    if (viewport.w === w && viewport.h === h && viewport.ratio === ratio) return;
    viewport.w = w;
    viewport.h = h;
    viewport.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    // setSize clears the drawing buffer: repaint now so a paused or idle
    // arena never shows an empty canvas.
    if (!document.hidden) this.renderer.render(this.scene, this.camera);
  }
  setBattleState({ tension = 0, showdown = false } = {}) {
    const targetTension = Math.max(0, Math.min(1, tension)),
      targetShowdown = showdown ? 1 : 0;
    if (targetTension === this.targetTension && targetShowdown === this.targetShowdown) return;
    this.targetTension = targetTension;
    this.targetShowdown = targetShowdown;
    this.wake();
  }
  // `resolver(side)` returns the on-screen rect (DOMRect-like) of that side's
  // fighter sprite, or null. Bursts and flashes are placed on it.
  setAnchorResolver(resolver) {
    this.anchorResolver = typeof resolver === 'function' ? resolver : null;
  }
  // World point on the FX plane under the centre of the side's sprite, the
  // sprite height in world units, and an FX scale relative to a typical sprite.
  anchorPoint(side) {
    const rect = this.anchorResolver?.(side),
      view = this.canvas.getBoundingClientRect(),
      cam = this.camera;
    if (rect?.width > 0 && rect.height > 0 && view.width > 0 && view.height > 0) {
      cam.updateMatrixWorld();
      const dir = new THREE.Vector3(
        ((rect.left + rect.width / 2 - view.left) / view.width) * 2 - 1,
        1 - ((rect.top + rect.height / 2 - view.top) / view.height) * 2,
        0.5
      )
        .unproject(cam)
        .sub(cam.position)
        .normalize();
      if (dir.z < -1e-4) {
        const point = cam.position.clone().addScaledVector(dir, (FX_PLANE_Z - cam.position.z) / dir.z),
          depth = -point.clone().applyMatrix4(cam.matrixWorldInverse).z,
          worldPerPx = (2 * depth * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / view.height,
          size = rect.height * worldPerPx;
        return { point, size, scale: Math.max(0.75, Math.min(1.5, size / 2.4)) };
      }
    }
    return {
      point: new THREE.Vector3(side === 'enemy' ? 2.35 : -2.35, 1.15, FX_PLANE_Z),
      size: 2.4,
      scale: 1,
    };
  }
  pulseGlow(color, anchor, sizeFactor, duration, peak) {
    this.glow.material.color.set(color);
    this.glow.position.copy(anchor.point);
    Object.assign(this.glowState, { life: duration, duration, size: anchor.size * sizeFactor, peak });
    this.glow.visible = true;
  }
  burst(color = '#fff', targetSide = 'enemy', strength = 1) {
    if (this.testAnimationScale === 0 || !this.bursts) return;
    const anchor = this.anchorPoint(targetSide);
    if (this.reducedMotion) {
      // No flying particles: a still glow that fades is the whole cue.
      this.pulseGlow(color, anchor, 1.25, 0.34, Math.min(0.9, 0.5 * strength));
      this.wake();
      return;
    }
    let emitter = this.bursts[0];
    for (const candidate of this.bursts) if (candidate.life < emitter.life) emitter = candidate;
    const { point, scale } = anchor,
      positions = emitter.points.geometry.attributes.position.array,
      velocity = emitter.velocity,
      count = strength > 1 ? BURST_POINTS : 112;
    for (let i = 0; i < count; i++) {
      const p = i * 3,
        angle = i * 2.399963,
        fan = (0.4 + (((i * 37) % 71) / 71) * 1.5) * scale;
      positions[p] = point.x + Math.cos(angle) * 0.12 * scale;
      positions[p + 1] = point.y + Math.sin(angle) * 0.12 * scale;
      positions[p + 2] = point.z;
      velocity[p] = Math.cos(angle) * fan;
      velocity[p + 1] = Math.sin(angle) * fan + 1.25 * scale;
      velocity[p + 2] = (((i * 53) % 97) / 97 - 0.5) * 2;
    }
    emitter.live = count;
    emitter.life = 0.82;
    emitter.gravity = 2.9 * scale;
    emitter.drag = 1;
    emitter.fade = 2;
    emitter.points.geometry.setDrawRange(0, count);
    emitter.points.geometry.attributes.position.needsUpdate = true;
    emitter.points.material.color.set(color);
    emitter.points.material.size = (0.1 + 0.06 * strength) * 1.7 * scale;
    emitter.points.material.opacity = 1;
    emitter.points.visible = true;
    this.wake();
  }
  flash(kind = 'hit', color = '#fff', targetSide = 'enemy') {
    if (this.testAnimationScale === 0 || !this.sparks) return;
    const power = kind === 'power',
      anchor = this.anchorPoint(targetSide);
    this.flashExposure = Math.max(this.flashExposure, (power ? 0.5 : 0.32) * (this.reducedMotion ? 0.4 : 1));
    this.pulseGlow(color, anchor, power ? 2.1 : 1.7, power ? 0.45 : 0.32, 1);
    if (this.reducedMotion) {
      this.wake();
      return;
    }
    // Impact star: sparks start at the sprite's edge (the DOM creature covers
    // its centre) and shoot outwards, braking as they fade.
    const emitter = this.sparks,
      { point, size, scale } = anchor,
      positions = emitter.points.geometry.attributes.position.array,
      velocity = emitter.velocity,
      count = power ? SPARK_POINTS : 32,
      rim = size * 0.3;
    for (let i = 0; i < count; i++) {
      const p = i * 3,
        angle = (i / count) * Math.PI * 2 + ((i * 29) % 7) * 0.05,
        speed = (power ? 7 : 5.5) * scale * (0.7 + (((i * 37) % 11) / 11) * 0.6),
        dx = Math.cos(angle),
        dy = Math.sin(angle);
      positions[p] = point.x + dx * rim;
      positions[p + 1] = point.y + dy * rim;
      positions[p + 2] = point.z + 0.05;
      velocity[p] = dx * speed;
      velocity[p + 1] = dy * speed;
      velocity[p + 2] = 0;
    }
    emitter.live = count;
    emitter.life = power ? 0.4 : 0.3;
    emitter.gravity = 0;
    emitter.drag = 0.88;
    emitter.fade = 4;
    emitter.points.geometry.setDrawRange(0, count);
    emitter.points.geometry.attributes.position.needsUpdate = true;
    emitter.points.material.color.set(color);
    emitter.points.material.size = (power ? 0.34 : 0.26) * scale;
    emitter.points.material.opacity = 1;
    emitter.points.visible = true;
    const animationClass = power ? 'arena-power' : 'arena-hit';
    this.canvas.classList.remove('arena-hit', 'arena-power');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!this.disposed) this.canvas.classList.add(animationClass);
      })
    );
    this.wake();
  }
  punch(targetSide = 'enemy', strength = 1) {
    if (this.testAnimationScale === 0 || this.reducedMotion) return;
    this.cameraKick.x = (targetSide === 'enemy' ? -0.22 : 0.22) * strength;
    this.cameraKick.y = 0.09 * strength;
    this.cameraKick.z = -0.42 * strength;
    this.wake();
  }
  // Paused: one final frame, then no frames until resumed. Used while a
  // covering overlay hides the arena and during the results hand-off.
  setPaused(paused) {
    const next = Boolean(paused);
    if (this.disposed || next === this.paused) return;
    this.paused = next;
    if (!next) {
      this.wake();
      return;
    }
    this.stopLoop();
    if (!document.hidden) this.renderer.render(this.scene, this.camera);
  }
  // Battle-intro shader warm-up: compiles every material in the scene,
  // including the hidden FX pools, so the first hit never stalls on a shader
  // link. Same as renderer.compileAsync(), but the readiness poll stops once
  // the arena is disposed (compileAsync's poll would throw on freed programs).
  // Resolves true when every program is ready, false if disposed first.
  warmUp() {
    if (this.disposed) return Promise.resolve(false);
    const pending = this.renderer.compile(this.scene, this.camera);
    return new Promise((resolve) => {
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
  }
  // Schedule the next frame immediately (something changed). Restarting a
  // stopped loop flushes the clock so the stop never becomes one big step.
  wake() {
    this.nextRender = 0;
    if (this.frame !== undefined || this.disposed || this.paused || document.hidden) return;
    this.lastFrameAt = 0;
    this.clock.getDelta();
    this.frame = requestAnimationFrame(this.animateBound);
  }
  stopLoop() {
    cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }
  isActive() {
    if (this.glowState.life > 0 || this.sparks.life > 0 || this.flashExposure > 0) return true;
    for (const emitter of this.bursts) if (emitter.life > 0) return true;
    const kick = this.cameraKick;
    return (
      kick.x !== 0 ||
      kick.y !== 0 ||
      kick.z !== 0 ||
      this.tension !== this.targetTension ||
      this.showdown !== this.targetShowdown
    );
  }
  animate(now) {
    this.frame = undefined;
    if (this.disposed || this.paused || document.hidden) return;
    const active = this.isActive();
    if (this.lastFrameAt) this.governor?.sample(now - this.lastFrameAt, now, active);
    this.lastFrameAt = now;
    const rate = active ? this.fps.active : this.fps.ambient;
    if (rate <= 0) return;
    if (now < this.nextRender - 1) {
      this.frame = requestAnimationFrame(this.animateBound);
      return;
    }
    const interval = 1000 / rate;
    this.nextRender = now - this.nextRender >= interval ? now + interval : this.nextRender + interval;
    this.step(Math.min(0.04, this.clock.getDelta()));
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animateBound);
  }
  step(dt) {
    this.elapsed += dt;
    const t = this.elapsed,
      frames = dt * 60;
    this.tension = approach(this.tension, this.targetTension, dt * 2.4);
    // Final showdown: both sides on their last creature — the arena leans in
    // (brighter light, slightly closer camera, brighter exposure).
    this.showdown = approach(this.showdown, this.targetShowdown, dt * 1.6);
    this.flashExposure = this.flashExposure > 0.002 ? this.flashExposure * Math.pow(0.87, frames) : 0;
    this.renderer.toneMappingExposure = 1.15 + this.tension * 0.2 + this.showdown * 0.12 + this.flashExposure;
    this.moon.intensity = 3.4 + this.tension * 1.4;
    this.hemi.intensity = 1.8 + this.tension * 0.45;
    this.rimPool.material.opacity = 0.26 + this.tension * 0.2 + this.showdown * 0.16;
    if (this.dust) {
      this.dust.rotation.y =
        t * (this.dust.userData.particle === 'ember' ? 0.06 : 0.022) * (1 + this.tension * 0.9);
      this.dust.position.y =
        Math.sin(t * 0.4) * 0.08 + (this.dust.userData.particle === 'ember' ? (t * 0.1) % 1 : 0);
      this.dust.material.opacity = 0.7 + this.tension * 0.22;
    }
    if (!this.reducedMotion) {
      const kick = this.cameraKick,
        decay = Math.pow(0.84, frames);
      kick.x *= decay;
      kick.y *= decay;
      kick.z *= decay;
      if (Math.abs(kick.x) + Math.abs(kick.y) + Math.abs(kick.z) < 1e-3) kick.x = kick.y = kick.z = 0;
      this.cameraBase.z = 9.4 - this.tension * 0.5 - this.showdown * 0.55;
      this.cameraBase.y = 5.2 - this.tension * 0.12 - this.showdown * 0.2;
      this.camera.position.set(
        this.cameraBase.x + kick.x,
        this.cameraBase.y + kick.y,
        this.cameraBase.z + kick.z
      );
      this.camera.lookAt(kick.x * -0.45, 0.55 + kick.y * 0.2, 0);
      for (const item of this.animations) {
        const o = item.object,
          phase = t * (item.speed || 1) * (1 + this.tension * 0.35) + (item.offset || 0);
        // Tori are laid flat or tilted with rotation.x; with Three's XYZ Euler
        // order rotation.z spins them in their own plane (around world Y for
        // the floor rings) instead of tumbling them around a diameter.
        if (item.type === 'spin') o.rotation.z += dt * (item.speed || 0.1) * (1 + this.tension);
        if (item.type === 'orbit') {
          o.rotation.x += dt * item.speed * (1 + this.tension);
          o.rotation.y -= dt * item.speed * 0.7 * (1 + this.tension);
        }
        if (item.type === 'float') o.position.y = item.baseY + Math.sin(phase * 1.2) * 0.09;
        if (item.type === 'sway') o.rotation.z = Math.sin(phase * 0.65) * 0.07;
        if (item.type === 'breathe') o.scale.y = 1 + Math.sin(phase * 0.8) * (0.035 + this.tension * 0.012);
        if (item.type === 'pulse' && o.material)
          o.material.emissiveIntensity = 0.5 + this.tension * 0.3 + Math.sin(phase * (item.speed || 1)) * 0.3;
      }
    }
    this.stepGlow(dt);
    for (const emitter of this.bursts) this.stepEmitter(emitter, dt, frames);
    this.stepEmitter(this.sparks, dt, frames);
  }
  stepGlow(dt) {
    const state = this.glowState;
    if (state.life <= 0) return;
    state.life = Math.max(0, state.life - dt);
    const remaining = state.life / state.duration,
      size = state.size * (this.reducedMotion ? 1 : 0.8 + 0.35 * (1 - remaining * remaining));
    this.glow.scale.set(size, size, 1);
    this.glow.material.opacity = state.peak * remaining;
    if (state.life === 0) this.glow.visible = false;
  }
  stepEmitter(emitter, dt, frames) {
    if (emitter.life <= 0) return;
    const positions = emitter.points.geometry.attributes.position.array,
      velocity = emitter.velocity,
      drag = emitter.drag === 1 ? 1 : Math.pow(emitter.drag, frames),
      end = emitter.live * 3;
    for (let p = 0; p < end; p += 3) {
      positions[p] += velocity[p] * dt;
      positions[p + 1] += velocity[p + 1] * dt;
      positions[p + 2] += velocity[p + 2] * dt;
      velocity[p] *= drag;
      velocity[p + 1] = velocity[p + 1] * drag - emitter.gravity * dt;
      velocity[p + 2] *= drag;
    }
    emitter.points.geometry.attributes.position.needsUpdate = true;
    emitter.life = Math.max(0, emitter.life - dt);
    emitter.points.material.opacity = Math.min(1, emitter.life * emitter.fade);
    if (emitter.life === 0) emitter.points.visible = false;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    this.governor?.detach(this);
    this.anchorResolver = null;
    globalThis.removeEventListener('resize', this.onResize);
    this.resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose();
    });
    this.softDot.dispose();
    this.renderer.dispose();
    // Free the drawing buffer (and its MSAA storage) now instead of at GC.
    this.renderer.forceContextLoss();
  }
}
