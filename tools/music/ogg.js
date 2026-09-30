// Ogg Opus (RFC 3533 + RFC 7845) writer and reader for the baked music. Pure, no DOM: the bake
// tool muxes WebCodecs Opus packets with it and test/audio.test.js reads the shipped files.

const OPUS_RATE = 48000;
const PAGE_SAMPLES = OPUS_RATE; // about one page per second of audio
const MAX_SEGMENTS = 255;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let bit = 0; bit < 8; bit++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();

// Ogg's CRC-32: polynomial 0x04c11db7, no reflection, zero initial value and final xor.
export function oggCrc(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++)
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ bytes[i]) & 0xff]) >>> 0;
  return crc;
}

function page({ serial, sequence, granule, flags, packets }) {
  const lacing = [];
  for (const packet of packets) {
    for (let left = packet.length; ; left -= 255) {
      lacing.push(Math.min(255, left));
      if (left < 255) break;
    }
  }
  if (lacing.length > MAX_SEGMENTS) throw new Error('ogg: too many segments on one page');
  const body = packets.reduce((sum, packet) => sum + packet.length, 0);
  const bytes = new Uint8Array(27 + lacing.length + body);
  const view = new DataView(bytes.buffer);
  bytes.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  bytes[5] = flags;
  view.setBigInt64(6, BigInt(granule), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, sequence, true);
  bytes[26] = lacing.length;
  bytes.set(lacing, 27);
  let offset = 27 + lacing.length;
  for (const packet of packets) {
    bytes.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, oggCrc(bytes), true);
  return bytes;
}

const ascii = (text) => new TextEncoder().encode(text);

function opusHead(channels, preSkip) {
  const head = new Uint8Array(19);
  const view = new DataView(head.buffer);
  head.set(ascii('OpusHead'), 0);
  head[8] = 1;
  head[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, OPUS_RATE, true);
  view.setInt16(16, 0, true);
  head[18] = 0;
  return head;
}

function opusTags(vendor, comments) {
  const entries = Object.entries(comments).map(([key, value]) => ascii(`${key}=${value}`));
  const vendorBytes = ascii(vendor);
  const bytes = new Uint8Array(
    8 + 4 + vendorBytes.length + 4 + entries.reduce((sum, e) => sum + 4 + e.length, 0)
  );
  const view = new DataView(bytes.buffer);
  bytes.set(ascii('OpusTags'), 0);
  view.setUint32(8, vendorBytes.length, true);
  bytes.set(vendorBytes, 12);
  let offset = 12 + vendorBytes.length;
  view.setUint32(offset, entries.length, true);
  offset += 4;
  for (const entry of entries) {
    view.setUint32(offset, entry.length, true);
    bytes.set(entry, offset + 4);
    offset += 4 + entry.length;
  }
  return bytes;
}

// `packets`: Opus packets of `frameSamples` each (48 kHz). The stream decodes to exactly
// `samples` PCM frames: the decoder drops `preSkip` leading samples, and the last page's granule
// position (preSkip + samples) trims the encoder's padding at the end. Packets past that point are
// not written.
export function muxOggOpus({ packets, frameSamples, channels, preSkip, samples, tags = {}, vendor, serial }) {
  const end = preSkip + samples;
  const needed = Math.ceil(end / frameSamples);
  if (packets.length < needed) throw new Error(`ogg: ${packets.length} packets cannot cover ${end} samples`);
  const pages = [
    page({ serial, sequence: 0, granule: 0, flags: 0x02, packets: [opusHead(channels, preSkip)] }),
    page({ serial, sequence: 1, granule: 0, flags: 0, packets: [opusTags(vendor, tags)] }),
  ];
  let pending = [];
  let granule = 0;
  for (let index = 0; index < needed; index++) {
    pending.push(packets[index]);
    granule += frameSamples;
    const last = index === needed - 1;
    const segments = pending.reduce((sum, packet) => sum + Math.floor(packet.length / 255) + 1, 0);
    if (last || pending.length * frameSamples >= PAGE_SAMPLES || segments > MAX_SEGMENTS - 8) {
      pages.push(
        page({
          serial,
          sequence: pages.length,
          granule: last ? end : granule,
          flags: last ? 0x04 : 0,
          packets: pending,
        })
      );
      pending = [];
    }
  }
  const out = new Uint8Array(pages.reduce((sum, bytes) => sum + bytes.length, 0));
  let offset = 0;
  for (const bytes of pages) {
    out.set(bytes, offset);
    offset += bytes.length;
  }
  return out;
}

// Parses an Ogg Opus file: header fields, tags, the decoded sample count (final granule minus
// pre-skip) and whether every page's CRC matches. Throws on a malformed stream.
export function readOggOpus(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packets = [];
  let offset = 0,
    partial = [],
    crcOk = true,
    pages = 0,
    granule = 0n,
    eos = false;
  while (offset < bytes.length) {
    if (view.getUint32(offset, false) !== 0x4f676753) throw new Error(`ogg: no capture pattern at ${offset}`);
    const flags = bytes[offset + 5];
    const count = bytes[offset + 26];
    const lacing = bytes.subarray(offset + 27, offset + 27 + count);
    const length = 27 + count + lacing.reduce((sum, value) => sum + value, 0);
    // A real copy: Node's Buffer#slice would be a view, and zeroing it would clobber the input.
    const copy = new Uint8Array(bytes.subarray(offset, offset + length));
    copy.fill(0, 22, 26);
    if (oggCrc(copy) !== view.getUint32(offset + 22, true)) crcOk = false;
    granule = view.getBigInt64(offset + 6, true);
    eos = Boolean(flags & 0x04);
    let cursor = offset + 27 + count;
    for (const value of lacing) {
      partial.push(bytes.subarray(cursor, cursor + value));
      cursor += value;
      if (value < 255) {
        const packet = new Uint8Array(partial.reduce((sum, part) => sum + part.length, 0));
        let at = 0;
        for (const part of partial) {
          packet.set(part, at);
          at += part.length;
        }
        packets.push(packet);
        partial = [];
      }
    }
    offset += length;
    pages += 1;
  }
  const [head, tagsPacket] = packets;
  const decoder = new TextDecoder();
  if (!head || decoder.decode(head.subarray(0, 8)) !== 'OpusHead') throw new Error('ogg: missing OpusHead');
  if (!tagsPacket || decoder.decode(tagsPacket.subarray(0, 8)) !== 'OpusTags')
    throw new Error('ogg: missing OpusTags');
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const tagsView = new DataView(tagsPacket.buffer, tagsPacket.byteOffset, tagsPacket.byteLength);
  const vendorLength = tagsView.getUint32(8, true);
  let cursor = 12 + vendorLength;
  const tags = {};
  const tagCount = tagsView.getUint32(cursor, true);
  cursor += 4;
  for (let i = 0; i < tagCount; i++) {
    const size = tagsView.getUint32(cursor, true);
    const [key, ...rest] = decoder.decode(tagsPacket.subarray(cursor + 4, cursor + 4 + size)).split('=');
    tags[key] = rest.join('=');
    cursor += 4 + size;
  }
  const preSkip = headView.getUint16(10, true);
  return {
    channels: head[9],
    preSkip,
    inputRate: headView.getUint32(12, true),
    vendor: decoder.decode(tagsPacket.subarray(12, 12 + vendorLength)),
    tags,
    samples: Number(granule) - preSkip,
    audioPackets: packets.length - 2,
    pages,
    crcOk,
    eos,
  };
}
