// Synthetic file/pixel metadata fixtures; no user images or original service code.
const zlib = require('node:zlib');
const crc32 = zlib.crc32; // Independent native CRC fixture producer (Node24+ Electron/Node26 host).
function chunk(type, data) {
  const size = Buffer.alloc(4),
    crc = Buffer.alloc(4),
    body = Buffer.concat([Buffer.from(type), data]);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
function metadata() {
  return {
    Comment: JSON.stringify({
      prompt: '가상의 정원, two people',
      uc: 'blur',
      seed: 0,
      width: 832,
      height: 1216,
      steps: 28,
      scale: 5.5,
      sampler: 'k_euler_ancestral',
      noise_schedule: 'karras',
      cfg_rescale: 0.2,
      model: 'nai-diffusion-5-full',
      v4_prompt: {
        use_coords: true,
        caption: {
          base_caption: '가상의 정원, two people',
          char_captions: [
            { char_caption: 'blue coat', centers: [{ x: 0.2, y: 0.5 }] },
            { char_caption: 'red coat', centers: [{ x: 0.8, y: 0.5 }] },
          ],
        },
      },
      v4_negative_prompt: {
        caption: {
          base_caption: 'blur',
          char_captions: [{ char_caption: '' }, { char_caption: 'hat' }],
        },
      },
    }),
    Source: 'synthetic-v5',
    Software: 'NovelAI',
  };
}
function fixture(value = metadata(), options = {}) {
  const width = options.width ?? 96,
    height = options.height ?? 64;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels.set([30, 100, 170, 255], i);
  }
  const format = options.format ?? 'text';
  if (format === 'alpha' || options.alpha) {
    const packed =
      options.alphaBytes ??
      zlib.gzipSync(Buffer.from(JSON.stringify(options.alpha ?? value)));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(options.bitLength ?? packed.length * 8);
    const payload = Buffer.concat([
      Buffer.from('stealth_pngcomp'),
      length,
      packed,
    ]);
    let bit = 0;
    for (const byte of payload)
      for (let b = 7; b >= 0; b--) {
        if (bit >= width * height) throw Error('fixture capacity');
        const x = Math.floor(bit / height),
          y = bit % height;
        pixels[(y * width + x) * 4 + 3] = 254 | ((byte >> b) & 1);
        bit++;
      }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(
      pixels.subarray(y * width * 4, (y + 1) * width * 4),
      y * (width * 4 + 1) + 1,
    );
  }
  const chunks = [chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw))];
  if (format !== 'alpha' && format !== 'none')
    for (const [key, text] of Object.entries(value)) {
      const input = Buffer.from(
        typeof text === 'string' ? text : JSON.stringify(text),
      );
      const name = Buffer.from(key + '\0');
      if (format === 'text')
        chunks.push(chunk('tEXt', Buffer.concat([name, input])));
      if (format === 'ztxt')
        chunks.push(
          chunk(
            'zTXt',
            Buffer.concat([name, Buffer.from([0]), zlib.deflateSync(input)]),
          ),
        );
      if (format === 'itxt' || format === 'itxt-plain')
        chunks.push(
          chunk(
            'iTXt',
            Buffer.concat([
              name,
              Buffer.from([format === 'itxt' ? 1 : 0, 0, 0, 0]),
              format === 'itxt' ? zlib.deflateSync(input) : input,
            ]),
          ),
        );
    }
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return {
    bytes: Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      ...chunks,
    ]),
    pixels: { width, height, data: pixels },
  };
}
module.exports = { fixture, metadata, chunk };
