/**
 * A ZIP writer, because an export pack has to arrive as one file and Node
 * ships DEFLATE but not an archive format.
 *
 * Entry timestamps are fixed at the DOS epoch rather than "now", so the same
 * pack exported twice is byte-identical. That is not neatness: a reference
 * pack is an input to an agent, and an input that changes bytes without
 * changing meaning cannot be diffed or cached.
 */

import { deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Buffer };

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00:00, the earliest timestamp the format can express. */
const DOS_TIME = 0;
const DOS_DATE = 33;

export function zip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = entry.data;
    const compressed = deflateRawSync(raw, { level: 9 });
    // Storing is smaller than deflating for already-compressed bytes (PNG, JPEG).
    const useDeflate = compressed.length < raw.length;
    const body = useDeflate ? compressed : raw;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);

    const entryHeader = Buffer.alloc(46);
    entryHeader.writeUInt32LE(0x02014b50, 0);
    entryHeader.writeUInt16LE(20, 4);
    entryHeader.writeUInt16LE(20, 6);
    entryHeader.writeUInt16LE(0x0800, 8);
    entryHeader.writeUInt16LE(useDeflate ? 8 : 0, 10);
    entryHeader.writeUInt16LE(DOS_TIME, 12);
    entryHeader.writeUInt16LE(DOS_DATE, 14);
    entryHeader.writeUInt32LE(crc, 16);
    entryHeader.writeUInt32LE(body.length, 20);
    entryHeader.writeUInt32LE(raw.length, 24);
    entryHeader.writeUInt16LE(name.length, 28);
    entryHeader.writeUInt16LE(0, 30);
    entryHeader.writeUInt16LE(0, 32);
    entryHeader.writeUInt16LE(0, 34);
    entryHeader.writeUInt16LE(0, 36);
    entryHeader.writeUInt32LE(0, 38);
    entryHeader.writeUInt32LE(offset, 42);
    central.push(entryHeader, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
}
