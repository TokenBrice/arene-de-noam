import test from 'node:test';
import assert from 'node:assert/strict';
import { FxClock, HURRY_RATE, MAX_STEP_MS } from '../src/battle-ui/fx-clock.js';

// Deterministic real time: rAF callbacks are delivered every 1000 / hz ms, timers when due.
function harness({ hz = 60, ...options } = {}) {
  let time = 0,
    handle = 0;
  const frames = new Map(),
    timers = new Map();
  const clock = new FxClock({
    now: () => time,
    requestFrame: (callback) => {
      frames.set(++handle, callback);
      return handle;
    },
    cancelFrame: (id) => frames.delete(id),
    setTimer: (callback, ms) => {
      timers.set(++handle, { callback, at: time + ms });
      return handle;
    },
    clearTimer: (id) => timers.delete(id),
    ...options,
  });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    clock,
    get time() {
      return time;
    },
    pendingFrames: () => frames.size + timers.size,
    // Advances real time by `ms`; `deliver: false` models a hidden tab (no rAF).
    async run(ms, { deliver = true } = {}) {
      const step = 1000 / hz,
        end = time + ms;
      while (time < end - 1e-9) {
        time = Math.min(end, time + step);
        if (deliver) {
          const due = [...frames.values()];
          frames.clear();
          for (const callback of due) callback(time);
        }
        for (const [id, timer] of [...timers])
          if (timer.at <= time) {
            timers.delete(id);
            timer.callback();
          }
        await settle();
      }
    },
  };
}

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

test('virtual time follows real time × speed × hurry, without retroactive jumps', async () => {
  const h = harness(),
    { clock } = h;
  void clock.waitUntil(1e9); // keeps the loop sampling every frame, like a playing turn
  await h.run(100);
  close(clock.now(), 100);
  clock.setSpeed(2);
  await h.run(100);
  close(clock.now(), 300);
  clock.setHurry(true);
  assert.equal(clock.rate, 2 * HURRY_RATE);
  await h.run(50);
  close(clock.now(), 600);
  clock.setHurry(false);
  assert.equal(clock.rate, 2);
  assert.throws(() => clock.setSpeed(0), RangeError);
});

test('absolute waits keep a chained timeline on schedule at any frame rate', async () => {
  for (const hz of [30, 60, 120]) {
    const h = harness({ hz }),
      { clock } = h,
      start = clock.now(),
      fired = [];
    const chain = (async () => {
      for (let step = 1; step <= 10; step++) {
        assert.equal(await clock.waitUntil(start + 100 * step), true);
        fired.push(clock.now() - start);
      }
      return h.time;
    })();
    await h.run(1100);
    const finishedAt = await chain;
    assert.ok(
      finishedAt >= 1000 && finishedAt <= 1000 + 1000 / hz + 1e-6,
      `${hz} Hz finished at ${finishedAt}`
    );
    fired.forEach((elapsed, index) => assert.ok(elapsed >= 100 * (index + 1) - 1e-6));
  }
});

test('×2 halves real waiting time and callbacks fire in schedule order', async () => {
  const h = harness({ hz: 120 }),
    { clock } = h,
    order = [];
  clock.setSpeed(2);
  clock.at(300, () => order.push('late'));
  clock.at(100, () => order.push('early'));
  let resolvedAt = null;
  void clock.wait(400).then(() => (resolvedAt = h.time));
  await h.run(250);
  assert.deepEqual(order, ['early', 'late']);
  assert.ok(resolvedAt >= 200 && resolvedAt <= 200 + 1000 / 120 + 1e-6, `resolved at ${resolvedAt}`);
  assert.equal(clock.realMs(400), 200);
});

test('pause freezes virtual time and waits; resuming continues where it stopped', async () => {
  const h = harness(),
    { clock } = h,
    results = [];
  void clock.wait(100).then((value) => results.push(value));
  await h.run(50);
  clock.pause('sheet');
  const frozen = clock.now();
  await h.run(1000);
  assert.deepEqual(results, []);
  assert.equal(clock.now(), frozen);
  assert.equal(h.pendingFrames(), 0, 'a paused clock requests no frames');
  clock.resume('sheet');
  await h.run(70);
  assert.deepEqual(results, [true]);
});

test('a hit-stop freezes for its duration at the current rate, and overlaps extend it', async () => {
  const h = harness({ hz: 100 }),
    { clock } = h;
  clock.setSpeed(2);
  const before = clock.now();
  let released = null;
  void clock.hitStop(80).then((value) => (released = value)); // 40 ms of real time at ×2
  await h.run(30);
  assert.equal(released, null);
  assert.equal(clock.paused, true);
  assert.equal(clock.now(), before);
  await h.run(20);
  assert.equal(released, true);
  assert.equal(clock.paused, false);
  clock.setSpeed(1);
  const first = clock.hitStop(50),
    stamps = [];
  void first.then(() => stamps.push(h.time));
  await h.run(20);
  void clock.hitStop(100).then(() => stamps.push(h.time));
  await h.run(200);
  assert.equal(stamps.length, 2);
  assert.ok(
    stamps.every((at) => at >= 50 + 20 + 100 - 1e-6),
    `released at ${stamps}`
  );
});

test('holding mid-hit-stop shortens the rest of the freeze', async () => {
  const h = harness({ hz: 1000 }),
    { clock } = h;
  let released = null;
  void clock.hitStop(110).then(() => (released = h.time));
  await h.run(20);
  clock.setHurry(true);
  await h.run(100);
  // 20 ms at ×1, then the remaining 90 virtual ms at ×3.
  close(released, 20 + 90 / HURRY_RATE, 1);
});

test('a readout floor ignores ×2 but runs HURRY_RATE× faster while held, from the moment the hold starts', async () => {
  const h = harness({ hz: 100 }),
    { clock } = h;
  clock.setSpeed(2);
  let plain = null,
    floored = null;
  void clock.wait(300).then(() => (plain = h.time));
  void clock.wait(300, { floorMs: 350 }).then(() => (floored = h.time));
  await h.run(500);
  close(plain, 150, 10);
  assert.ok(floored >= 350 && floored <= 360, `floored at ${floored}`);
  // A floor-only wait: 50 floor ms at ×2 unhurried, then the remaining 300 at HURRY_RATE.
  const start = h.time;
  let hurried = null;
  void clock.wait(0, { floorMs: 350 }).then(() => (hurried = h.time - start));
  await h.run(50);
  assert.equal(hurried, null);
  clock.setHurry(true);
  assert.equal(clock.realFloorMs(300), 300 / HURRY_RATE);
  await h.run(200);
  close(hurried, 50 + 300 / HURRY_RATE, 10);
});

test('a stalled frame loop (hidden tab) never skips the turn ahead', async () => {
  const h = harness(),
    { clock } = h;
  let done = false;
  void clock.wait(1000).then(() => (done = true));
  await h.run(5000, { deliver: false });
  await h.run(20);
  assert.equal(done, false);
  assert.ok(clock.now() <= MAX_STEP_MS + 20 + 1e-6, `virtual ${clock.now()}`);
});

test('pacedMs is the same at any frame rate: no idle time, stall excess or hit-stop overshoot', async () => {
  for (const { hz, stallMs } of [
    { hz: 62.5, stallMs: 0 },
    { hz: 12.5, stallMs: 0 },
    { hz: 12.5, stallMs: 1000 },
  ]) {
    const h = harness({ hz }),
      { clock } = h;
    await h.run(500); // idle: nothing pending
    const start = clock.now(),
      began = h.time;
    assert.equal(clock.pacedMs, 0);
    let done = false;
    void (async () => {
      // A chain: 200 ms, three 40 ms hit-stops, 200 ms more.
      await clock.waitUntil(start + 200);
      for (let hit = 0; hit < 3; hit++) await clock.hitStop(40);
      await clock.waitUntil(start + 400);
      done = true;
    })();
    if (stallMs) await h.run(stallMs, { deliver: false });
    while (!done) await h.run(1000 / hz);
    // Give or take the frame that lands past the last deadline.
    assert.ok(Math.abs(clock.pacedMs - 520) <= 1000 / hz, `${hz} Hz, stall ${stallMs}: ${clock.pacedMs}`);
    // Real time ran longer at 12.5 Hz (each hit-stop ends on a later frame) and with the stall.
    if (hz < 60) assert.ok(h.time - began >= 520 + 3 * 40 + stallMs * 0.9, `took ${h.time - began} ms`);
  }
});

test('instant mode (?animations=0) runs each timed step on a ~1 ms tick, in order', async () => {
  const h = harness({ hz: 1000, instant: true }),
    { clock } = h,
    order = [];
  clock.at(500, () => order.push('b'));
  clock.at(100, () => order.push('a'));
  void clock.wait(60_000).then((value) => order.push(`wait:${value}`));
  await h.run(5);
  assert.deepEqual(order, ['a', 'b', 'wait:true']);
  assert.equal(clock.realMs(1000), 0);
  assert.equal(await clock.hitStop(110), true);
  assert.equal(clock.paused, false);
});

test('a dead session resolves pending waits false, drops callbacks and stops the loop', async () => {
  let alive = true;
  const h = harness({ alive: () => alive }),
    { clock } = h,
    results = [];
  let called = false;
  void clock.wait(100).then((value) => results.push(value));
  clock.at(50, () => (called = true));
  await h.run(20);
  alive = false;
  await h.run(200);
  assert.deepEqual(results, [false]);
  assert.equal(called, false);
  assert.equal(clock.disposed, true);
  assert.equal(h.pendingFrames(), 0);
  assert.equal(await clock.wait(10), false);
});

test('cancelAll clears waits, callbacks and hit-stops but leaves the clock usable', async () => {
  const h = harness(),
    { clock } = h;
  const pending = clock.wait(100),
    stop = clock.hitStop(50);
  let hits = 0;
  const cancel = clock.at(10, () => (hits += 1));
  clock.at(20, () => (hits += 100));
  cancel();
  clock.cancelAll();
  assert.equal(await pending, false);
  assert.equal(await stop, false);
  assert.equal(clock.paused, false);
  clock.at(30, () => (hits += 10));
  const later = clock.wait(50);
  await h.run(80);
  assert.equal(await later, true);
  assert.equal(hits, 10);
});
