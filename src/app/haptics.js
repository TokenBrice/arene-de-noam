import { ctx } from './context.js';

// Light battle haptics (AUD-08): an opt-in "Vibrations légères" setting, off by default. The
// director attaches one subscriber per battle session to its cue bus (docs/battle-presentation.md
// §5), so a pulse lands on the presented contact frame, never at engine-event time. Vibration only
// reinforces what the screen already shows; iOS Safari (no `navigator.vibrate`), a declined
// request or `?animations=0` simply stay silent.

const NORMAL_MS = 18; // an ordinary direct hit
const STRONG_MS = 28; // a critical or super-effective hit
const BIG = Object.freeze([25, 35, 20]); // a Signature contact or a K.O.
const TURN_BUDGET_MS = 120; // motor-on time per resolved turn, so a turn never buzzes throughout

export const hapticsSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let motorUntil = 0,
  watchedAlive = null;

const motorOn = (pattern) =>
  typeof pattern === 'number' ? pattern : pattern.reduce((sum, ms, index) => (index % 2 ? sum : sum + ms), 0);
const length = (pattern) =>
  typeof pattern === 'number' ? pattern : pattern.reduce((sum, ms) => sum + ms, 0);

// Cancels a running pattern (hidden page, battle exit, setting turned off). Never touches the
// motor when nothing was started, so "off" really means zero calls.
export function stopHaptics() {
  if (!motorUntil) return;
  motorUntil = 0;
  watchedAlive = null;
  navigator.vibrate(0);
}

// While a pattern runs (≤ 80 ms), each frame checks that its battle is still on screen.
function watch() {
  if (!motorUntil || !watchedAlive) return;
  if (!watchedAlive()) stopHaptics();
  else if (performance.now() >= motorUntil) {
    motorUntil = 0;
    watchedAlive = null;
  } else requestAnimationFrame(watch);
}

function pulse(pattern, alive) {
  // Browsers refuse vibration before the first tap; the request itself would be a console warning.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  if (!navigator.vibrate(pattern)) return false;
  const running = Boolean(watchedAlive);
  motorUntil = performance.now() + length(pattern);
  watchedAlive = alive;
  if (!running) requestAnimationFrame(watch);
  return true;
}

// A single confirming pulse when the player turns the setting on.
export function previewHaptics() {
  if (hapticsSupported && ctx.testAnimationScale !== 0) pulse(STRONG_MS, () => true);
}

// Subscribes one battle session. Per beat, only the first and the final hit of a multi-hit pulse
// (a K.O. always does); a Signature or K.O. gets the one designed pattern, after which the beat is
// silent. Reduced motion keeps single short pulses only.
export function attachHaptics(session, alive) {
  if (!hapticsSupported) return;
  let turnState = null,
    spent = 0,
    beat = -1,
    signature = false,
    pulsed = false,
    big = false;
  const enter = (serial) => {
    if (serial === beat) return;
    beat = serial;
    signature = pulsed = big = false;
  };
  session.cues.on('signature-cutin', (payload) => {
    enter(payload.beat);
    signature = true;
  });
  session.cues.on('windup', (payload) => {
    enter(payload.beat);
    signature ||= Boolean(payload.signature);
  });
  session.cues.on('contact', (payload) => {
    if (!ctx.save.haptics || ctx.testAnimationScale === 0 || document.hidden || !alive()) return;
    enter(payload.beat);
    const lethal = Boolean(payload.lethal),
      final = payload.hit >= payload.hits;
    if (big || (pulsed && !final && !lethal) || (!pulsed && payload.hit > 1 && !final && !lethal)) return;
    const designed = lethal || (signature && !pulsed),
      strong = payload.critical || payload.effectiveness > 1,
      pattern = designed && !ctx.save.reducedMotion ? BIG : designed || strong ? STRONG_MS : NORMAL_MS;
    if (session.state !== turnState) {
      turnState = session.state;
      spent = 0;
    }
    if (spent + motorOn(pattern) > TURN_BUDGET_MS || !pulse(pattern, alive)) return;
    spent += motorOn(pattern);
    pulsed = true;
    big = designed;
  });
}

if (hapticsSupported) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHaptics();
  });
  addEventListener('pagehide', stopHaptics);
}
