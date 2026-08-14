export function normalizeSeed(seed) {
  const value = Number(seed);
  return Number.isFinite(value) ? value >>> 0 || 0x6d2b79f5 : 0x6d2b79f5;
}

export function randomFromState(state) {
  let x = normalizeSeed(state);
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
