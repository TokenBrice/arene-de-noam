// Browser half of tools/bake-music.mjs: renders one track, masters it, encodes it to Ogg Opus with
// WebCodecs, then decodes the result again to verify and measure it. Runs in Chromium on a page
// served from the repository; returns the files and the report data to the Node side.
import { MUSIC_LOOP_MARGIN_SECONDS, MUSIC_TRACKS } from '../../src/sound.js';
import { MODES, MOTIF, SAMPLE_RATE, BEATS_PER_BAR, buildScore } from './score.js';
import { renderScore } from './render.js';
import {
  bandShares,
  clickScore,
  integratedLoudness,
  limiterGain,
  seamMetrics,
  spectrogram,
  transcribe,
  truePeak,
  truePeakEnvelope,
} from './dsp.js';
import { muxOggOpus, readOggOpus } from './ogg.js';

export const TARGET_LUFS = -16;
export const MAX_TRUE_PEAK_DBTP = -1;
const CEILING_DBTP = -2; // limiter ceiling before encoding: Opus overshoots a little
const PREROLL_SECONDS = 12; // previous pass rendered before the loop: longest tail + reverb
const TAIL = 4800; // rendered past the file end
const FRAME = 960; // 20 ms Opus frames; every loop is a whole number of them
const ENCODER_CONTEXT_FRAMES = 20; // the previous pass the encoder hears before the loop
const PREROLL_PACKETS = 20; // the loop's last packets, replayed so the decoder state converges
const POSTROLL_PACKETS = 6; // the loop's first packets, replayed to cover the end margin
const BITRATE = Object.freeze({ base: 64000, tension: 40000 });
const MARGIN = Math.round(MUSIC_LOOP_MARGIN_SECONDS * SAMPLE_RATE);
const LEAD_RATE = 16000; // the lead-only render for pitch tracking

const fileName = (id, stem) => `${id}${stem === 'base' ? '' : `-${stem}`}.ogg`;
const hash = (text) => [...text].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// Encodes one loop as a packet-periodic Opus stream. The encoder hears the loop with the
// previous pass before it and the next pass after it; the packets of exactly one period are then
// laid out as [last PREROLL_PACKETS][the period][first POSTROLL_PACKETS]. The decoder's state
// forgets its reset within the pre-roll, so it meets every packet of the period in the same state
// both times through: the decoded file is periodic sample for sample and the loop point carries
// no codec seam. Returns the stream's packets and the pre-skip that puts the loop start
// `MARGIN` samples into the decoded file.
async function encodeLoop(channels, loopFrom, loop, bitrate) {
  if (loop % FRAME) throw new Error(`a ${loop}-sample loop is not a whole number of Opus frames`);
  const packets = [];
  let description = null,
    failure = null;
  const encoder = new AudioEncoder({
    output(chunk, meta) {
      const packet = new Uint8Array(chunk.byteLength);
      chunk.copyTo(packet);
      packets.push(packet);
      if (meta?.decoderConfig?.description) description = meta.decoderConfig.description;
    },
    error(error) {
      failure = error;
    },
  });
  encoder.configure({
    codec: 'opus',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: channels.length,
    bitrate,
    opus: { frameDuration: 20000, complexity: 10, application: 'audio', signal: 'music' },
  });
  const start = loopFrom - ENCODER_CONTEXT_FRAMES * FRAME,
    total = ENCODER_CONTEXT_FRAMES * FRAME + loop + 2 * FRAME;
  for (let offset = 0; offset < total; offset += SAMPLE_RATE) {
    const frames = Math.min(SAMPLE_RATE, total - offset);
    const data = new Float32Array(frames * channels.length);
    channels.forEach((channel, index) =>
      data.set(channel.subarray(start + offset, start + offset + frames), index * frames)
    );
    encoder.encode(
      new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: frames,
        numberOfChannels: channels.length,
        timestamp: Math.round((offset / SAMPLE_RATE) * 1e6),
        data,
      })
    );
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  if (!description) throw new Error('the Opus encoder gave no OpusHead (its delay)');
  const head = new Uint8Array(description.buffer ?? description);
  const delay = head[10] | (head[11] << 8);
  // Packet q decodes to input samples [q·FRAME − delay, (q + 1)·FRAME − delay): the period
  // starts at the packet that opens the loop, `delay` samples before the loop start.
  const period = packets.slice(ENCODER_CONTEXT_FRAMES, ENCODER_CONTEXT_FRAMES + loop / FRAME);
  return {
    packets: [...period.slice(-PREROLL_PACKETS), ...period, ...period.slice(0, POSTROLL_PACKETS)],
    preSkip: PREROLL_PACKETS * FRAME + delay - MARGIN,
  };
}

const decode = (bytes, rate) => new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes.slice().buffer);
const channelsOf = (buffer) =>
  Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));

// Plays the file through the runtime loop mechanism (AudioBufferSourceNode, margin loop points)
// at `rate`, across one wrap, and scores the seam for clicks.
async function loopPlayback(bytes, rate, loopSamples) {
  const buffer = await decode(bytes, rate);
  const loopSeconds = loopSamples / SAMPLE_RATE;
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, Math.round((loopSeconds + 1) * rate), rate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.loopStart = MUSIC_LOOP_MARGIN_SECONDS;
  source.loopEnd = buffer.duration - MUSIC_LOOP_MARGIN_SECONDS;
  source.connect(ctx.destination);
  source.start(0, MUSIC_LOOP_MARGIN_SECONDS);
  const out = await ctx.startRendering();
  return clickScore(channelsOf(out), Math.round(loopSeconds * rate));
}

// Best alignment of decoded vs reference within ±64 samples (on a 0.5 s stretch), and the
// codec's signal-to-noise ratio at that alignment over the whole file.
function alignment(reference, decoded) {
  const at = Math.floor(reference[0].length / 2),
    span = SAMPLE_RATE / 2;
  let best = { lag: 0, error: Infinity };
  for (let lag = -64; lag <= 64; lag++) {
    let error = 0;
    for (let c = 0; c < reference.length; c++)
      for (let i = at; i < at + span; i++) error += (reference[c][i] - decoded[c][i + lag]) ** 2;
    if (error < best.error) best = { lag, error };
  }
  let signal = 0,
    noise = 0;
  for (let c = 0; c < reference.length; c++)
    for (let i = 0; i < reference[c].length; i++) {
      signal += reference[c][i] ** 2;
      noise += (reference[c][i] - decoded[c][i]) ** 2;
    }
  return { lag: best.lag, snrDb: 10 * Math.log10(signal / Math.max(noise, 1e-20)) };
}

const COLOURS = [
  [0, [0, 0, 4]],
  [0.25, [66, 10, 104]],
  [0.5, [147, 38, 103]],
  [0.7, [221, 81, 58]],
  [0.87, [252, 165, 10]],
  [1, [252, 255, 164]],
];
function colour(value) {
  const v = Math.min(1, Math.max(0, value));
  const upper = COLOURS.findIndex(([stop]) => stop >= v);
  const [s0, c0] = COLOURS[Math.max(0, upper - 1)],
    [s1, c1] = COLOURS[upper];
  const f = s1 === s0 ? 0 : (v - s0) / (s1 - s0);
  return c0.map((component, i) => Math.round(component + (c1[i] - component) * f));
}

const monoOf = (channels, from, length) => {
  const mono = new Float32Array(length);
  for (const channel of channels)
    for (let i = 0; i < length; i++) mono[i] += channel[from + i] / channels.length;
  return mono;
};

// A log-frequency spectrogram of the decoded loop as a PNG data URL, with bar lines (the A/B
// boundary brighter) and 100 Hz / 1 kHz / 10 kHz guides.
async function spectrogramPng(channels, from, length, score, label) {
  const mono = monoOf(channels, from, length);
  const fmin = 40,
    fmax = 16000;
  const { frames, rows, data } = spectrogram(mono, { fmin, fmax });
  const width = 1600,
    height = 360,
    header = 22;
  const canvas = new OffscreenCanvas(width, height + header);
  const g = canvas.getContext('2d');
  const image = g.createImageData(width, height);
  for (let x = 0; x < width; x++) {
    const frame = Math.min(frames - 1, Math.floor((x / width) * frames));
    for (let y = 0; y < height; y++) {
      const row = Math.min(rows - 1, Math.floor(((height - 1 - y) / height) * rows));
      const [r, gr, b] = colour((data[frame * rows + row] + 100) / 90);
      const o = (y * width + x) * 4;
      image.data.set([r, gr, b, 255], o);
    }
  }
  g.fillStyle = '#111';
  g.fillRect(0, 0, width, header);
  g.putImageData(image, 0, header);
  const bars = score.track.bars;
  for (let bar = 1; bar < bars; bar++) {
    const x = Math.round((bar / bars) * width) + 0.5;
    g.strokeStyle = bar === bars / 2 ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.18)';
    g.beginPath();
    g.moveTo(x, header);
    g.lineTo(x, header + height);
    g.stroke();
  }
  g.font = '12px sans-serif';
  for (const hz of [100, 1000, 10000]) {
    const y = header + height - Math.round((Math.log(hz / fmin) / Math.log(fmax / fmin)) * height) + 0.5;
    g.strokeStyle = 'rgba(120,200,255,0.35)';
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(width, y);
    g.stroke();
    g.fillStyle = 'rgba(160,220,255,0.9)';
    g.fillText(hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`, 4, y - 3);
  }
  g.fillStyle = '#eee';
  g.fillText(
    `${label} — ${bars} bars, ${score.track.bpm.toFixed(2)} BPM, ${(length / SAMPLE_RATE).toFixed(2)} s loop; A | B at the bright line; dB scale -100…-10 dBFS`,
    6,
    15
  );
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return base64(new Uint8Array(await blob.arrayBuffer()));
}

// MIDI → scale degree of the track's mode (null when chromatic).
function degreeOf(midi, track) {
  const relative = midi - track.tonic,
    octave = Math.floor(relative / 12);
  const index = MODES[track.mode].indexOf(relative - 12 * octave);
  return index < 0 ? null : index + 7 * octave;
}

// Statements of the motif's degree shape (any transposition) in a note sequence; a re-struck
// note counts once (the motif has no repeated pitch), so a doubled onset cannot hide it.
function motifStatements(notes, track) {
  const distinct = notes.filter((note, index) => index === 0 || note.midi !== notes[index - 1].midi);
  const degrees = distinct.map((note) => degreeOf(note.midi, track));
  const found = [];
  for (let i = 0; i + MOTIF.length <= degrees.length; i++) {
    if (degrees[i] === null) continue;
    if (MOTIF.every((step, k) => degrees[i + k] !== null && degrees[i + k] - degrees[i] === step - MOTIF[0]))
      found.push({ t: distinct[i].t, on: ((degrees[i] % 7) + 7) % 7 });
  }
  return found;
}

const noteName = (midi) =>
  `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;

// The lead line as scored and as heard: a dry lead-only render (starting a little before the
// loop, so its first onset is detectable), transcribed (onsets + pitch). `matched` counts
// scored notes heard at the same pitch within 60 ms of their onset.
async function motifReport(score) {
  const loopSeconds = score.loopSamples / SAMPLE_RATE,
    beat = 60 / score.track.bpm,
    pad = 0.25;
  const scored = score.events
    .filter((event) => event.role === 'lead' && event.stem === 'base')
    .map((event) => ({ t: event.t * beat, midi: event.midi }));
  const [lead] = await renderScore(score, {
    stems: ['base'],
    roles: ['lead'],
    start: -pad,
    length: loopSeconds + pad,
    rate: LEAD_RATE,
    channels: 1,
    reverb: false,
  });
  const heard = transcribe(lead, { rate: LEAD_RATE })
    .map((note) => ({ ...note, t: note.t - pad }))
    .filter((note) => note.t > -0.06);
  const bar = (t) => Math.floor((t + 0.03) / (beat * BEATS_PER_BAR)) + 1;
  const summary = (list) => list.map(({ t, on }) => `bar ${bar(t)} on degree ${on + 1}`);
  return {
    scoredNotes: scored.length,
    heardNotes: heard.length,
    matched: scored.filter((note) => heard.some((h) => h.midi === note.midi && Math.abs(h.t - note.t) < 0.06))
      .length,
    heardSequence: heard.map((note) => `${bar(note.t)}:${noteName(note.midi)}`).join(' '),
    scoredStatements: summary(motifStatements(scored, score.track)),
    heardStatements: summary(motifStatements(heard, score.track)),
  };
}

export async function bakeTrack(id) {
  const score = buildScore(id);
  const stems = MUSIC_TRACKS[id];
  if ([...stems].sort().join() !== score.stems.join())
    throw new Error(`${id}: the score has stems ${score.stems}, the runtime expects ${stems}`);
  const loop = score.loopSamples,
    preroll = PREROLL_SECONDS * SAMPLE_RATE;
  const renderSeconds = (preroll + loop + MARGIN + TAIL) / SAMPLE_RATE;
  const started = performance.now();
  const raw = {};
  for (const stem of stems)
    raw[stem] = await renderScore(score, { stems: [stem], start: -PREROLL_SECONDS, length: renderSeconds });
  const renderMs = performance.now() - started;
  // How far the melody sits above or below the whole base mix (LU), from a lead-only render.
  const leadOnly = await renderScore(score, {
    stems: ['base'],
    roles: ['lead'],
    start: -PREROLL_SECONDS,
    length: renderSeconds,
  });
  const loopLoudness = (channels) =>
    integratedLoudness(channels, { from: preroll, length: loop, periodic: true });
  const leadVsMixLu = loopLoudness(leadOnly) - loopLoudness(raw.base);

  // Mastering: one gain brings the base loop to TARGET_LUFS and the tension stem takes the same
  // gain, so the authored balance holds; each stem then passes its own true-peak limiter (the
  // runtime master limiter guards their sum at full tension).
  const length = raw.base[0].length;
  const ceiling = 10 ** (CEILING_DBTP / 20);
  const baseEnvelope = truePeakEnvelope(raw.base);
  let gain = 10 ** ((TARGET_LUFS - loopLoudness(raw.base)) / 20);
  let limiter, mastered;
  for (let pass = 0; pass < 6; pass++) {
    limiter = limiterGain(baseEnvelope, ceiling / gain);
    mastered = raw.base.map((channel) => channel.map((value, i) => value * gain * limiter[i]));
    const measured = loopLoudness(mastered);
    if (Math.abs(measured - TARGET_LUFS) < 0.05) break;
    gain *= 10 ** ((TARGET_LUFS - measured) / 20);
  }
  let reduction = 0,
    reduced = 0;
  for (let i = preroll; i < preroll + loop; i++) {
    reduction = Math.min(reduction, 20 * Math.log10(limiter[i]));
    if (limiter[i] < 0.891) reduced += 1; // more than 1 dB
  }
  const outputs = { base: mastered };
  if (raw.tension) {
    const mono = new Float32Array(length);
    for (let i = 0; i < length; i++) mono[i] = ((raw.tension[0][i] + raw.tension[1][i]) / 2) * gain;
    const tensionLimiter = limiterGain(truePeakEnvelope([mono]), ceiling);
    outputs.tension = [mono.map((value, i) => value * tensionLimiter[i])];
  }

  const files = [],
    checks = [],
    stemReports = {};
  const windowFrom = preroll - MARGIN,
    windowLength = MARGIN + loop + MARGIN;
  for (const stem of stems) {
    const channels = outputs[stem];
    const { packets, preSkip } = await encodeLoop(channels, preroll, loop, BITRATE[stem]);
    const name = fileName(id, stem);
    const bytes = muxOggOpus({
      packets,
      frameSamples: FRAME,
      channels: channels.length,
      preSkip,
      samples: windowLength,
      vendor: 'Arène de Noam tools/bake-music.mjs (WebCodecs Opus)',
      serial: hash(name),
      tags: {
        TITLE: `Arène de Noam — ${id}${stem === 'base' ? '' : ` (${stem})`}`,
        LOOPSTART: MARGIN,
        LOOPLENGTH: loop,
        BPM: score.track.bpm.toFixed(3),
      },
    });
    const header = readOggOpus(bytes);
    const decoded = await decode(bytes, SAMPLE_RATE);
    const decodedChannels = channelsOf(decoded);
    const reference = channels.map((channel) => channel.subarray(windowFrom, windowFrom + windowLength));
    const aligned = alignment(reference, decodedChannels);
    const report = {
      file: name,
      bytes: bytes.length,
      kbps: (bytes.length * 8) / (windowLength / SAMPLE_RATE) / 1000,
      channels: channels.length,
      preSkip: header.preSkip,
      decodedSamples: decoded.length,
      expectedSamples: windowLength,
      decodedBytes48k: decoded.length * decoded.numberOfChannels * 4,
      lag: aligned.lag,
      snrDb: aligned.snrDb,
      lufs: integratedLoudness(decodedChannels, { from: MARGIN, length: loop, periodic: true }),
      truePeakDbtp: truePeak(decodedChannels, MARGIN, loop),
      seam: seamMetrics(decodedChannels, MARGIN, MARGIN + loop),
      click48k: await loopPlayback(bytes, 48000, loop),
      click44k: await loopPlayback(bytes, 44100, loop),
      bands: bandShares(monoOf(decodedChannels, MARGIN, loop)),
      spectrogram: await spectrogramPng(decodedChannels, MARGIN, loop, score, name),
    };
    stemReports[stem] = report;
    files.push({ name, base64: base64(bytes) });
    const fail = (ok, what) => checks.push({ ok, what: `${name}: ${what}` });
    fail(
      header.crcOk && header.samples === windowLength,
      `Ogg pages valid, granule covers ${windowLength} samples`
    );
    fail(decoded.length === windowLength, `decodes to ${decoded.length} of ${windowLength} samples`);
    fail(aligned.lag === 0, `decoded alignment lag ${aligned.lag}`);
    fail(report.truePeakDbtp <= MAX_TRUE_PEAK_DBTP, `true peak ${report.truePeakDbtp.toFixed(2)} dBTP`);
    fail(
      report.seam.mismatchDb < -60,
      `decoded loop periodic: |x[loopStart] − x[loopEnd]| ${report.seam.mismatchDb.toFixed(1)} dBFS`
    );
    fail(
      report.click48k < 2 && report.click44k < 2,
      `seam click score ${report.click48k.toFixed(2)} / ${report.click44k.toFixed(2)}`
    );
    if (stem === 'base')
      fail(Math.abs(report.lufs - TARGET_LUFS) <= 0.5, `loudness ${report.lufs.toFixed(2)} LUFS`);
  }
  const motif = await motifReport(score);
  const decodedBytes = Object.values(stemReports).reduce((sum, report) => sum + report.decodedBytes48k, 0);
  checks.push({
    ok: decodedBytes <= 24 * 2 ** 20,
    what: `${id}: decoded stems ${(decodedBytes / 2 ** 20).toFixed(2)} MiB`,
  });
  if (!['library', 'selection', 'defeat'].includes(id))
    checks.push({
      ok: motif.heardStatements.length > 0,
      what: `${id}: motif heard ${motif.heardStatements.length}×`,
    });
  return {
    id,
    bpm: score.track.bpm,
    bars: score.track.bars,
    loopSeconds: loop / SAMPLE_RATE,
    renderMs,
    masterGainDb: 20 * Math.log10(gain),
    leadVsMixLu,
    limiterMaxReductionDb: reduction,
    limiterOver1dbPercent: (100 * reduced) / loop,
    stems: stemReports,
    decodedBytes,
    motif,
    files,
    checks,
  };
}
