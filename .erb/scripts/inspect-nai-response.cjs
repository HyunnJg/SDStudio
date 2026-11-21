// Explicit local file only. No API, credential lookup, file extraction or output writes.
const fs = require('node:fs');
require('ts-node/register/transpile-only');
const {
  readNaiImageResponse,
  IMAGE_RESPONSE_LIMITS,
} = require('../../src/main/nai/imageResponse');
const { NaiError } = require('../../src/main/nai/errors');

function readBounded(file) {
  let fd;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0),
    );
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw Error('INPUT_ERROR');
    if (stat.size > IMAGE_RESPONSE_LIMITS.zipBytes)
      throw new NaiError(
        'RESPONSE_TOO_LARGE',
        false,
        undefined,
        'response-compressed-limit',
      );
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) throw Error('INPUT_ERROR');
      offset += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null))
      throw Error('INPUT_ERROR');
    return bytes;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
async function inspect(file) {
  const bytes = readBounded(file);
  try {
    const png = await readNaiImageResponse(bytes);
    return { ok: true, zipBytes: bytes.length, pngBytes: png.byteLength };
  } catch (error) {
    if (!(error instanceof NaiError)) throw error;
    return {
      ok: false,
      zipBytes: bytes.length,
      code: error.code,
      reason: error.imageResponseReason,
    };
  }
}
(async () => {
  try {
    if (process.argv.length !== 3) throw Error('INPUT_ERROR');
    const result = await inspect(process.argv[2]);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    const result =
      error instanceof NaiError
        ? { ok: false, code: error.code, reason: error.imageResponseReason }
        : { ok: false, code: 'INPUT_ERROR' };
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = 2;
  }
})();
