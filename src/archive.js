import fs from 'node:fs';
import { Readable } from 'node:stream';

const TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function update(crc, bytes) { for (const byte of bytes) crc = TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0; }
export function crc32(bytes) { return (update(0xffffffff, bytes) ^ 0xffffffff) >>> 0; }

async function describe(entry) {
  const name = Buffer.from(entry.name, 'utf8');
  if (!entry.name || entry.name.startsWith('/') || entry.name.split(/[\\/]/).some(p => p === '..') || name.length > 65535) throw new Error('Invalid archive filename.');
  if (entry.bytes != null) {
    const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
    return { ...entry, bytes, name, size: bytes.length, crc: crc32(bytes) };
  }
  const stat = await fs.promises.stat(entry.path);
  if (!stat.isFile() || stat.size > 0xffffffff) throw new Error('Archive input must be an ordinary file smaller than 4 GB.');
  let crc = 0xffffffff;
  for await (const bytes of fs.createReadStream(entry.path)) crc = update(crc, bytes);
  return { ...entry, name, size: stat.size, crc: (crc ^ 0xffffffff) >>> 0 };
}

// Stored ZIP streaming keeps large audio/stem archives out of process memory.
export function zipStream(entries) {
  return Readable.from((async function* () {
    let offset = 0;
    const directory = [];
    for (const input of entries) {
      const entry = await describe(input);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
      local.writeUInt16LE(33, 12); local.writeUInt32LE(entry.crc, 14); local.writeUInt32LE(entry.size, 18);
      local.writeUInt32LE(entry.size, 22); local.writeUInt16LE(entry.name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x800, 8); central.writeUInt16LE(33, 14); central.writeUInt32LE(entry.crc, 16);
      central.writeUInt32LE(entry.size, 20); central.writeUInt32LE(entry.size, 24);
      central.writeUInt16LE(entry.name.length, 28); central.writeUInt32LE(offset, 42);
      directory.push(central, entry.name);
      yield local; yield entry.name;
      if (entry.bytes) yield entry.bytes;
      else for await (const bytes of fs.createReadStream(entry.path)) yield bytes;
      offset += local.length + entry.name.length + entry.size;
      if (offset > 0xffffffff) throw new Error('Archive is too large for this ZIP format.');
    }
    const start = offset;
    for (const bytes of directory) { yield bytes; offset += bytes.length; }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - start, 12); end.writeUInt32LE(start, 16);
    yield end;
  })());
}
