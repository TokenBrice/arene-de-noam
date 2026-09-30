// Offline signal processing for tools/bake-music.mjs: BS.1770-4 loudness, 4× oversampled true
// peak, a linked look-ahead true-peak limiter, loop-seam metrics, a log-frequency spectrogram and
// a YIN pitch tracker for the motif check. Pure functions over Float32Array channels at 48 kHz
// (the tracker takes any rate).

const db = (linear) => 20 * Math.log10(Math.max(linear, 1e-12));

// K-weighting (BS.1770-4) for 48 kHz: high-shelf pre-filter, then the RLB high-pass.
const K_STAGES = [
  { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
  { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] },
];

function biquad(input, { b, a }) {
  const out = new Float32Array(input.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

// Integrated loudness (LUFS) of channels[..][from, from + length), read circularly when
// `periodic` (a loop: its last blocks wrap into its start). The K-weighting runs over the whole
// channel, so samples before `from` settle the filters.
export function integratedLoudness(
  channels,
  { from = 0, length = channels[0].length - from, periodic = false, rate = 48000 } = {}
) {
  const weighted = channels.map((channel) =>
    K_STAGES.reduce((signal, stage) => biquad(signal, stage), channel)
  );
  const block = Math.round(0.4 * rate),
    hop = Math.round(0.1 * rate);
  const powers = [];
  const last = periodic ? length : length - block;
  for (let start = 0; start <= last - (periodic ? hop : 0); start += hop) {
    let sum = 0;
    for (const channel of weighted)
      for (let i = 0; i < block; i++) {
        const v = channel[from + ((start + i) % length)];
        sum += v * v;
      }
    powers.push(sum / block);
  }
  const loud = (power) => -0.691 + 10 * Math.log10(Math.max(power, 1e-20));
  const gated = powers.filter((power) => loud(power) > -70);
  if (!gated.length) return -Infinity;
  const relative = loud(gated.reduce((a, b) => a + b) / gated.length) - 10;
  const kept = gated.filter((power) => loud(power) > relative);
  return loud(kept.reduce((a, b) => a + b) / kept.length);
}

// 4× oversampling interpolator: a 64-tap Blackman-windowed sinc split into four phases.
const OVERSAMPLE = 4;
const PHASES = (() => {
  const taps = 64,
    phases = Array.from({ length: OVERSAMPLE }, () => []);
  for (let n = 0; n < taps; n++) {
    const x = n - (taps - 1) / 2;
    const sinc = x === 0 ? 1 : Math.sin((Math.PI * x) / OVERSAMPLE) / ((Math.PI * x) / OVERSAMPLE);
    const w =
      0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (taps - 1));
    phases[n % OVERSAMPLE].push(sinc * w);
  }
  return phases.map((phase) => Float64Array.from(phase));
})();
const PEAK_DELAY = 8; // (taps - 1) / 2 / OVERSAMPLE, rounded: aligns the envelope with the input

// Per-sample true-peak envelope: the largest |value| of any channel between sample n and n + 1.
export function truePeakEnvelope(channels) {
  const length = channels[0].length;
  const envelope = new Float32Array(length);
  for (const channel of channels)
    for (let n = 0; n < length; n++) {
      let peak = Math.abs(channel[n]);
      for (const phase of PHASES) {
        let sum = 0;
        for (let k = 0; k < phase.length; k++) {
          const index = n + PEAK_DELAY - k;
          if (index >= 0 && index < length) sum += channel[index] * phase[k];
        }
        if (Math.abs(sum) > peak) peak = Math.abs(sum);
      }
      if (peak > envelope[n]) envelope[n] = peak;
    }
  return envelope;
}

export function truePeak(channels, from = 0, length = channels[0].length - from) {
  const envelope = truePeakEnvelope(channels);
  let peak = 0;
  for (let i = from; i < from + length; i++) if (envelope[i] > peak) peak = envelope[i];
  return db(peak);
}

// Gain curve keeping `envelope` × gain under `ceiling` (linear): the reduction starts
// `lookahead` seconds before each peak (forward minimum, then a moving average of the same
// length, so the ramp is smooth and complete at the peak) and recovers with `release`.
export function limiterGain(envelope, ceiling, { lookahead = 0.004, release = 0.12, rate = 48000 } = {}) {
  const length = envelope.length,
    window = Math.max(1, Math.round(lookahead * rate));
  const required = new Float32Array(length);
  for (let i = 0; i < length; i++) required[i] = envelope[i] > ceiling ? ceiling / envelope[i] : 1;
  // Forward sliding minimum over [i, i + window] (monotonic deque).
  const ahead = new Float32Array(length);
  const deque = new Int32Array(length);
  let head = 0,
    tail = 0;
  for (let i = length - 1; i >= 0; i--) {
    while (tail > head && required[deque[tail - 1]] >= required[i]) tail--;
    deque[tail++] = i;
    while (deque[head] > i + window) head++;
    ahead[i] = required[deque[head]];
  }
  const gain = new Float32Array(length);
  const recover = 1 - Math.exp(-1 / (release * rate));
  // Moving average of `ahead` over the last `window` samples (unity before the signal starts).
  let sum = window,
    previous = 1;
  for (let i = 0; i < length; i++) {
    sum += ahead[i] - (i >= window ? ahead[i - window] : 1);
    const smooth = Math.min(ahead[i], sum / window);
    previous = Math.min(smooth, previous + (1 - previous) * recover);
    gain[i] = previous;
  }
  return gain;
}

// Loop-seam continuity of a decoded loop [loopStart, loopEnd): the sample delta the player makes
// when it jumps from loopEnd - 1 back to loopStart, the delta the continuous signal has at that
// point, the periodicity error |x[loopStart] - x[loopEnd]|, and the 99th / 99.9th percentile of
// adjacent-sample deltas inside the loop for scale.
export function seamMetrics(channels, loopStart, loopEnd) {
  let jump = 0,
    natural = 0,
    mismatch = 0;
  const deltas = [];
  for (const x of channels) {
    jump = Math.max(jump, Math.abs(x[loopStart] - x[loopEnd - 1]));
    natural = Math.max(natural, Math.abs(x[loopEnd] - x[loopEnd - 1]));
    mismatch = Math.max(mismatch, Math.abs(x[loopStart] - x[loopEnd]));
    for (let i = loopStart; i < loopEnd - 1; i += 7) deltas.push(Math.abs(x[i + 1] - x[i]));
  }
  deltas.sort((a, b) => a - b);
  const pct = (q) => deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))];
  return {
    jumpDb: db(jump),
    naturalDb: db(natural),
    mismatchDb: db(mismatch),
    p99DeltaDb: db(pct(0.99)),
    p999DeltaDb: db(pct(0.999)),
    jumpOverP99: jump / pct(0.99),
  };
}

// Click detector for a rendered playback: the largest |second difference| within ±radius of
// `at`, relative to the 99.9th percentile of |second difference| over the whole signal.
export function clickScore(channels, at, radius = 16) {
  let local = 0;
  const all = [];
  for (const x of channels) {
    for (let i = 1; i < x.length - 1; i += 3) all.push(Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]));
    for (let i = Math.max(1, at - radius); i < Math.min(x.length - 1, at + radius); i++)
      local = Math.max(local, Math.abs(x[i + 1] - 2 * x[i] + x[i - 1]));
  }
  all.sort((a, b) => a - b);
  return local / all[Math.floor(0.999 * all.length)];
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1,
        ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k,
          b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci,
          ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// Log-frequency magnitude spectrogram (dBFS): `rows` bands from fmin to fmax per hop.
export function spectrogram(
  mono,
  { rate = 48000, size = 2048, hop = 512, rows = 256, fmin = 40, fmax = 16000 } = {}
) {
  const window = Float32Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  );
  const frames = Math.max(1, Math.floor((mono.length - size) / hop) + 1);
  const out = new Float32Array(frames * rows);
  const re = new Float64Array(size),
    im = new Float64Array(size);
  const bandBin = Array.from(
    { length: rows + 1 },
    (_, r) => ((fmin * (fmax / fmin) ** (r / rows)) / rate) * size
  );
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) {
      re[i] = mono[f * hop + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let r = 0; r < rows; r++) {
      const lo = Math.floor(bandBin[r]),
        hi = Math.max(lo + 1, Math.ceil(bandBin[r + 1]));
      let peak = 0;
      for (let k = lo; k < hi && k < size / 2; k++) peak = Math.max(peak, re[k] * re[k] + im[k] * im[k]);
      out[f * rows + r] = 10 * Math.log10(Math.max(peak, 1e-20)) - 20 * Math.log10(size / 4);
    }
  }
  return { frames, rows, data: out, hopSeconds: hop / rate };
}

// Share of the signal's power per band (Welch average of Hann-windowed 4096-point spectra):
// under 250 Hz a phone speaker barely plays; 700 Hz – 3 kHz is where it is loudest.
export function bandShares(mono, { rate = 48000, edges = [250, 700, 3000] } = {}) {
  const size = 4096,
    window = Float32Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const power = new Float64Array(size / 2);
  const re = new Float64Array(size),
    im = new Float64Array(size);
  for (let start = 0; start + size <= mono.length; start += size / 2) {
    for (let i = 0; i < size; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < size / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
  }
  const bands = new Array(edges.length + 1).fill(0);
  for (let k = 1; k < size / 2; k++) {
    const band = edges.findIndex((edge) => (k * rate) / size < edge);
    bands[band < 0 ? edges.length : band] += power[k];
  }
  const total = bands.reduce((a, b) => a + b);
  return bands.map((band) => band / total);
}

function magnitudes(mono, start, size, window) {
  const re = new Float64Array(size),
    im = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const index = start + i;
    re[i] = index >= 0 && index < mono.length ? mono[index] * window[i] : 0;
  }
  fft(re, im);
  const out = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) out[k] = Math.hypot(re[k], im[k]);
  return out;
}

const hann = (size) =>
  Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));

// Transcribes a melody line → notes { t (s), midi }. Onsets are peaks of the positive spectral
// flux (short log-magnitude frames). Each onset's pitch comes from the spectrum it *adds* — a
// long window just after the onset minus one just before, clipped at zero — so notes still
// ringing from before (bells, glass, reverb-free decays) cannot pull the estimate; the MIDI note
// whose first harmonics carry the most added energy wins.
export function transcribe(mono, { rate, minGap = 0.09, lowMidi = 45, highMidi = 100 } = {}) {
  const short = 512,
    hop = Math.round(rate / 100),
    shortWindow = hann(short);
  const frames = Math.floor((mono.length - short) / hop);
  const flux = new Float64Array(frames);
  let previous = null;
  for (let f = 0; f < frames; f++) {
    const spectrum = magnitudes(mono, f * hop, short, shortWindow).map((value) => Math.log1p(100 * value));
    if (previous) for (let k = 0; k < spectrum.length; k++) flux[f] += Math.max(0, spectrum[k] - previous[k]);
    previous = spectrum;
  }
  const peak = Math.max(...flux);
  const onsets = [];
  for (let f = 3; f < frames - 3; f++) {
    let local = 0;
    for (let j = Math.max(0, f - 25); j < Math.min(frames, f + 25); j++) local += flux[j];
    local /= 50;
    const isPeak =
      flux[f] >= flux[f - 1] && flux[f] > flux[f + 1] && flux[f] >= flux[f - 2] && flux[f] >= flux[f + 2];
    if (!isPeak || flux[f] < local * 1.4 + peak * 0.015) continue;
    const t = (f * hop + short / 2) / rate;
    if (onsets.length && t - onsets.at(-1) < minGap) continue;
    onsets.push(t);
  }
  const long = 2048,
    longWindow = hann(long);
  return onsets.map((t) => {
    const at = Math.round(t * rate);
    const after = magnitudes(mono, at + Math.round(0.01 * rate), long, longWindow);
    const before = magnitudes(mono, at - long - Math.round(0.005 * rate), long, longWindow);
    const added = after.map((value, k) => Math.max(0, value - before[k]));
    let best = null;
    for (let midi = lowMidi; midi <= highMidi; midi++) {
      const f0 = 440 * 2 ** ((midi - 69) / 12);
      let score = 0;
      for (let h = 1; h <= 6; h++) {
        const bin = Math.round((h * f0 * long) / rate);
        if (bin + 1 >= added.length) break;
        score += 0.85 ** (h - 1) * Math.max(added[bin - 1], added[bin], added[bin + 1]);
      }
      if (!best || score > best.score) best = { midi, score };
    }
    return { t, midi: best.midi };
  });
}
