// Camera rig: the base (rest) framing from the solver, the shot grammar on the fx-clock, the
// Phase 1 camera kick and the CSS-px screen shake. Everything here integrates virtual ms, so
// hit-stops freeze it and ×2 / hurry speed it up.
import * as THREE from 'three';

export const SHOTS = Object.freeze({
  intro: { duration: 1200 },
  attack: { duration: 700 },
  impact: { duration: 240 },
  ko: { duration: 600, holds: true },
  victory: { duration: 2400, holds: true, loops: true },
  cut: { duration: 0 },
});

const ATTACK_PUSH = 0.05;
const ATTACK_PAN = THREE.MathUtils.degToRad(3);
const IMPACT_PUSH = 0.03;
const KO_PUSH = 0.08;
export const KO_SATURATION = 0.6;
const VICTORY_YAW = THREE.MathUtils.degToRad(10);
const VICTORY_PUSH = 0.04;
const INTRO_YAW = THREE.MathUtils.degToRad(9);
const SHOWDOWN_PUSH = 0.01;
// Phase 1 kick amplitudes (world units at its 9.4-unit camera distance), rescaled to this rig.
const KICK = { x: 0.22, y: 0.09, z: 0.42, distance: 9.4, rate: 10.5 };

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

const UP = new THREE.Vector3(0, 1, 0);
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
    this.kick = new THREE.Vector3();
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

  // Starts a shot from the current framing. `target` = { center, feet, sign } of the shot's side
  // (sign: +1 when that side is right of the screen centre). Returns the shot record.
  start(name, duration, target) {
    const shot = { name, duration, target, age: 0, sweeps: 0, from: copyPose(pose(), this.shotPose) };
    if (name === 'intro') shot.blend = 0;
    else shot.blend = Math.min(250, duration * 0.35);
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

  // Reduced motion: shots are cuts; only the K.O. desaturation applies (instantly).
  cutTo(name) {
    this.cut();
    if (name === 'ko') this.grade.saturation = this.grade.to = this.grade.from = KO_SATURATION;
  }

  tweenSaturation(to, ms) {
    const g = this.grade;
    g.from = g.saturation;
    g.to = to;
    g.ms = ms;
    g.age = 0;
    if (ms <= 0) g.saturation = to;
  }

  punch(sign, { kick = 1, shakePx = 0, shakeMs = 0 }) {
    const k = kick * (this.distance / KICK.distance);
    // Camera-local: slide away from the target side, lift, lean in (−z is forward).
    this.kick.set(-sign * KICK.x * k, KICK.y * k, -KICK.z * k);
    if (shakePx > 0 && shakeMs > 0) Object.assign(this.shake, { px: shakePx, ms: shakeMs, age: 0 });
  }

  isActive() {
    const g = this.grade;
    return Boolean(
      this.active || this.kick.lengthSq() > 0 || this.shake.ms > 0 || (g.ms > 0 && g.age < g.ms)
    );
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
    const decay = Math.exp((-KICK.rate * dt) / 1000);
    this.kick.multiplyScalar(decay);
    if (this.kick.lengthSq() < 1e-7) this.kick.set(0, 0, 0);
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
      case 'impact': {
        const env = t < 0.3 ? easeOutCubic(t / 0.3) : 1 - easeInOutSine((t - 0.3) / 0.7);
        this.push(out, target.center, IMPACT_PUSH * env);
        break;
      }
      case 'ko':
        this.push(out, target.center, KO_PUSH * easeInOutCubic(t));
        break;
      case 'victory': {
        const ease = smooth(clamp01(shot.age / 600)),
          angle = VICTORY_YAW * Math.sin((2 * Math.PI * shot.age) / shot.duration) * ease;
        yawQuat(angle, q);
        out.position.sub(target.feet).applyQuaternion(q).add(target.feet);
        out.quaternion.premultiply(q);
        this.push(out, target.center, VICTORY_PUSH * ease);
        break;
      }
    }
    if (shot.blend > 0 && shot.age < shot.blend) {
      const w = smooth(shot.age / shot.blend);
      out.position.lerpVectors(shot.from.position, out.position, w);
      out.quaternion.slerpQuaternions(shot.from.quaternion, out.quaternion, w);
      out.fov = shot.from.fov + (out.fov - shot.from.fov) * w;
    }
    return out;
  }

  // Cinematic push-in by `amount` (share of size): aim part of the way at `point` and narrow the
  // fov, so near and far fighters scale alike (a dolly would balloon the near fighter).
  push(out, point, amount) {
    if (!(amount > 0)) return;
    this.tmp.m.lookAt(out.position, point, UP);
    out.quaternion.slerp(this.tmp.aim.setFromRotationMatrix(this.tmp.m), Math.min(1, amount * 2.5));
    out.fov = zoomFov(out.fov, amount);
  }

  // Writes the live camera: shot pose + kick, and the screen shake as a view offset (CSS px).
  apply(camera, width, height) {
    camera.position.copy(this.shotPose.position);
    camera.quaternion.copy(this.shotPose.quaternion);
    camera.fov = this.shotPose.fov;
    if (this.kick.lengthSq() > 0)
      camera.position.add(this.tmp.v.copy(this.kick).applyQuaternion(camera.quaternion));
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
