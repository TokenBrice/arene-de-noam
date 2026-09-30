// Procedural painter for the baked "Stade Lumière" diorama. Everything is painted once at load
// into canvases that become unlit textures: the lighting, haze and god rays are baked here, so
// the GPU only samples. Deterministic (seeded per theme), so captures are reproducible.
import { fxRandom, fxSeed } from '../../battle-ui/beats.js';

// Backdrop plate: a camera-centred panorama band painted in angular coordinates.
// Azimuth ±PLATE_AZ° maps to x, elevation PLATE_EL_MIN…PLATE_EL_MAX° maps to y.
export const PLATE_W = 2048;
export const PLATE_H = 512;
export const PLATE_AZ = 75;
export const PLATE_EL_MIN = -8;
export const PLATE_EL_MAX = 20;
// The panorama radius is BACKDROP_K × the camera height, so the stands' base (the floor line)
// always sits at the same elevation below the horizon.
export const BACKDROP_K = 12;
export const FLOOR_EL = -Math.asin(1 / BACKDROP_K) * (180 / Math.PI);

const SX = PLATE_W / (2 * PLATE_AZ); // texels per degree of azimuth
const SY = PLATE_H / (PLATE_EL_MAX - PLATE_EL_MIN); // texels per degree of elevation
const X = (az) => (az + PLATE_AZ) * SX;
const Y = (el) => (PLATE_EL_MAX - el) * SY;

// Stadium bands (degrees of elevation).
const LED_TOP = FLOOR_EL + 0.85;
const TIERS = [
  { bottom: LED_TOP, top: LED_TOP + 2.3, far: 0 },
  { bottom: LED_TOP + 2.3, top: LED_TOP + 4.4, far: 0.5 },
  { bottom: LED_TOP + 4.4, top: LED_TOP + 6.2, far: 1 },
];
const ROOF_EL = TIERS[2].top;
// Elevation band of the crowd (LED wall top to the roof lip), for the live crowd effects.
export const CROWD_BAND = Object.freeze([LED_TOP, ROOF_EL]);
const TOWERS = [-60, -42, -25, -9.5, 9.5, 25, 42, 60];

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex, a = 1) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
// Multiply a colour's channels by k (k > 1 brightens toward white-clipped).
function shade(hex, k, a = 1) {
  const [r, g, b] = rgb(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgba(${r},${g},${b},${a})`;
}
function mix(hexA, hexB, t, a = 1) {
  const A = rgb(hexA),
    B = rgb(hexB);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function glow(g, x, y, rx, ry, color, alpha = 1) {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  grd.addColorStop(0, rgba(color, alpha));
  grd.addColorStop(0.35, rgba(color, alpha * 0.45));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}
// Angular glow: radius in degrees, drawn round on screen.
function glowDeg(g, az, el, r, color, alpha = 1) {
  glow(g, X(az), Y(el), r * SX, r * SY, color, alpha);
}
function additive(g, fn) {
  g.globalCompositeOperation = 'lighter';
  fn();
  g.globalCompositeOperation = 'source-over';
}
function poly(g, points) {
  g.beginPath();
  points.forEach(([az, el], i) => (i ? g.lineTo(X(az), Y(el)) : g.moveTo(X(az), Y(el))));
  g.closePath();
}
function vGradient(g, elTop, elBottom, stops) {
  const grd = g.createLinearGradient(0, Y(elTop), 0, Y(elBottom));
  for (const [t, c] of stops) grd.addColorStop(t, c);
  return grd;
}

// ------------------------------------------------------------------------------------------
// Backdrop plate
// ------------------------------------------------------------------------------------------
export function paintBackdrop(theme, themeId) {
  const [c, g] = canvas(PLATE_W, PLATE_H);
  const rnd = fxRandom(fxSeed('stage', themeId, 'backdrop'));
  const [top, mid, horizon] = theme.sky;
  g.fillStyle = vGradient(g, PLATE_EL_MAX, FLOOR_EL, [
    [0, top],
    [0.5, mid],
    [0.86, mix(mid, horizon, 0.75)],
    [1, horizon],
  ]);
  g.fillRect(0, 0, PLATE_W, PLATE_H);
  if (themeId !== 'grove' && themeId !== 'tidal') stars(g, rnd, themeId === 'astral' ? 900 : 380);
  LANDMARKS[theme.landmark](g, theme, rnd);
  // Horizon haze behind the stands pushes the landmark back (value hierarchy: sky lowest).
  g.fillStyle = vGradient(g, ROOF_EL + 5, ROOF_EL - 1, [
    [0, rgba(theme.haze, 0)],
    [1, rgba(theme.haze, 0.3)],
  ]);
  g.fillRect(0, Y(ROOF_EL + 5), PLATE_W, (6 * SY) | 0);
  paintStands(g, theme, rnd);
  paintTowers(g, theme);
  // Below the floor line: the apron colour, hidden by the floor but safe at grazing angles.
  g.fillStyle = theme.apron;
  g.fillRect(0, Y(FLOOR_EL), PLATE_W, PLATE_H - Y(FLOOR_EL));
  return c;
}

function stars(g, rnd, count) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * PLATE_W,
      el = ROOF_EL + 1 + rnd() * (PLATE_EL_MAX - ROOF_EL - 1),
      big = rnd() < 0.08;
    g.fillStyle = `rgba(255,255,255,${(0.12 + rnd() * 0.45) * Math.min(1, (el - ROOF_EL) / 6)})`;
    g.fillRect(x, Y(el), big ? 2 : 1, big ? 2 : 1);
  }
}

function paintStands(g, theme, rnd) {
  const crowd = theme.crowd;
  // Roof lip and back wall above the upper tier.
  g.fillStyle = vGradient(g, ROOF_EL + 0.9, ROOF_EL - 0.2, [
    [0, shade(theme.roof, 1.3)],
    [1, shade(theme.roof, 0.8)],
  ]);
  g.fillRect(0, Y(ROOF_EL + 0.9), PLATE_W, (1.1 * SY) | 0);
  g.fillStyle = rgba(theme.glow, 0.35);
  g.fillRect(0, Y(ROOF_EL + 0.9), PLATE_W, 2);
  for (const tier of TIERS) {
    const y0 = Y(tier.top),
      y1 = Y(tier.bottom),
      h = y1 - y0,
      // Upper tiers sit further back: hazier and flatter.
      k = 0.9 - tier.far * 0.22;
    g.fillStyle = vGradient(g, tier.top, tier.bottom, [
      [0, shade(theme.stands, k * 0.75)],
      [1, shade(theme.stands, k * 1.1)],
    ]);
    g.fillRect(0, y0, PLATE_W, h);
    // Seat rows with people: a colour mass (heads and shoulders), not individual figures.
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const ry = y0 + 5 + (r + 0.5) * ((h - 7) / rows);
      g.fillStyle = shade(theme.stands, k * 0.55, 0.6);
      g.fillRect(0, ry + 2.5, PLATE_W, 1.5);
      for (let x = rnd() * 4; x < PLATE_W; x += 3.2 + rnd() * 2.6) {
        if (rnd() < 0.08) continue; // empty seats keep the mass breathing
        const col = crowd[(rnd() * crowd.length) | 0],
          a = (0.35 + rnd() * 0.4) * (1 - tier.far * 0.3);
        g.fillStyle = rgba(col, a);
        g.fillRect(x, ry - 1.5 + rnd() * 1.5, 2.6, 3.4);
        g.fillStyle = rgba(col, a * 0.8);
        g.fillRect(x + 0.4, ry - 3.6 + rnd() * 1.5, 1.8, 1.8);
      }
    }
    // Aisles (stairs) every few degrees.
    for (let az = -PLATE_AZ + 4; az < PLATE_AZ; az += 8.5) {
      g.fillStyle = shade(theme.stands, k * 1.35, 0.55);
      g.fillRect(X(az), y0, 3, h);
    }
    // Soften the tier once (one filtered draw, not thousands).
    g.save();
    g.filter = 'blur(0.6px)';
    g.drawImage(g.canvas, 0, y0, PLATE_W, h, 0, y0, PLATE_W, h);
    g.restore();
    // Haze for distance, lip highlight and the shadow under the lip.
    g.fillStyle = rgba(theme.haze, 0.05 + tier.far * 0.1);
    g.fillRect(0, y0, PLATE_W, h);
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.fillRect(0, y0, PLATE_W, 2);
    const shadow = g.createLinearGradient(0, y0 + 2, 0, y0 + 12);
    shadow.addColorStop(0, 'rgba(0,0,0,0.45)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shadow;
    g.fillRect(0, y0 + 2, PLATE_W, 10);
  }
  // Phone lights and flashes scattered in the crowd (the live flash-bulbs add to these).
  additive(g, () => {
    for (let i = 0; i < 70; i++) {
      const el = LED_TOP + 0.3 + rnd() * (ROOF_EL - LED_TOP - 0.6);
      glow(g, rnd() * PLATE_W, Y(el), 3 + rnd() * 3, 3 + rnd() * 3, '#ffffff', 0.35 + rnd() * 0.3);
    }
  });
  // LED boards along the pitch wall, one colour family per arena, abstract patterns (no text).
  const y0 = Y(LED_TOP),
    y1 = Y(FLOOR_EL),
    ledH = y1 - y0;
  g.fillStyle = shade(theme.apron, 0.6);
  g.fillRect(0, y0, PLATE_W, ledH);
  let i = 0;
  for (let x = 2; x < PLATE_W; x += 96, i++) {
    const col = theme.led[i % theme.led.length];
    const grd = g.createLinearGradient(x, 0, x + 92, 0);
    grd.addColorStop(0, rgba(col, 0.75));
    grd.addColorStop(0.5, rgba(col, 0.45));
    grd.addColorStop(1, rgba(col, 0.75));
    g.fillStyle = grd;
    g.fillRect(x, y0 + 2, 92, ledH - 5);
    g.fillStyle = 'rgba(255,255,255,0.4)';
    for (let k = 0; k < 5; k++) {
      const cx = x + 12 + k * 17;
      if (i % 2) g.fillRect(cx, y0 + ledH * 0.35, 9, ledH * 0.25);
      else {
        g.beginPath();
        g.moveTo(cx, y0 + ledH * 0.25);
        g.lineTo(cx + 7, y0 + ledH * 0.5);
        g.lineTo(cx, y0 + ledH * 0.75);
        g.lineTo(cx + 3, y0 + ledH * 0.5);
        g.fill();
      }
    }
  }
  additive(g, () => {
    g.fillStyle = vGradient(g, LED_TOP + 0.9, LED_TOP, [
      [0, rgba(theme.glow, 0)],
      [1, rgba(theme.glow, 0.22)],
    ]);
    g.fillRect(0, Y(LED_TOP + 0.9), PLATE_W, 0.9 * SY);
  });
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(0, y1 - 2, PLATE_W, 3);
}

function paintTowers(g, theme) {
  for (const az of TOWERS) {
    const x = X(az),
      lampEl = ROOF_EL + 4.2,
      sway = az * 0.02;
    // Mast and lamp bank.
    g.fillStyle = shade(theme.roof, 0.9);
    g.fillRect(x - 2, Y(lampEl), 4, Y(ROOF_EL) - Y(lampEl));
    g.fillStyle = shade(theme.roof, 1.6);
    g.fillRect(x - 22, Y(lampEl + 0.55), 44, 0.9 * SY);
    additive(g, () => {
      glowDeg(g, az, lampEl + 0.1, 5.5, theme.glow, 0.28);
      for (let k = -3; k <= 3; k++) glow(g, x + k * 5.5, Y(lampEl + 0.12), 5, 4, '#ffffff', 0.75);
      // Baked god rays toward the pitch centre, fading into the stands.
      const target = X(az * 0.25 - sway);
      const ray = g.createLinearGradient(0, Y(lampEl), 0, Y(FLOOR_EL));
      ray.addColorStop(0, rgba(theme.glow, 0.2));
      ray.addColorStop(1, rgba(theme.glow, 0));
      g.fillStyle = ray;
      g.beginPath();
      g.moveTo(x - 14, Y(lampEl));
      g.lineTo(x + 14, Y(lampEl));
      g.lineTo(target + 7 * SX, Y(FLOOR_EL));
      g.lineTo(target - 7 * SX, Y(FLOOR_EL));
      g.closePath();
      g.fill();
    });
  }
}

// ------------------------------------------------------------------------------------------
// Landmarks: one per arena, centred on azimuth 0, rising behind the stands.
// ------------------------------------------------------------------------------------------
const LANDMARKS = {
  crystal(g, t, rnd) {
    // Glass dome ribs over the stadium.
    g.strokeStyle = rgba(t.glow, 0.16);
    g.lineWidth = 2;
    for (let i = -6; i <= 6; i++) {
      g.beginPath();
      g.ellipse(
        X(i * 9),
        Y(ROOF_EL),
        (70 - Math.abs(i) * 3) * SX,
        (PLATE_EL_MAX + 6 - ROOF_EL) * SY,
        0,
        Math.PI,
        0
      );
      g.stroke();
    }
    g.strokeStyle = rgba(t.glow, 0.1);
    for (let el = ROOF_EL + 4; el < PLATE_EL_MAX; el += 4) {
      g.beginPath();
      g.moveTo(0, Y(el));
      g.lineTo(PLATE_W, Y(el));
      g.stroke();
    }
    additive(g, () => glowDeg(g, 0, ROOF_EL + 5, 17, t.glow, 0.32));
    // Distant crystal ridges along the horizon.
    for (let az = -PLATE_AZ; az < PLATE_AZ; az += 2 + rnd() * 3) {
      if (Math.abs(az) < 15) continue;
      crystalSpire(g, t, az, ROOF_EL - 0.3, 1.2 + rnd() * 2.6, 0.5 + rnd() * 0.5, (rnd() - 0.5) * 0.3, 0.55);
    }
    // The spire cluster: a fan of tall crystals.
    const fan = [
      [0, 10.8, 2.1, 0],
      [-4.2, 8.8, 1.6, -0.12],
      [4.4, 9.3, 1.7, 0.12],
      [-8.2, 6.6, 1.4, -0.22],
      [8.6, 6.2, 1.3, 0.24],
      [-2.2, 6.4, 1.1, -0.05],
      [2.6, 5.9, 1.0, 0.07],
      [-11.8, 4.4, 1.1, -0.3],
      [12.2, 4, 1.0, 0.32],
    ];
    for (const [az, h, w, lean] of fan.slice().reverse()) crystalSpire(g, t, az, ROOF_EL - 1, h, w, lean, 1);
    additive(g, () => {
      for (let i = 0; i < 40; i++) glowDeg(g, (rnd() - 0.5) * 26, ROOF_EL + rnd() * 10, 0.35, '#ffffff', 0.5);
    });
  },
  grove(g, t, rnd) {
    const sunEl = ROOF_EL + 4;
    additive(g, () => {
      glowDeg(g, 0, sunEl, 26, '#fff1b0', 0.5);
      glowDeg(g, 0, sunEl, 9, '#fffbe0', 0.45);
    });
    // Sun shafts through the canopy.
    additive(g, () => {
      for (let i = 0; i < 9; i++) {
        const az = -20 + i * 5 + rnd() * 2;
        g.fillStyle = vGradient(g, PLATE_EL_MAX, ROOF_EL, [
          [0, 'rgba(255,245,190,0.14)'],
          [1, 'rgba(255,245,190,0)'],
        ]);
        poly(g, [
          [az, PLATE_EL_MAX],
          [az + 1.4, PLATE_EL_MAX],
          [az * 0.6 + 4, ROOF_EL],
          [az * 0.6 + 1.5, ROOF_EL],
        ]);
        g.fill();
      }
    });
    // The ancient tree: flared roots, a massive trunk, branches into the canopy.
    const bark = t.roof,
      trunk = [
        [-6.5, ROOF_EL - 1],
        [-4.2, ROOF_EL + 1.2],
        [-3.3, ROOF_EL + 5],
        [-3.6, ROOF_EL + 9],
        [-6, ROOF_EL + 12.5],
        [-9, PLATE_EL_MAX],
        [9.5, PLATE_EL_MAX],
        [6.5, ROOF_EL + 12.2],
        [3.8, ROOF_EL + 9],
        [3.4, ROOF_EL + 5],
        [4.4, ROOF_EL + 1.2],
        [7, ROOF_EL - 1],
      ];
    g.fillStyle = shade(bark, 1.2);
    poly(g, trunk);
    g.fill();
    // Bark: vertical grooves, lit on the left by the sun.
    g.save();
    poly(g, trunk);
    g.clip();
    for (let az = -10; az < 10; az += 0.55) {
      g.strokeStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.35)' : rgba(t.glow, 0.08);
      g.lineWidth = 1.5 + rnd() * 2;
      g.beginPath();
      g.moveTo(X(az), Y(ROOF_EL - 1));
      g.bezierCurveTo(
        X(az + rnd() - 0.5),
        Y(ROOF_EL + 5),
        X(az * 1.3),
        Y(ROOF_EL + 9),
        X(az * 2),
        Y(PLATE_EL_MAX)
      );
      g.stroke();
    }
    const side = g.createLinearGradient(X(-5), 0, X(5), 0);
    side.addColorStop(0, rgba('#ffe7a0', 0.22));
    side.addColorStop(0.5, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = side;
    g.fillRect(X(-10), 0, X(10) - X(-10), PLATE_H);
    g.restore();
    // Canopy: dark leaf masses arching over the top, lighter clumps catching light.
    for (let i = 0; i < 150; i++) {
      const az = (rnd() - 0.5) * 2 * PLATE_AZ,
        edge = Math.abs(az) / PLATE_AZ,
        el = PLATE_EL_MAX - 0.5 - rnd() * (4 + edge * 9),
        r = 1.6 + rnd() * 3.2;
      g.fillStyle = ['#132814', '#1a3a1c', '#24502a', '#2f6634'][(rnd() * 4) | 0];
      g.beginPath();
      g.ellipse(X(az), Y(el), r * SX, r * SY * 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
    additive(g, () => {
      for (let i = 0; i < 60; i++) {
        const az = (rnd() - 0.5) * 70;
        glowDeg(g, az, PLATE_EL_MAX - 2 - rnd() * 5, 0.9 + rnd(), '#d8ff8a', 0.18);
      }
      // Glowing seed lanterns hanging from the canopy and fireflies.
      for (let i = 0; i < 14; i++) {
        const az = -40 + i * 6 + rnd() * 3,
          el = ROOF_EL + 7 + rnd() * 5;
        g.strokeStyle = 'rgba(20,40,20,0.8)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(X(az), Y(PLATE_EL_MAX - 3));
        g.lineTo(X(az), Y(el));
        g.stroke();
        glowDeg(g, az, el, 0.9, '#ffe07a', 0.8);
        glowDeg(g, az, el, 0.25, '#ffffff', 0.9);
      }
      for (let i = 0; i < 80; i++) glowDeg(g, (rnd() - 0.5) * 140, ROOF_EL + rnd() * 10, 0.2, '#eaff9a', 0.7);
    });
  },
  tidal(g, t, rnd) {
    // The open sea beyond the cave mouth: moonlit teal glow.
    additive(g, () => glowDeg(g, 0, ROOF_EL + 5, 16, t.glow, 0.28));
    // Waterfall column pouring from the vault into the sea behind the stands.
    const w = 3.2,
      top = ROOF_EL + 11.5;
    const fall = g.createLinearGradient(X(-w), 0, X(w), 0);
    fall.addColorStop(0, rgba('#9ff4ff', 0));
    fall.addColorStop(0.25, rgba('#bff8ff', 0.5));
    fall.addColorStop(0.5, rgba('#e8feff', 0.62));
    fall.addColorStop(0.75, rgba('#bff8ff', 0.5));
    fall.addColorStop(1, rgba('#9ff4ff', 0));
    g.fillStyle = fall;
    g.fillRect(X(-w), Y(top), X(w) - X(-w), Y(ROOF_EL - 1) - Y(top));
    for (let i = 0; i < 220; i++) {
      const az = (rnd() - 0.5) * 2 * w * 0.9;
      g.fillStyle = `rgba(230,255,255,${0.06 + rnd() * 0.22})`;
      g.fillRect(X(az), Y(top - rnd() * 3), 1 + rnd() * 2, (8 + rnd() * 6) * SY);
    }
    additive(g, () => {
      glowDeg(g, 0, ROOF_EL, 6, '#e8ffff', 0.4);
      glowDeg(g, 0, top, 3.5, '#e8ffff', 0.3);
    });
    // Cave vault: dark rock framing an arch over the waterfall, stalactites.
    const rock = t.roof;
    g.fillStyle = rock;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(PLATE_W, 0);
    g.lineTo(PLATE_W, Y(ROOF_EL));
    g.lineTo(X(24), Y(ROOF_EL));
    g.bezierCurveTo(X(22), Y(ROOF_EL + 9), X(13), Y(ROOF_EL + 13.5), X(0), Y(ROOF_EL + 13.8));
    g.bezierCurveTo(X(-13), Y(ROOF_EL + 13.5), X(-22), Y(ROOF_EL + 9), X(-24), Y(ROOF_EL));
    g.lineTo(0, Y(ROOF_EL));
    g.closePath();
    g.fill();
    // Rock strata and wet highlights.
    for (let i = 0; i < 70; i++) {
      const az = (rnd() - 0.5) * 2 * PLATE_AZ,
        el = ROOF_EL + 1 + rnd() * (PLATE_EL_MAX - ROOF_EL);
      if (Math.abs(az) < 20 && el < ROOF_EL + 13) continue;
      g.fillStyle = rnd() < 0.5 ? shade(rock, 1.8, 0.5) : 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(X(az), Y(el), (1 + rnd() * 4) * SX, (0.3 + rnd() * 0.8) * SY, rnd() * 0.3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = rgba(t.glow, 0.32);
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(X(24), Y(ROOF_EL));
    g.bezierCurveTo(X(22), Y(ROOF_EL + 9), X(13), Y(ROOF_EL + 13.5), X(0), Y(ROOF_EL + 13.8));
    g.bezierCurveTo(X(-13), Y(ROOF_EL + 13.5), X(-22), Y(ROOF_EL + 9), X(-24), Y(ROOF_EL));
    g.stroke();
    for (let i = 0; i < 46; i++) {
      const az = (rnd() - 0.5) * 2 * PLATE_AZ;
      const archTop = Math.abs(az) < 24 ? ROOF_EL + 13.8 * Math.sqrt(1 - (az / 24) ** 2) : ROOF_EL;
      if (Math.abs(az) < 24 && rnd() < 0.5) continue;
      const len = 1 + rnd() * 3.5,
        base = Math.abs(az) < 24 ? archTop + 0.2 : PLATE_EL_MAX - rnd() * 4;
      g.fillStyle = shade(rock, 1.3);
      poly(g, [
        [az - 0.5, base + 0.4],
        [az + 0.5, base + 0.4],
        [az + 0.05, base - len],
      ]);
      g.fill();
    }
    // Bioluminescent spots on the rock.
    additive(g, () => {
      for (let i = 0; i < 90; i++) {
        const az = (rnd() - 0.5) * 2 * PLATE_AZ;
        if (Math.abs(az) < 22) continue;
        glowDeg(g, az, ROOF_EL + rnd() * 16, 0.3 + rnd() * 0.5, rnd() < 0.7 ? t.glow : t.accent, 0.55);
      }
    });
  },
  volcano(g, t, rnd) {
    additive(g, () => {
      glowDeg(g, 0, ROOF_EL + 9, 24, '#ff6a2a', 0.42);
      glowDeg(g, 0, ROOF_EL + 9, 7, '#ffd08a', 0.5);
    });
    // Eruption plume: smoke billows lit from below.
    for (let i = 0; i < 70; i++) {
      const k = i / 70,
        az = (rnd() - 0.5) * (3 + k * 14) + k * 5,
        el = ROOF_EL + 9 + k * 11 + rnd() * 1.5,
        r = 1.4 + k * 3 + rnd() * 1.5;
      const grd = g.createRadialGradient(X(az), Y(el - r * 0.3), 1, X(az), Y(el), r * SX);
      grd.addColorStop(0, `rgba(${90 - k * 50},${30 - k * 15},${20},${0.55 - k * 0.2})`);
      grd.addColorStop(1, 'rgba(20,8,8,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(X(az), Y(el), r * SX, r * SY * 0.8, 0, 0, Math.PI * 2);
      g.fill();
    }
    // The cone.
    const cone = [
      [-44, ROOF_EL - 1],
      [-20, ROOF_EL + 4],
      [-9, ROOF_EL + 7.2],
      [-3.8, ROOF_EL + 9],
      [3.6, ROOF_EL + 9.2],
      [9.5, ROOF_EL + 7],
      [21, ROOF_EL + 3.8],
      [46, ROOF_EL - 1],
    ];
    g.fillStyle = vGradient(g, ROOF_EL + 9, ROOF_EL, [
      [0, '#2a100b'],
      [1, '#150707'],
    ]);
    poly(g, cone);
    g.fill();
    g.save();
    poly(g, cone);
    g.clip();
    // Rock ridges and lava rivers.
    for (let i = 0; i < 26; i++) {
      const az = (rnd() - 0.5) * 50;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(az * 0.15), Y(ROOF_EL + 9));
      g.lineTo(X(az), Y(ROOF_EL - 1));
      g.stroke();
    }
    additive(g, () => {
      for (const start of [-2.6, -0.6, 1.4, 3]) {
        let az = start,
          el = ROOF_EL + 8.8;
        g.strokeStyle = 'rgba(255,110,40,0.9)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(X(az), Y(el));
        while (el > ROOF_EL - 1) {
          el -= 0.6;
          az += start * 0.22 + (rnd() - 0.5) * 0.9;
          g.lineTo(X(az), Y(el));
        }
        g.stroke();
        g.strokeStyle = 'rgba(255,200,120,0.5)';
        g.lineWidth = 1;
        g.stroke();
      }
    });
    g.restore();
    additive(g, () => {
      glowDeg(g, 0, ROOF_EL + 9.2, 4, '#ffd08a', 0.7);
      glowDeg(g, 0, ROOF_EL + 9.4, 1.5, '#ffffff', 0.28);
      for (let i = 0; i < 120; i++)
        glowDeg(g, (rnd() - 0.5) * 50, ROOF_EL + 2 + rnd() * 18, 0.18 + rnd() * 0.2, '#ffb060', 0.8);
    });
    // Forge chimneys on either side.
    for (const az of [-21, 21.5]) {
      g.fillStyle = '#1a0907';
      g.fillRect(X(az - 1.1), Y(ROOF_EL + 7.5), 2.2 * SX, Y(ROOF_EL) - Y(ROOF_EL + 7.5));
      g.fillStyle = '#2a120c';
      g.fillRect(X(az - 1.5), Y(ROOF_EL + 7.9), 3 * SX, 0.6 * SY);
      additive(g, () => {
        glowDeg(g, az, ROOF_EL + 8.2, 2.4, '#ff7a2a', 0.7);
        glowDeg(g, az, ROOF_EL + 8.1, 0.8, '#ffe0a0', 0.8);
      });
    }
  },
  astral(g, t, rnd) {
    // Nebula clouds.
    additive(g, () => {
      for (let i = 0; i < 18; i++)
        glowDeg(
          g,
          (rnd() - 0.5) * 120,
          ROOF_EL + 4 + rnd() * 14,
          5 + rnd() * 9,
          [t.accent, t.glow, '#6b4bff'][i % 3],
          0.12
        );
    });
    // The ringed planet (right of centre, clear of the portrait enemy plate) with a small moon.
    const pAz = 5,
      pEl = ROOF_EL + 7.2,
      pr = 4.7;
    const ringBack = () => {
      g.save();
      g.translate(X(pAz), Y(pEl));
      g.rotate(-0.28);
      g.strokeStyle = 'rgba(255,226,186,0.42)';
      g.lineWidth = 7;
      g.beginPath();
      g.ellipse(0, 0, pr * 1.95 * SX, pr * 0.42 * SY, 0, Math.PI, Math.PI * 2);
      g.stroke();
      g.restore();
    };
    ringBack();
    const planet = g.createRadialGradient(
      X(pAz - pr * 0.4),
      Y(pEl + pr * 0.35),
      4,
      X(pAz),
      Y(pEl),
      pr * SX * 1.05
    );
    planet.addColorStop(0, '#ffe9c4');
    planet.addColorStop(0.55, '#d09470');
    planet.addColorStop(1, '#3a2340');
    g.fillStyle = planet;
    g.beginPath();
    g.ellipse(X(pAz), Y(pEl), pr * SX, pr * SY, 0, 0, Math.PI * 2);
    g.fill();
    g.save();
    g.clip();
    for (let i = 0; i < 7; i++) {
      g.fillStyle = i % 2 ? 'rgba(120,60,50,0.18)' : 'rgba(255,235,200,0.12)';
      g.fillRect(X(pAz - pr), Y(pEl + pr - i * 1.6 - rnd()), 2 * pr * SX, 0.6 * SY);
    }
    const term = g.createLinearGradient(X(pAz - pr), 0, X(pAz + pr), 0);
    term.addColorStop(0.45, 'rgba(10,6,30,0)');
    term.addColorStop(1, 'rgba(10,6,30,0.65)');
    g.fillStyle = term;
    g.fillRect(X(pAz - pr), Y(pEl + pr), 2 * pr * SX, 2 * pr * SY);
    g.restore();
    g.save();
    g.translate(X(pAz), Y(pEl));
    g.rotate(-0.28);
    g.strokeStyle = 'rgba(255,236,200,0.7)';
    g.lineWidth = 6;
    g.beginPath();
    g.ellipse(0, 0, pr * 1.95 * SX, pr * 0.42 * SY, 0, 0, Math.PI);
    g.stroke();
    g.strokeStyle = 'rgba(255,236,200,0.3)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(0, 0, pr * 1.65 * SX, pr * 0.34 * SY, 0, 0, Math.PI);
    g.stroke();
    g.restore();
    const moon = g.createRadialGradient(X(-6.5), Y(ROOF_EL + 11.3), 1, X(-6), Y(ROOF_EL + 11), 1.2 * SX);
    moon.addColorStop(0, '#e8e0ff');
    moon.addColorStop(1, '#4a4080');
    g.fillStyle = moon;
    g.beginPath();
    g.ellipse(X(-6), Y(ROOF_EL + 11), 1.2 * SX, 1.2 * SY, 0, 0, Math.PI * 2);
    g.fill();
    // Shooting star.
    additive(g, () => {
      const s = g.createLinearGradient(X(20), Y(ROOF_EL + 15), X(30), Y(ROOF_EL + 12.5));
      s.addColorStop(0, 'rgba(255,255,255,0)');
      s.addColorStop(1, 'rgba(255,245,220,0.8)');
      g.strokeStyle = s;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(20), Y(ROOF_EL + 15));
      g.lineTo(X(30), Y(ROOF_EL + 12.5));
      g.stroke();
    });
    // Observatory dome with a glowing telescope slit, left of centre.
    const dAz = -12.5,
      dr = 4.2;
    g.fillStyle = shade(t.roof, 1.4);
    g.fillRect(X(dAz - dr), Y(ROOF_EL + 2), 2 * dr * SX, Y(ROOF_EL - 0.5) - Y(ROOF_EL + 2));
    g.fillStyle = vGradient(g, ROOF_EL + 2 + dr, ROOF_EL + 2, [
      [0, shade(t.roof, 2.2)],
      [1, shade(t.roof, 1.2)],
    ]);
    g.beginPath();
    g.ellipse(X(dAz), Y(ROOF_EL + 2), dr * SX, dr * SY, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = rgba(t.accent, 0.8);
    g.fillRect(X(dAz - 0.35), Y(ROOF_EL + 2 + dr * 0.95), 0.7 * SX, dr * 0.9 * SY);
    g.save();
    g.translate(X(dAz), Y(ROOF_EL + 2 + dr * 0.7));
    g.rotate(-0.7);
    g.fillStyle = shade(t.roof, 2.6);
    g.fillRect(-6, -3 * SY, 12, 3.2 * SY);
    g.restore();
    additive(g, () => glowDeg(g, dAz, ROOF_EL + 2 + dr, 3, t.accent, 0.35));
  },
  eclipse(g, t, rnd) {
    const eEl = ROOF_EL + 7.8,
      er = 3.3;
    additive(g, () => {
      glowDeg(g, 0, eEl, 20, t.glow, 0.34);
      // Corona streamers.
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * Math.PI * 2 + rnd() * 0.05,
          len = er * (1.6 + rnd() * 1.6);
        const x0 = X(0) + Math.cos(a) * er * SX,
          y0 = Y(eEl) + Math.sin(a) * er * SY;
        const x1 = X(0) + Math.cos(a) * len * SX,
          y1 = Y(eEl) + Math.sin(a) * len * SY;
        const grd = g.createLinearGradient(x0, y0, x1, y1);
        grd.addColorStop(0, `rgba(255,200,150,${0.14 + rnd() * 0.18})`);
        grd.addColorStop(1, 'rgba(255,120,170,0)');
        g.strokeStyle = grd;
        g.lineWidth = 2 + rnd() * 4;
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      glowDeg(g, 0, eEl, er * 1.7, '#ffe2b8', 0.9);
    });
    // The black sun and its blazing ring with a diamond-ring spark.
    g.fillStyle = '#07030b';
    g.beginPath();
    g.ellipse(X(0), Y(eEl), er * SX, er * SY, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,238,210,0.95)';
    g.lineWidth = 3;
    g.stroke();
    additive(g, () => {
      glowDeg(g, er * 0.62, eEl + er * 0.78, 1.1, '#ffffff', 0.95);
      glowDeg(g, er * 0.62, eEl + er * 0.78, 3, '#ffd6a0', 0.4);
    });
    // Crown spires encircling the stadium.
    const spires = [
      [-27, 7],
      [-19, 10],
      [-12.5, 6.8],
      [12.5, 7.2],
      [19.5, 10.4],
      [27.5, 7.4],
      [-40, 5.2],
      [40, 5.6],
      [-55, 4],
      [55, 4.2],
      [-66, 3],
      [66, 3.2],
    ];
    for (const [az, h] of spires) {
      const w = 1.6 + h * 0.12;
      g.fillStyle = vGradient(g, ROOF_EL + h, ROOF_EL, [
        [0, '#1c0a1e'],
        [1, '#0d040e'],
      ]);
      poly(g, [
        [az - w, ROOF_EL - 0.5],
        [az - w * 0.35, ROOF_EL + h * 0.62],
        [az, ROOF_EL + h],
        [az + w * 0.35, ROOF_EL + h * 0.62],
        [az + w, ROOF_EL - 0.5],
      ]);
      g.fill();
      // Rim light facing the corona.
      const facing = az < 0 ? 1 : -1;
      g.strokeStyle = rgba(t.glow, 0.55);
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(X(az), Y(ROOF_EL + h));
      g.lineTo(X(az + facing * w * 0.35), Y(ROOF_EL + h * 0.62));
      g.lineTo(X(az + facing * w), Y(ROOF_EL - 0.5));
      g.stroke();
      additive(g, () => glowDeg(g, az, ROOF_EL + h, 0.5, '#ffd6a0', 0.7));
    }
  },
};

function crystalSpire(g, t, az, baseEl, h, w, lean, alpha) {
  const tipAz = az + lean * h,
    left = [az - w, baseEl],
    right = [az + w, baseEl],
    shoulderL = [az - w * 0.72 + lean * h * 0.78, baseEl + h * 0.8],
    shoulderR = [az + w * 0.72 + lean * h * 0.78, baseEl + h * 0.8],
    tip = [tipAz, baseEl + h];
  g.globalAlpha = alpha;
  // Lit face (left, toward the key light) and shaded face.
  g.fillStyle = vGradient(g, baseEl + h, baseEl, [
    [0, mix(t.glow, '#ffffff', 0.35)],
    [1, rgba(t.glow, 0.55)],
  ]);
  poly(g, [left, shoulderL, tip, [az + lean * h * 0.5, baseEl + h * 0.35], [az, baseEl]]);
  g.fill();
  g.fillStyle = vGradient(g, baseEl + h, baseEl, [
    [0, mix(t.accent, '#ffffff', 0.15)],
    [1, rgba('#1a1850', 0.9)],
  ]);
  poly(g, [[az, baseEl], [az + lean * h * 0.5, baseEl + h * 0.35], tip, shoulderR, right]);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(X(tip[0]), Y(tip[1]));
  g.lineTo(X(az + lean * h * 0.5), Y(baseEl + h * 0.35));
  g.lineTo(X(az), Y(baseEl));
  g.stroke();
  g.globalAlpha = 1;
}

// ------------------------------------------------------------------------------------------
// Court (1024², the disc inscribed in the square) and pads
// ------------------------------------------------------------------------------------------
export const COURT_SIZE = 1024;

export function paintCourt(theme, themeId) {
  const S = COURT_SIZE,
    c0 = S / 2,
    R = c0 * 0.985;
  const [c, g] = canvas(S, S);
  const rnd = fxRandom(fxSeed('stage', themeId, 'court'));
  const court = theme.court;
  const base = g.createRadialGradient(c0, c0, 0, c0, c0, R);
  base.addColorStop(0, court.a);
  base.addColorStop(0.72, mix(court.a, court.b, 0.6));
  base.addColorStop(1, court.b);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  g.save();
  g.beginPath();
  g.arc(c0, c0, R, 0, Math.PI * 2);
  g.clip();
  COURT_PATTERNS[court.pattern](g, S, theme, rnd);
  g.restore();
  // Court markings: boundary, inner ring, centre line, centre circle and the sigil.
  const line = court.line;
  g.strokeStyle = rgba(line, 0.8);
  g.lineWidth = 9;
  g.beginPath();
  g.arc(c0, c0, R * 0.93, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = rgba(line, 0.35);
  g.lineWidth = 3;
  g.beginPath();
  g.arc(c0, c0, R * 0.87, 0, Math.PI * 2);
  g.stroke();
  // Centre line: vertical in texture space (the shader turns it across the pads' axis).
  g.strokeStyle = rgba(line, 0.5);
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(c0, c0 - R * 0.93);
  g.lineTo(c0, c0 - 150);
  g.moveTo(c0, c0 + 150);
  g.lineTo(c0, c0 + R * 0.93);
  g.stroke();
  // Starting marks in each half.
  for (const side of [-1, 1]) {
    g.strokeStyle = rgba(line, 0.28);
    g.lineWidth = 3;
    g.beginPath();
    g.arc(c0 + side * R * 0.5, c0, R * 0.2, 0, Math.PI * 2);
    g.stroke();
  }
  paintSigil(g, c0, c0, 138, theme);
  // Edge occlusion toward the apron.
  const ao = g.createRadialGradient(c0, c0, R * 0.78, c0, c0, R);
  ao.addColorStop(0, 'rgba(0,0,0,0)');
  ao.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = ao;
  g.fillRect(0, 0, S, S);
  return c;
}

// The arena's own emblem: six rhombi pointing outward around a hexagon ring (original design).
function paintSigil(g, x, y, r, theme) {
  const line = theme.court.line;
  g.save();
  g.translate(x, y);
  g.strokeStyle = rgba(line, 0.6);
  g.lineWidth = 6;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = rgba(line, 0.3);
  g.beginPath();
  g.arc(0, 0, r * 1.12, 0, Math.PI * 2);
  g.stroke();
  // Hexagon ring.
  g.strokeStyle = rgba(theme.glow, 0.55);
  g.lineWidth = 3;
  g.beginPath();
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const px = Math.cos(a) * r * 0.36,
      py = Math.sin(a) * r * 0.36;
    if (k) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6,
      ca = Math.cos(a),
      sa = Math.sin(a),
      inner = r * 0.44,
      outer = r * 0.9,
      half = r * 0.1;
    const mx = (inner + outer) / 2;
    g.fillStyle = rgba(i % 2 ? line : theme.glow, 0.55);
    g.beginPath();
    g.moveTo(ca * outer, sa * outer);
    g.lineTo(ca * mx - sa * half, sa * mx + ca * half);
    g.lineTo(ca * inner, sa * inner);
    g.lineTo(ca * mx + sa * half, sa * mx - ca * half);
    g.closePath();
    g.fill();
    // Small dot between rhombi.
    const b = a + Math.PI / 6;
    g.fillStyle = rgba(line, 0.5);
    g.beginPath();
    g.arc(Math.cos(b) * r * 0.78, Math.sin(b) * r * 0.78, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = rgba(line, 0.85);
  g.beginPath();
  g.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

const COURT_PATTERNS = {
  hex(g, S, t, rnd) {
    const r = 46;
    for (let row = -1; row < S / (r * 1.5) + 1; row++)
      for (let col = -1; col < S / (r * 1.732) + 1; col++) {
        const px = col * r * 1.732 + (row % 2) * r * 0.866,
          py = row * r * 1.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          g.lineTo(px + Math.cos(a) * (r - 2), py + Math.sin(a) * (r - 2));
        }
        g.closePath();
        g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
        g.fill();
        g.strokeStyle = rgba(t.court.line, 0.1);
        g.lineWidth = 2;
        g.stroke();
      }
  },
  flag(g, S, t, rnd) {
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        r = 28 + rnd() * 34;
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + rnd() * 0.5;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.closePath();
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,248,210,0.05)' : 'rgba(0,0,0,0.08)';
      g.fill();
      g.strokeStyle = 'rgba(30,60,25,0.35)';
      g.lineWidth = 3;
      g.stroke();
    }
    // Moss tufts in the joints.
    for (let i = 0; i < 420; i++) {
      g.fillStyle = `rgba(${90 + rnd() * 60},${140 + rnd() * 60},${60},${0.25})`;
      g.beginPath();
      g.arc(rnd() * S, rnd() * S, 2 + rnd() * 4, 0, Math.PI * 2);
      g.fill();
    }
  },
  wet(g, S, t, rnd) {
    const tile = 64;
    for (let y = 0; y < S; y += tile)
      for (let x = 0; x < S; x += tile) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.08)';
        g.fillRect(x + 2, y + 2, tile - 4, tile - 4);
      }
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 3;
    for (let p = 0; p <= S; p += tile) {
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, S);
      g.moveTo(0, p);
      g.lineTo(S, p);
      g.stroke();
    }
    // Wave inlays and puddles.
    g.strokeStyle = rgba(t.glow, 0.14);
    g.lineWidth = 4;
    for (let k = 0; k < 9; k++) {
      g.beginPath();
      for (let x = 0; x <= S; x += 16) g.lineTo(x, 110 + k * 100 + Math.sin(x / 60 + k) * 14);
      g.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S,
        y = rnd() * S;
      const grd = g.createRadialGradient(x, y, 0, x, y, 40 + rnd() * 50);
      grd.addColorStop(0, rgba(t.glow, 0.1));
      grd.addColorStop(1, rgba(t.glow, 0));
      g.fillStyle = grd;
      g.fillRect(x - 90, y - 90, 180, 180);
    }
  },
  basalt(g, S, t, rnd) {
    const r = 40;
    for (let row = -1; row < S / (r * 1.5) + 1; row++)
      for (let col = -1; col < S / (r * 1.732) + 1; col++) {
        const px = col * r * 1.732 + (row % 2) * r * 0.866 + (rnd() - 0.5) * 6,
          py = row * r * 1.5 + (rnd() - 0.5) * 6;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          g.lineTo(px + Math.cos(a) * (r - 3), py + Math.sin(a) * (r - 3));
        }
        g.closePath();
        g.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.12})`;
        g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.4)';
        g.lineWidth = 3;
        g.stroke();
      }
    additive(g, () => {
      for (let i = 0; i < 12; i++) {
        let x = rnd() * S,
          y = rnd() * S;
        g.strokeStyle = 'rgba(255,100,35,0.55)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 9; k++) g.lineTo((x += (rnd() - 0.5) * 90), (y += (rnd() - 0.5) * 90));
        g.stroke();
        g.strokeStyle = 'rgba(255,200,120,0.4)';
        g.lineWidth = 1;
        g.stroke();
      }
    });
  },
  stars(g, S, t, rnd) {
    const c0 = S / 2;
    g.strokeStyle = rgba(t.court.line, 0.1);
    g.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      g.beginPath();
      g.arc(c0, c0, 180 + i * 28, rnd() * 6, rnd() * 6 + 2.2);
      g.stroke();
    }
    // Gold constellations.
    for (let k = 0; k < 7; k++) {
      let x = rnd() * S,
        y = rnd() * S;
      g.strokeStyle = rgba(t.court.line, 0.22);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      const pts = [[x, y]];
      for (let s = 0; s < 4; s++) {
        x += (rnd() - 0.5) * 140;
        y += (rnd() - 0.5) * 140;
        g.lineTo(x, y);
        pts.push([x, y]);
      }
      g.stroke();
      g.fillStyle = rgba(t.court.line, 0.6);
      for (const [px, py] of pts) {
        g.beginPath();
        g.arc(px, py, 3.5, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(255,255,255,${0.05 + rnd() * 0.15})`;
      g.fillRect(rnd() * S, rnd() * S, 2, 2);
    }
  },
  marble(g, S, t, rnd) {
    for (let i = 0; i < 40; i++) {
      let x = rnd() * S,
        y = rnd() * S;
      g.strokeStyle = i % 3 ? 'rgba(255,255,255,0.05)' : rgba(t.court.line, 0.22);
      g.lineWidth = 1 + rnd() * 2.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 10; k++)
        g.quadraticCurveTo(
          x + (rnd() - 0.5) * 120,
          y + (rnd() - 0.5) * 120,
          (x += (rnd() - 0.5) * 150),
          (y += (rnd() - 0.5) * 150)
        );
      g.stroke();
    }
    const tile = 128;
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    for (let p = 0; p <= S; p += tile) {
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, S);
      g.moveTo(0, p);
      g.lineTo(S, p);
      g.stroke();
    }
  },
};

// Battle pad top (the disc inscribed in the square), tinted with the creature's affinity colour.
export const PAD_SIZE = 256;

export function paintPad(canvasEl, theme, color) {
  const S = PAD_SIZE,
    c0 = S / 2;
  if (canvasEl.width !== S) canvasEl.width = canvasEl.height = S;
  const g = canvasEl.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.fillStyle = theme.pad.side;
  g.fillRect(0, 0, S, S);
  const top = g.createRadialGradient(c0 - 24, c0 - 30, 6, c0, c0, c0);
  top.addColorStop(0, shade(theme.pad.top, 1.55));
  top.addColorStop(0.65, theme.pad.top);
  top.addColorStop(1, shade(theme.pad.top, 0.7));
  g.fillStyle = top;
  g.beginPath();
  g.arc(c0, c0, c0 - 1, 0, Math.PI * 2);
  g.fill();
  // Inner platform ring and tick marks.
  g.strokeStyle = 'rgba(0,0,0,0.3)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(c0, c0, c0 * 0.62, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(c0, c0, c0 * 0.6, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = rgba(color, 0.55);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.save();
    g.translate(c0 + Math.cos(a) * c0 * 0.72, c0 + Math.sin(a) * c0 * 0.72);
    g.rotate(a);
    g.fillRect(-5, -1.5, 10, 3);
    g.restore();
  }
  // Affinity rim: a bright band with an inner glow.
  g.strokeStyle = color;
  g.lineWidth = 12;
  g.beginPath();
  g.arc(c0, c0, c0 - 9, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(c0, c0, c0 - 12, 0, Math.PI * 2);
  g.stroke();
  const inner = g.createRadialGradient(c0, c0, c0 * 0.65, c0, c0, c0 - 14);
  inner.addColorStop(0, rgba(color, 0));
  inner.addColorStop(1, rgba(color, 0.3));
  g.fillStyle = inner;
  g.beginPath();
  g.arc(c0, c0, c0 - 14, 0, Math.PI * 2);
  g.fill();
  return canvasEl;
}
