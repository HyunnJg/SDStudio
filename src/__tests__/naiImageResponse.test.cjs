const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const JSZip = require('jszip');
const {
  readNaiImageResponse,
  IMAGE_RESPONSE_LIMITS,
} = require('../main/nai/imageResponse');
const { NaiTransport } = require('../main/nai/transport');
const { png } = require('./fixtures/nai/png.cjs');
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
const rejection = (code) => (error) => {
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.equal(Object.hasOwn(error, 'cause'), false);
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
test('sendImage preserves request errors and marks decode failures as possibly processed without retry', async (t) => {
  const transport = new NaiTransport({ offline: () => false });
  const good = await zip();
  const send = t.mock.method(transport, 'send', async () => good);
  assert.deepEqual(
    Buffer.from(await transport.sendImage(Buffer.from('{}'))),
    png(),
  );
  send.mock.mockImplementation(async () =>
    Buffer.from('bad response with synthetic sensitive text'),
  );
  await assert.rejects(transport.sendImage(Buffer.from('{}')), (error) => {
    assert.equal(error.code, 'INVALID_IMAGE_RESPONSE');
    assert.equal(error.mayHaveReachedServer, true);
    assert.equal(error.message.includes('sensitive'), false);
    return true;
  });
  const controller = new AbortController();
  send.mock.mockImplementation(async () => {
    controller.abort();
    return good;
  });
  await assert.rejects(
    transport.sendImage(Buffer.from('{}'), controller.signal),
    { code: 'CANCELLED', mayHaveReachedServer: true },
  );
  assert.equal(send.mock.callCount(), 3);
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

test('sendImage shares the original deadline across transport and decoding and preserves pre-response errors', async (t) => {
  const transport = new NaiTransport({ offline: () => false }),
    good = await zip();
  const send = t.mock.method(transport, 'send', async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return good;
  });
  await assert.rejects(transport.sendImage(Buffer.from('{}'), undefined, 1), {
    code: 'TIMEOUT',
    mayHaveReachedServer: true,
  });
  const { NaiError } = require('../main/nai/errors');
  const original = new NaiError('HTTP_ERROR', true, 429);
  send.mock.mockImplementation(async () => {
    throw original;
  });
  await assert.rejects(
    transport.sendImage(Buffer.from('{}')),
    (error) => error === original,
  );
  assert.equal(send.mock.callCount(), 2);
});
