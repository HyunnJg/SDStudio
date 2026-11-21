// Synthetic RGBA pixels and opaque metadata; no user images.
const zlib = require('node:zlib');
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let i = 0; i < 8; i++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const head = Buffer.alloc(4),
    tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const value = Buffer.concat([Buffer.from(type), data]);
  tail.writeUInt32BE(crc(value));
  return Buffer.concat([head, value, tail]);
}
function png(width = 2, height = 1) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // RGBA, including one transparent pixel.
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk(
      'IDAT',
      zlib.deflateSync(Buffer.from([0, 1, 2, 3, 0, 17, 18, 19, 255])),
    ),
    chunk('tEXt', Buffer.from('Comment\0{"seed":0,"fixture":true}')),
    chunk('stEg', Buffer.from('synthetic opaque metadata')),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
module.exports = { png };
