const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  default: ThumbnailQueue,
} = require('../renderer/generation/thumbnailQueue');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test('visible thumbnail work is serialized and retains ordering after a read fails', async () => {
  const queue = new ThumbnailQueue(),
    first = deferred(),
    calls = [];
  const signal = new AbortController().signal;
  const a = queue.read(async () => {
    calls.push('a');
    await first.promise;
    return 1;
  }, signal);
  const b = queue.read(async () => {
    calls.push('b');
    throw Error('read failed');
  }, signal);
  const failed = assert.rejects(b, /read failed/);
  const c = queue.read(async () => {
    calls.push('c');
    return 3;
  }, signal);
  assert.deepEqual(calls, ['a']);
  first.resolve();
  assert.equal(await a, 1);
  await failed;
  assert.equal(await c, 3);
  assert.deepEqual(calls, ['a', 'b', 'c']);
});
test('scrolling out or switching project cancels waiting work before IPC and discards in-flight results', async () => {
  const queue = new ThumbnailQueue(),
    first = deferred(),
    active = new AbortController(),
    waiting = new AbortController();
  let reads = 0;
  const a = queue.read(async () => {
    reads++;
    return first.promise;
  }, active.signal);
  const b = queue.read(async () => {
    reads++;
    return 2;
  }, waiting.signal);
  const cancelled = Promise.all([
    assert.rejects(a, { name: 'AbortError' }),
    assert.rejects(b, { name: 'AbortError' }),
  ]);
  active.abort();
  waiting.abort();
  await cancelled;
  const c = queue.read(async () => {
    reads++;
    return 3;
  }, new AbortController().signal);
  assert.equal(reads, 1); // An active worker read is not falsely reported as cancelled at the worker.
  first.resolve(1);
  assert.equal(await c, 3);
  assert.equal(reads, 2);
});
test('already aborted jobs never start; a thrown loader does not strand the queue', async () => {
  const queue = new ThumbnailQueue(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    queue.read(async () => assert.fail('must not load'), controller.signal),
    { name: 'AbortError' },
  );
  await assert.rejects(
    queue.read(() => {
      throw Error('sync');
    }, new AbortController().signal),
    /sync/,
  );
  assert.equal(
    await queue.read(async () => 1, new AbortController().signal),
    1,
  );
});
