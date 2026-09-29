const FALLBACK_STATE = 0x6d2b79f5;

function toUint32(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number >>> 0 : 0;
}

// Seeds are mixed once (murmur3 fmix32) before they become xorshift32 state:
// raw small seeds would otherwise yield tiny first outputs (every seed 1–1023
// rolled a critical hit on the first attack). fmix32 is a bijection with
// fmix32(0) === 0, so zero is the only input that needs the fallback.
export function normalizeSeed(seed) {
  let x = toUint32(seed);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0 || FALLBACK_STATE;
}

export function randomFromState(state) {
  let x = toUint32(state) || FALLBACK_STATE;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return { value: x / 4294967296, state: x };
}

export function randomIndex(rngState, length) {
  const next = randomFromState(rngState);
  return { index: Math.floor(next.value * length), state: next.state };
}
