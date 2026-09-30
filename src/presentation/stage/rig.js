// Camera rig: the base (rest) framing from the solver, the shot grammar on the fx-clock, the
// impact punch (a snap push-in) and the CSS-px screen shake. Everything here integrates virtual
// ms, so hit-stops freeze it and ×2 / hurry speed it up.
import * as THREE from 'three';

export const SHOTS = Object.freeze({
  intro: { duration: 1200 },
  attack: { duration: 700 },
  lean: { duration: 700 },
  impact: { duration: 240 },
  ko: { duration: 600, holds: true },
  victory: { duration: 2400, holds: true, loops: true, hero: true },
  defeat: { duration: 1600, holds: true, hero: true },
  cut: { duration: 0 },
});

const ATTACK_PUSH = 0.05;
const ATTACK_PAN = THREE.MathUtils.degToRad(3);
// Signature wind-up: a slow push-in on a point between both fighters, LEAN_OTHER of the way from
// the caster to its target, so the target stays in frame when the impact punch lands on top.
const LEAN_PUSH = 0.06;
const LEAN_OTHER = 0.5;
const IMPACT_PUSH = 0.03;
const KO_PUSH = 0.08;
export const KO_SATURATION = 0.6;
// Hero framing (the outro's `victory` / `defeat` shots, §7.4): the camera stays where it rests (a
// dolly would balloon a near winner), turns to the winner and narrows its fov until the winner's
// victory box (fighters.js heroBox: widest landing squash, hop apex) fills HERO_FILL of the frame
// height, centred across and in the room the outro banner leaves free. The room is in shares of
// the stage height plus CSS px (battle-presentation.css: "VICTOIRE !" 5cqh from the top in a band
// ≤ 125 px tall; "Défaite…" 9cqh from the bottom, ≤ 90 px). The box never leaves the room or
// HERO_SIDE of the width on each side, orbit included: a winner too wide for it zooms out a little.
// A box smaller than its room stands low in it: HERO_LOW of the spare height stays above it.
const HERO_ROOM = Object.freeze({
  victory: { top: [0.05, 125], bottom: [0.08, 0] },
  defeat: { top: [0.07, 0], bottom: [0.09, 90] },
});
const HERO_SIDE = 0.04;
const HERO_FILL = 0.58;
const HERO_LOW = 0.6;
const HERO_ZOOM = [0.8, 2];
// The turn and push-in ease in over this many ms: brisk for a victory, slow and calm for a defeat.
// Only the victory then orbits ±VICTORY_YAW around the winner's feet, once per shot duration.
const HERO_EASE = Object.freeze({ victory: 600, defeat: 1000 });
const VICTORY_YAW = THREE.MathUtils.degToRad(8);
const INTRO_YAW = THREE.MathUtils.degToRad(9);
const SHOWDOWN_PUSH = 0.01;
// Impact punch: a snap push-in of `kick × KICK_PUSH` (share of size) aimed at the punch focus, a
// roll of `kick × KICK_ROLL` toward the attack, both held through the hit-stop (virtual time
// freezes) and then decaying at KICK_RATE per second (≈ 87 ms half-life, long enough to read).
// The director scales `kick` by what the hit meant (choreo.js punchKick).
const KICK_PUSH = 0.05;
const KICK_ROLL = THREE.MathUtils.degToRad(0.7);
const KICK_RATE = 8;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const yawQuat = (angle, out = new THREE.Quaternion()) => out.setFromAxisAngle(UP, angle);
// Vertical fov that magnifies the image by (1 + amount).
const zoomFov = (fov, amount) =>
  THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) / (1 + amount)));

function pose() {
  return { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 30 };
}
function copyPose(out, p) {
  out.position.copy(p.position);
  out.quaternion.copy(p.quaternion);
  out.fov = p.fov;
  return out;
}

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.base = pose();
    this.rest = pose();
    this.shotPose = pose();
    this.focus = new THREE.Vector3();
    this.distance = 1;
    this.showdown = 0;
    this.active = null;
    this.held = null;
    // Punch impulse: push amount, roll (rad) and the world point it pushes toward.
    this.kick = { push: 0, roll: 0, focus: new THREE.Vector3() };
    this.shake = { px: 0, ms: 0, age: 0 };
    this.grade = { saturation: 1, from: 1, to: 1, ms: 0, age: 0 };
    this.tmp = {
      q: new THREE.Quaternion(),
      aim: new THREE.Quaternion(),
      v: new THREE.Vector3(),
      m: new THREE.Matrix4(),
      p: pose(),
    };
  }

  // Base framing from the solver: camera position, pitch (yaw 0 = toward −z), vertical fov, and
  // the court centre it frames.
  setBase({ position, pitch, fov }, focus) {
    this.base.position.copy(position);
    this.base.quaternion.setFromEuler(new THREE.Euler(-pitch, 0, 0, 'YXZ'));
    this.base.fov = fov;
    this.focus.copy(focus);
    this.distance = position.distanceTo(focus);
    this.updateRest();
  }

  // Rest framing = base plus the showdown push-in (anchors are projected from it).
  updateRest() {
    copyPose(this.rest, this.base);
    this.rest.fov = zoomFov(this.base.fov, SHOWDOWN_PUSH * this.showdown);
    return this.rest;
  }

  applyRest(camera) {
    camera.position.copy(this.rest.position);
    camera.quaternion.copy(this.rest.quaternion);
    camera.fov = this.rest.fov;
  }

  // Starts a shot from the current framing. `target` = { center, feet, sign, other } of the shot's
  // side (sign: +1 when that side is right of the screen centre; other: the other fighter's
  // centre); hero shots add `box` (fighters.js heroBox, or null when the winner's own creature
  // fell in the final turn) and `stage` ({ width, height }, CSS px). Returns the shot record.
  start(name, duration, target) {
    const shot = { name, duration, target, age: 0, sweeps: 0, from: copyPose(pose(), this.shotPose) };
    if (name === 'intro') shot.blend = 0;
    else shot.blend = Math.min(250, duration * 0.35);
    if (SHOTS[name].hero) shot.hero = this.heroPose(name, target);
    this.active = shot;
    this.held = null;
    if (name === 'ko') this.tweenSaturation(KO_SATURATION, duration);
    else this.tweenSaturation(1, Math.min(250, duration));
    return shot;
  }

  cut() {
    this.active = null;
    this.held = null;
    this.grade.saturation = this.grade.to = this.grade.from = 1;
    this.grade.ms = 0;
    copyPose(this.shotPose, this.rest);
  }

  // Reduced motion: shots are cuts. The K.O. desaturation applies instantly, and a hero shot cuts
  // to its final framing (no orbit) and holds it.
  cutTo(name, target) {
    this.cut();
    if (name === 'ko') this.grade.saturation = this.grade.to = this.grade.from = KO_SATURATION;
    if (!SHOTS[name].hero) return;
    this.held = {
      name,
      target,
      still: true,
      age: 0,
      duration: 1,
      blend: 0,
      hero: this.heroPose(name, target),
    };
    this.evaluate(this.held, this.shotPose);
  }

  // The stage was re-fitted during a hero shot: frame the winner again from the new rest.
  retarget(target) {
    const shot = this.active ?? this.held;
    if (!shot || !SHOTS[shot.name].hero) return;
    shot.target = target;
    shot.hero = this.heroPose(shot.name, target);
  }

  // Hero framing (HERO_ROOM): the rest position with the orientation and fov that frame the
  // winner's box. The box is measured on its corners in the frame (the victory orbit's extremes
  // included), placed from small-angle estimates, then re-measured and corrected twice. Without a
  // box (the winner fell with the loser: a double K.O.) the shot stays wide: it eases back to the
  // rest framing and holds it, with no orbit around an empty pad.
  heroPose(name, target) {
    if (!target.box) return { wide: true };
    const rest = this.rest,
      { feet, box, stage } = target,
      room = HERO_ROOM[name],
      top = 1 - 2 * (room.top[0] + room.top[1] / stage.height),
      bottom = -1 + 2 * (room.bottom[0] + room.bottom[1] / stage.height),
      // NDC centre of a box `h` tall standing in the room.
      place = (h) => top - HERO_LOW * Math.max(0, top - bottom - h) - h / 2,
      side = 1 - 2 * HERO_SIDE,
      tanY = Math.tan(THREE.MathUtils.degToRad(rest.fov) / 2),
      tanX = tanY * this.camera.aspect,
      right = new THREE.Vector3(1, 0, 0).applyQuaternion(rest.quaternion),
      up = new THREE.Vector3(0, 1, 0).applyQuaternion(rest.quaternion),
      corners = [];
    for (const x of [-box.halfWidth, box.halfWidth])
      for (const y of [0, box.height + box.lift]) {
        const corner = feet.clone().addScaledVector(right, x).addScaledVector(up, y);
        corners.push(corner);
        // The orbit turns the camera about the vertical through the feet: the same as turning
        // the box the other way.
        if (name === 'victory')
          for (const angle of [-VICTORY_YAW, VICTORY_YAW])
            corners.push(corner.clone().sub(feet).applyAxisAngle(UP, angle).add(feet));
      }
    const view = new THREE.Matrix4(),
      p = new THREE.Vector3(),
      axis = new THREE.Vector3(),
      quaternion = new THREE.Quaternion(),
      // NDC extents of the box through `q` at magnification `zoom` (vs rest).
      measure = (q, zoom) => {
        view.compose(rest.position, q, p.set(1, 1, 1)).invert();
        const e = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
        for (const corner of corners) {
          p.copy(corner).applyMatrix4(view);
          const depth = Math.max(1e-6, -p.z),
            x = (p.x / depth / tanX) * zoom,
            y = (p.y / depth / tanY) * zoom;
          e.x0 = Math.min(e.x0, x);
          e.x1 = Math.max(e.x1, x);
          e.y0 = Math.min(e.y0, y);
          e.y1 = Math.max(e.y1, y);
        }
        return e;
      },
      // Orientation looking along rest-view tangents (u, v), without roll.
      aim = (u, v) => {
        axis.set(u, v, -1).applyQuaternion(rest.quaternion).add(rest.position);
        return quaternion.setFromRotationMatrix(this.tmp.m.lookAt(rest.position, axis, UP));
      };
    let e = measure(rest.quaternion, 1),
      zoom = Math.min(
        Math.max(1, (2 * HERO_FILL) / (e.y1 - e.y0)),
        (top - bottom) / (e.y1 - e.y0),
        (2 * side) / (e.x1 - e.x0)
      ),
      u = ((e.x0 + e.x1) / 2) * tanX,
      v = ((e.y0 + e.y1) / 2) * tanY;
    zoom = Math.min(HERO_ZOOM[1], Math.max(HERO_ZOOM[0], zoom));
    v -= (place((e.y1 - e.y0) * zoom) * tanY) / zoom;
    for (let pass = 0; pass < 2; pass++) {
      e = measure(aim(u, v), zoom);
      const fit = Math.min(1, (2 * side) / (e.x1 - e.x0), (top - bottom) / (e.y1 - e.y0)),
        next = Math.max(HERO_ZOOM[0], zoom * fit),
        k = next / zoom;
      u += (((e.x0 + e.x1) / 2) * k * tanX) / next;
      v += ((((e.y0 + e.y1) / 2) * k - place((e.y1 - e.y0) * k)) * tanY) / next;
      zoom = next;
    }
    return { quaternion: aim(u, v).clone(), fov: zoomFov(rest.fov, zoom - 1) };
  }

  tweenSaturation(to, ms) {
    const g = this.grade;
    g.from = g.saturation;
    g.to = to;
    g.ms = ms;
    g.age = 0;
    if (ms <= 0) g.saturation = to;
  }

  // A snap push-in toward `focus` (world point between both fighters, weighted to the target)
  // with a roll toward the attack (`sign`: +1 when the target is right of centre). A push re-aims
  // the camera part of the way at the focus and narrows the fov, so the target moves toward the
  // frame centre, never out of it, and near and far fighters scale alike (a dolly would balloon
  // the near one past the frame).
  punch(focus, sign, { kick = 1, shakePx = 0, shakeMs = 0 }) {
    this.kick.focus.copy(focus);
    this.kick.push = kick * KICK_PUSH;
    this.kick.roll = -sign * kick * KICK_ROLL;
    if (shakePx > 0 && shakeMs > 0) Object.assign(this.shake, { px: shakePx, ms: shakeMs, age: 0 });
  }

  isActive() {
    const g = this.grade;
    return Boolean(this.active || this.kick.push > 0 || this.shake.ms > 0 || (g.ms > 0 && g.age < g.ms));
  }

  // Advances shots, kick, shake and the shot grade by `dt` virtual ms. Returns the shot that
  // completed this step (for promise resolution), or null.
  step(dt) {
    let completed = null;
    const g = this.grade;
    if (g.ms > 0 && g.age < g.ms) {
      g.age = Math.min(g.ms, g.age + dt);
      g.saturation = g.from + (g.to - g.from) * smooth(g.age / g.ms);
    }
    const shot = this.active;
    if (shot) {
      shot.age += dt;
      this.evaluate(shot, this.shotPose);
      if (shot.age >= shot.duration && !shot.done) {
        shot.done = true;
        completed = shot;
        if (!SHOTS[shot.name].loops) {
          this.active = null;
          if (SHOTS[shot.name].holds) this.held = shot;
        }
      }
    } else if (this.held) this.evaluate(this.held, this.shotPose);
    else copyPose(this.shotPose, this.rest);
    const k = this.kick;
    if (k.push > 0) {
      const decay = Math.exp((-KICK_RATE * dt) / 1000);
      k.push *= decay;
      k.roll *= decay;
      if (k.push < 1e-4) k.push = k.roll = 0;
    }
    const s = this.shake;
    if (s.ms > 0) {
      s.age += dt;
      if (s.age >= s.ms) s.ms = s.px = 0;
    }
    return completed;
  }

  evaluate(shot, out) {
    const t = clamp01(shot.age / Math.max(1, shot.duration)),
      { q, v } = this.tmp,
      target = shot.target;
    copyPose(out, this.rest);
    switch (shot.name) {
      case 'intro': {
        const k = 1 - easeOutCubic(t),
          d = v.copy(this.rest.position).sub(this.focus);
        yawQuat(INTRO_YAW * k, q);
        d.multiplyScalar(1 + 0.4 * k).applyQuaternion(q);
        out.position.copy(this.focus).add(d);
        out.position.y += this.distance * 0.55 * k;
        // Look where the rest camera looks, from the raised position.
        const look = this.tmp.p.position
          .set(0, 0, -this.distance)
          .applyQuaternion(this.rest.quaternion)
          .add(this.rest.position);
        this.tmp.m.lookAt(out.position, look, UP);
        out.quaternion.setFromRotationMatrix(this.tmp.m).slerp(this.rest.quaternion, 1 - k);
        out.fov = this.rest.fov * (1 + 0.12 * k);
        break;
      }
      case 'attack': {
        const env = t < 0.35 ? easeOutCubic(t / 0.35) : t < 0.65 ? 1 : 1 - easeInOutSine((t - 0.65) / 0.35);
        this.push(out, target.center, ATTACK_PUSH * env);
        out.quaternion.premultiply(yawQuat(-target.sign * ATTACK_PAN * env, q));
        break;
      }
      case 'lean': {
        const env = t < 0.7 ? easeInOutSine(t / 0.7) : 1 - easeOutCubic((t - 0.7) / 0.3);
        this.push(out, v.copy(target.center).lerp(target.other, LEAN_OTHER), LEAN_PUSH * env);
        break;
      }
      case 'impact': {
        const env = t < 0.3 ? easeOutCubic(t / 0.3) : 1 - easeInOutSine((t - 0.3) / 0.7);
        this.push(out, target.center, IMPACT_PUSH * env);
        break;
      }
      case 'ko':
        this.push(out, target.center, KO_PUSH * easeInOutCubic(t));
        break;
      case 'victory':
      case 'defeat': {
        if (shot.hero.wide) break;
        const ease = shot.still ? 1 : smooth(clamp01(shot.age / HERO_EASE[shot.name]));
        out.quaternion.slerp(shot.hero.quaternion, ease);
        out.fov += (shot.hero.fov - out.fov) * ease;
        if (shot.name === 'victory' && !shot.still) {
          yawQuat(VICTORY_YAW * Math.sin((2 * Math.PI * shot.age) / shot.duration) * ease, q);
          out.position.sub(target.feet).applyQuaternion(q).add(target.feet);
          out.quaternion.premultiply(q);
        }
        break;
      }
    }
    if (shot.blend > 0 && shot.age < shot.blend) {
      const w = smooth(shot.age / shot.blend);
      out.position.lerpVectors(shot.from.position, out.position, w);
      // slerpQuaternions(from, out.quaternion) would copy `from` over its own second argument.
      out.quaternion.slerp(shot.from.quaternion, 1 - w);
      out.fov = shot.from.fov + (out.fov - shot.from.fov) * w;
    }
    return out;
  }

  // Cinematic push-in by `amount` (share of size): aim `aim` of the way at `point` and narrow the
  // fov, so near and far fighters scale alike (a dolly would balloon the near fighter).
  push(out, point, amount, aim = amount * 2.5) {
    if (!(amount > 0)) return;
    this.tmp.m.lookAt(out.position, point, UP);
    out.quaternion.slerp(this.tmp.aim.setFromRotationMatrix(this.tmp.m), Math.min(1, aim));
    out.fov = zoomFov(out.fov, amount);
  }

  // Writes the live camera: shot pose + punch, and the screen shake as a view offset (CSS px).
  apply(camera, width, height) {
    camera.position.copy(this.shotPose.position);
    camera.quaternion.copy(this.shotPose.quaternion);
    camera.fov = this.shotPose.fov;
    const k = this.kick;
    if (k.push > 0) {
      this.push(camera, k.focus, k.push);
      camera.quaternion.multiply(this.tmp.q.setFromAxisAngle(FORWARD, k.roll));
    }
    const s = this.shake;
    if (s.ms > 0) {
      const a = s.px * (1 - s.age / s.ms) ** 2;
      camera.setViewOffset(
        width,
        height,
        a * Math.sin(s.age * 0.11 + 0.4),
        a * 0.75 * Math.sin(s.age * 0.137 + 1.7),
        width,
        height
      );
    } else if (camera.view?.enabled) camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
}
