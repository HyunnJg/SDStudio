const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const JSZip = require('jszip');
const {
  readNaiImageResponse,
  IMAGE_RESPONSE_LIMITS,
} = require('../main/nai/imageResponse');
const { NaiTransport } = require('../main/nai/transport');
const { png } = require('./fixtures/nai/png.cjs');
const {
  isImageResponseReason,
  IMAGE_RESPONSE_REASONS,
} = require('../main/nai/responseReasons');
async function zip(data = png(), options = {}) {
  const archive = new JSZip();
  archive.file('image.png', data);
  return archive.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    ...options,
  });
}
const central = (b) => b.readUInt32LE(b.length - 6);
const rejection = (code, reason) => (error) => {
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.ok(isImageResponseReason(error.imageResponseReason));
  assert.equal(
    JSON.stringify(error).includes(error.imageResponseReason),
    false,
  );
  if (reason) assert.equal(error.imageResponseReason, reason);
  return true;
};
test('STORE/DEFLATE and streaming descriptors return the original RGBA/metadata PNG bytes', async () => {
  const original = png();
  for (const options of [{ compression: 'STORE' }, {}, { streamFiles: true }]) {
    const archive = await zip(original, options),
      before = Buffer.from(archive);
    assert.deepEqual(
      Buffer.from(await readNaiImageResponse(archive)),
      original,
    );
    assert.deepEqual(archive, before);
  }
});
test('caller bytes are snapshotted before asynchronous inflation', async () => {
  const archive = await zip(),
    original = png();
  const result = readNaiImageResponse(archive);
  archive.fill(0);
  assert.deepEqual(Buffer.from(await result), original);
});
test('declared expansion and compressed input limits reject before starting zlib', async (t) => {
  const archive = await zip();
  archive.writeUInt32LE(
    IMAGE_RESPONSE_LIMITS.pngBytes + 1,
    central(archive) + 24,
  );
  const mock = t.mock.method(zlib, 'createInflateRaw', () =>
    assert.fail('inflation must not start'),
  );
  await assert.rejects(
    readNaiImageResponse(archive),
    rejection('RESPONSE_TOO_LARGE'),
  );
  await assert.rejects(
    readNaiImageResponse(new Uint8Array(IMAGE_RESPONSE_LIMITS.zipBytes + 1)),
    rejection('RESPONSE_TOO_LARGE'),
  );
  assert.equal(mock.mock.callCount(), 0);
});
test('forged small expanded sizes are checked against actual streamed output', async () => {
  const archive = await zip();
  archive.writeUInt32LE(8, 22);
  archive.writeUInt32LE(8, central(archive) + 24);
  await assert.rejects(
    readNaiImageResponse(archive),
    rejection('INVALID_IMAGE_RESPONSE'),
  );
});
test('actual expansion limit stops a forged archive while streaming', async () => {
  const archive = await zip(Buffer.alloc(IMAGE_RESPONSE_LIMITS.pngBytes + 1));
  archive.writeUInt32LE(IMAGE_RESPONSE_LIMITS.pngBytes, 22);
  archive.writeUInt32LE(IMAGE_RESPONSE_LIMITS.pngBytes, central(archive) + 24);
  await assert.rejects(
    readNaiImageResponse(archive),
    rejection('RESPONSE_TOO_LARGE'),
  );
});
test('ZIP CRC and PNG chunk CRC, truncation, dimension and IEND checks fail explicitly', async () => {
  const badZip = await zip();
  badZip.writeUInt32LE(0, 14);
  badZip.writeUInt32LE(0, central(badZip) + 16);
  await assert.rejects(
    readNaiImageResponse(badZip),
    rejection('INVALID_IMAGE_RESPONSE'),
  );
  const badCrc = png();
  badCrc[30] ^= 1;
  for (const data of [
    badCrc,
    png().subarray(0, -12),
    Buffer.concat([png(), Buffer.from('trailing')]),
    Buffer.from('not PNG'),
  ])
    await assert.rejects(
      readNaiImageResponse(await zip(data)),
      rejection('INVALID_IMAGE_RESPONSE'),
    );
  await assert.rejects(
    readNaiImageResponse(await zip(png(100000, 100000))),
    rejection('RESPONSE_TOO_LARGE'),
  );
});
test('multiple images, directories, sidecars, unsafe names and symlinks are rejected', async () => {
  for (const files of [
    { 'a.png': png(), 'b.png': png() },
    { 'image.png': png(), 'note.txt': 'x' },
    { '../image.png': png() },
    { '/image.png': png() },
    { 'image.png': png(), folder: null },
  ]) {
    const archive = new JSZip();
    for (const [name, data] of Object.entries(files))
      data === null ? archive.folder(name) : archive.file(name, data);
    await assert.rejects(
      readNaiImageResponse(await archive.generateAsync({ type: 'nodebuffer' })),
      rejection('INVALID_IMAGE_RESPONSE'),
    );
  }
  const b = await zip();
  b.writeUInt32LE(0xa0000000, central(b) + 38);
  await assert.rejects(
    readNaiImageResponse(b),
    rejection('INVALID_IMAGE_RESPONSE'),
  );
});
test('header disagreements, encrypted/unsupported methods, split/ZIP64 and trailing bytes fail', async () => {
  const good = await zip();
  for (const mutate of [
    (b) => b.writeUInt16LE(1, central(b) + 8),
    (b) => b.writeUInt16LE(99, central(b) + 10),
    (b) => b.writeUInt16LE(1, b.length - 18),
    (b) => b.writeUInt16LE(0xffff, b.length - 12),
    (b) => b.writeUInt32LE(1, central(b) + 42),
    (b) => {
      b[30] = 65;
    },
    (b) => b.writeUInt32LE(0, 14),
  ]) {
    const archive = Buffer.from(good);
    mutate(archive);
    await assert.rejects(
      readNaiImageResponse(archive),
      rejection('INVALID_IMAGE_RESPONSE'),
    );
  }
  for (const archive of [
    good.subarray(0, -1),
    Buffer.concat([good, Buffer.from([0])]),
    Buffer.from([0, 1, 2]),
  ])
    await assert.rejects(
      readNaiImageResponse(archive),
      rejection('INVALID_IMAGE_RESPONSE'),
    );
});
test('cancellation before and during inflation and the decoding deadline settle once', async () => {
  const archive = await zip(Buffer.alloc(4 * 1024 * 1024));
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    readNaiImageResponse(archive, before.signal),
    rejection('CANCELLED'),
  );
  const during = new AbortController();
  const task = readNaiImageResponse(archive, during.signal);
  setImmediate(() => during.abort());
  await assert.rejects(task, rejection('CANCELLED'));
  await assert.rejects(
    readNaiImageResponse(archive, undefined, 0.001),
    rejection('TIMEOUT'),
  );
});
function imageTransport(respond) {
  let requests = 0;
  const transport = new NaiTransport({
    offline: () => false,
    token: () => 'synthetic-token',
    session: {},
    request: () => {
      requests++;
      const request = new EventEmitter();
      request.setHeader = () => {};
      request.write = () => {};
      request.abort = () => {};
      request.end = () => respond(request);
      return request;
    },
  });
  return { transport, requests: () => requests };
}
function emitImageResponse(request, bytes, status = 200) {
  const response = new EventEmitter();
  response.statusCode = status;
  response.headers = { 'content-type': 'application/zip' };
  request.emit('response', response);
  response.emit('data', bytes);
  response.emit('end');
}
test('sendImage marks decode failures and cancellation after reception as possibly processed without retry', async () => {
  const good = await zip();
  let bytes = good;
  let afterResponse = () => {};
  const f = imageTransport((request) => {
    emitImageResponse(request, bytes);
    afterResponse();
  });
  assert.deepEqual(
    Buffer.from(await f.transport.sendImage(Buffer.from('{}'))),
    png(),
  );
  bytes = Buffer.from('bad response with synthetic sensitive text');
  await assert.rejects(f.transport.sendImage(Buffer.from('{}')), (error) => {
    assert.equal(error.code, 'INVALID_IMAGE_RESPONSE');
    assert.equal(error.mayHaveReachedServer, true);
    assert.equal(error.message.includes('sensitive'), false);
    assert.equal(error.imageResponseReason, 'zip-eocd');
    return true;
  });
  const controller = new AbortController();
  bytes = good;
  afterResponse = () => controller.abort();
  await assert.rejects(
    f.transport.sendImage(Buffer.from('{}'), controller.signal),
    {
      code: 'CANCELLED',
      mayHaveReachedServer: true,
    },
  );
  assert.equal(f.requests(), 3);
});

test('unused compressed trailing data and malformed or ZIP64 extra fields cannot hide in a valid archive', async () => {
  const good = await zip(),
    c = central(good);
  const extraData = Buffer.concat([
    good.subarray(0, c),
    Buffer.from([0]),
    good.subarray(c),
  ]);
  extraData.writeUInt32LE(good.readUInt32LE(18) + 1, 18);
  extraData.writeUInt32LE(good.readUInt32LE(c + 20) + 1, c + 1 + 20);
  extraData.writeUInt32LE(c + 1, extraData.length - 6);
  await assert.rejects(
    readNaiImageResponse(extraData),
    rejection('INVALID_IMAGE_RESPONSE'),
  );
  for (const extra of [
    Buffer.from([1, 0, 0, 0]),
    Buffer.from([2, 0, 255, 255]),
  ]) {
    const end = good.length - 22;
    const archive = Buffer.concat([
      good.subarray(0, end),
      extra,
      good.subarray(end),
    ]);
    archive.writeUInt16LE(4, c + 30);
    archive.writeUInt32LE(good.readUInt32LE(end + 12) + 4, archive.length - 10);
    await assert.rejects(
      readNaiImageResponse(archive),
      rejection('INVALID_IMAGE_RESPONSE'),
    );
  }
});

test('sendImage deadline includes response waiting and preserves pre-decode HTTP errors', async () => {
  const good = await zip();
  const f = imageTransport((request) => {
    setTimeout(() => emitImageResponse(request, good), 15);
  });
  await assert.rejects(f.transport.sendImage(Buffer.from('{}'), undefined, 1), {
    code: 'TIMEOUT',
    mayHaveReachedServer: true,
  });
  assert.equal(f.requests(), 1);
  const consumed = imageTransport((request) => {
    emitImageResponse(request, good);
    // Resolve reception, then use the remaining budget before its await resumes.
    const end = performance.now() + 75;
    while (performance.now() < end) {
      /* synthetic main-thread delay */
    }
  });
  await assert.rejects(
    consumed.transport.sendImage(Buffer.from('{}'), undefined, 50),
    {
      code: 'TIMEOUT',
      mayHaveReachedServer: true,
      imageResponseReason: 'response-deadline',
    },
  );
  assert.equal(consumed.requests(), 1);
  const g = imageTransport((request) => emitImageResponse(request, good, 429));
  await assert.rejects(g.transport.sendImage(Buffer.from('{}')), {
    code: 'HTTP_ERROR',
    mayHaveReachedServer: true,
    httpStatus: 429,
  });
  assert.equal(g.requests(), 1);
});

test('rejection reasons identify format stages without reflecting input contents', async () => {
  const crcZip = await zip();
  crcZip.writeUInt32LE(0, 14);
  crcZip.writeUInt32LE(0, central(crcZip) + 16);
  const flagsZip = await zip();
  flagsZip.writeUInt16LE(1, central(flagsZip) + 8);
  const methodZip = await zip();
  methodZip.writeUInt16LE(99, central(methodZip) + 10);
  const headerZip = await zip();
  headerZip.writeUInt32LE(0, 14);
  const countZip = new JSZip();
  countZip.file('a.png', png());
  countZip.file('b.png', png());
  const nameZip = new JSZip();
  nameZip.file('../synthetic-sensitive-prompt.png', png(), {
    createFolders: false,
  });
  const crcPng = png();
  crcPng[30] ^= 1;
  const pixelPng = png(100000, 100000);
  const idatMissing = Buffer.concat([
    png().subarray(0, 33),
    png().subarray(-12),
  ]);
  for (const [input, reason] of [
    [Buffer.from('synthetic-sensitive-server-body'), 'zip-eocd'],
    [await countZip.generateAsync({ type: 'nodebuffer' }), 'zip-entry-count'],
    [await nameZip.generateAsync({ type: 'nodebuffer' }), 'zip-name'],
    [flagsZip, 'zip-flags'],
    [methodZip, 'zip-method'],
    [headerZip, 'zip-local'],
    [crcZip, 'zip-crc'],
    [await zip(Buffer.from('bad image')), 'png-signature'],
    [await zip(crcPng), 'png-crc'],
    [await zip(png().subarray(0, -12)), 'png-iend'],
    [await zip(idatMissing), 'png-idat'],
    [
      await zip(
        Buffer.concat([png(), Buffer.from('synthetic-sensitive-trailer')]),
      ),
      'png-trailing',
    ],
    [await zip(pixelPng), 'png-pixel-limit'],
  ]) {
    await assert.rejects(readNaiImageResponse(input), (error) => {
      assert.equal(error.imageResponseReason, reason);
      assert.equal(error.message, error.code);
      assert.equal(JSON.stringify(error).includes('sensitive'), false);
      assert.equal(error.stack.includes('synthetic-sensitive'), false);
      return true;
    });
  }
});
test('STORE output owns an exact PNG buffer and exposes no surrounding ZIP bytes', async () => {
  const input = await zip(png(), { compression: 'STORE' }),
    output = await readNaiImageResponse(input);
  assert.deepEqual(Buffer.from(output.buffer), png());
  assert.equal(output.byteOffset, 0);
  assert.equal(output.buffer.byteLength, output.byteLength);
  output[0] = 0;
  assert.equal(input[0], 0x50);
});
test('main-only reason labels are immutable, non-enumerable and runtime allowlisted', () => {
  const { NaiError } = require('../main/nai/errors');
  assert.equal(Object.isFrozen(IMAGE_RESPONSE_REASONS), true);
  const error = new NaiError(
    'INVALID_IMAGE_RESPONSE',
    true,
    undefined,
    'png-crc',
  );
  assert.equal(error.imageResponseReason, 'png-crc');
  assert.equal(
    Object.getOwnPropertyDescriptor(error, 'imageResponseReason').enumerable,
    false,
  );
  assert.equal(
    Object.getOwnPropertyDescriptor(error, 'imageResponseReason').writable,
    false,
  );
  assert.equal(
    JSON.parse(JSON.stringify(error)).imageResponseReason,
    undefined,
  );
  for (const reason of ['synthetic sensitive filename', null, {}, 42])
    assert.equal(
      new NaiError('INVALID_IMAGE_RESPONSE', false, undefined, reason)
        .imageResponseReason,
      undefined,
    );
});

test('volume/prefix/symlink/descriptor and unexpected internal failures carry stable labels', async (t) => {
  const good = await zip();
  for (const [mutate, reason] of [
    [(b) => b.writeUInt16LE(1, b.length - 18), 'zip-volume'],
    [(b) => b.writeUInt32LE(1, central(b) + 42), 'zip-prefix'],
    [(b) => b.writeUInt32LE(0xa0000000, central(b) + 38), 'zip-symlink'],
  ]) {
    const bytes = Buffer.from(good);
    mutate(bytes);
    await assert.rejects(
      readNaiImageResponse(bytes),
      rejection('INVALID_IMAGE_RESPONSE', reason),
    );
  }
  const streamed = await zip(png(), { streamFiles: true });
  streamed[central(streamed) - 12] ^= 1;
  await assert.rejects(
    readNaiImageResponse(streamed),
    rejection('INVALID_IMAGE_RESPONSE', 'zip-descriptor'),
  );
  await assert.rejects(
    readNaiImageResponse(null),
    rejection('INVALID_IMAGE_RESPONSE', 'response-input'),
  );
  t.mock.method(zlib, 'createInflateRaw', () => {
    throw Error('synthetic-sensitive-os-error');
  });
  await assert.rejects(
    readNaiImageResponse(good),
    rejection('INVALID_IMAGE_RESPONSE', 'response-internal'),
  );
});
