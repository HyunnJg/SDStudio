const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { NaiTransport, IMAGE_ENDPOINT } = require('../main/nai/transport');
const flush = () => new Promise(setImmediate);
const body = Buffer.from('{"model":"fixture-model-not-for-api"}');
function fixture(overrides = {}) {
  let options,
    request,
    reads = 0;
  const session = { synthetic: true };
  const transport = new NaiTransport({
    session,
    offline: () => false,
    token: () => {
      reads++;
      return 'synthetic-token';
    },
    request: (value) => {
      options = value;
      request = new EventEmitter();
      request.headers = {};
      request.writes = [];
      request.aborted = false;
      request.setHeader = (k, v) => {
        request.headers[k] = v;
      };
      request.write = (value) => request.writes.push(Buffer.from(value));
      request.end = () => {};
      request.abort = () => {
        request.aborted = true;
        request.emit('abort');
        request.emit('error', Error('synthetic secret raw network error'));
      };
      return request;
    },
    ...overrides,
  });
  function response(status = 200, contentType = 'application/zip') {
    const r = new EventEmitter();
    r.statusCode = status;
    r.headers = { 'content-type': contentType };
    request.emit('response', r);
    return r;
  }
  return {
    transport,
    session,
    response,
    get request() {
      return request;
    },
    get options() {
      return options;
    },
    get reads() {
      return reads;
    },
  };
}

test('offline and already-cancelled requests never access credentials or create a request', async () => {
  const f = fixture({ offline: () => true });
  await assert.rejects(f.transport.send(body), {
    code: 'OFFLINE',
    mayHaveReachedServer: false,
  });
  assert.equal(f.reads, 0);
  assert.equal(f.request, undefined);
  const c = new AbortController();
  c.abort();
  const g = fixture();
  await assert.rejects(g.transport.send(body, c.signal), {
    code: 'CANCELLED',
    mayHaveReachedServer: false,
  });
  assert.equal(g.reads, 0);
});

test('stop while awaiting credentials prevents a later send; signal is cleaned up', async () => {
  let release;
  const token = new Promise((r) => {
      release = r;
    }),
    c = new AbortController();
  let listeners = 0;
  const add = c.signal.addEventListener.bind(c.signal),
    remove = c.signal.removeEventListener.bind(c.signal);
  c.signal.addEventListener = (...args) => {
    listeners++;
    return add(...args);
  };
  c.signal.removeEventListener = (...args) => {
    listeners--;
    return remove(...args);
  };
  const f = fixture({ token: () => token });
  const promise = f.transport.send(body, c.signal);
  c.abort();
  await assert.rejects(promise, {
    code: 'CANCELLED',
    mayHaveReachedServer: false,
  });
  release('synthetic-late');
  await flush();
  assert.equal(f.request, undefined);
  assert.equal(listeners, 0);
});

test('deadline includes credential waiting, rejects promptly and ignores late credentials', async () => {
  let release;
  const f = fixture({
    token: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  await assert.rejects(f.transport.send(body, undefined, 10), {
    code: 'TIMEOUT',
    mayHaveReachedServer: false,
  });
  release('synthetic-late');
  await flush();
  assert.equal(f.request, undefined);
});

test('offline is rechecked after credential wait before creating a Chromium request', async () => {
  let offline = false,
    release;
  const f = fixture({
    offline: () => offline,
    token: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  const p = f.transport.send(body);
  offline = true;
  release('synthetic-token');
  await assert.rejects(p, { code: 'OFFLINE', mayHaveReachedServer: false });
  assert.equal(f.request, undefined);
});

test('session binding, fixed endpoint, no cookies, caller byte snapshot and unchanged binary response', async () => {
  const f = fixture(),
    input = Buffer.from(body),
    c = new AbortController();
  const p = f.transport.send(input, c.signal);
  input.fill(0);
  await flush();
  assert.equal(f.options.url, IMAGE_ENDPOINT);
  assert.equal(f.options.session, f.session);
  assert.equal(f.options.redirect, 'manual');
  assert.equal(f.options.credentials, 'omit');
  assert.equal(f.request.headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(f.request.writes, [body]);
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 255, 33]),
    r = f.response(200, '  application/zip; charset=binary  ');
  r.emit('data', zip.subarray(0, 3));
  r.emit('data', zip.subarray(3));
  r.emit('end');
  assert.deepEqual(Buffer.from(await p), zip);
  c.abort();
  assert.equal(f.request.aborted, false);
});

test('cancel/timeout after write abort once, mark uncertain server processing and ignore late completion', async () => {
  for (const mode of ['cancel', 'timeout']) {
    const f = fixture(),
      c = new AbortController();
    const p = f.transport.send(body, c.signal, mode === 'timeout' ? 10 : 1000);
    await flush();
    const r = f.response();
    if (mode === 'cancel') c.abort();
    await assert.rejects(p, {
      code: mode === 'cancel' ? 'CANCELLED' : 'TIMEOUT',
      mayHaveReachedServer: true,
    });
    assert.equal(f.request.aborted, true);
    r.emit('data', Buffer.from('late'));
    r.emit('end');
    f.request.emit('close');
    assert.equal(f.reads, 1); // No retry.
  }
});

test('redirects are refused without following or retrying; raw server errors are never retained', async () => {
  const f = fixture(),
    p = f.transport.send(body);
  await flush();
  f.request.emit('redirect', 307, 'POST', 'https://untrusted.test/', {});
  await assert.rejects(p, { code: 'REDIRECT', mayHaveReachedServer: true });
  assert.equal(f.request.aborted, true);
  for (const status of [401, 429, 500]) {
    const g = fixture(),
      promise = g.transport.send(body);
    await flush();
    g.response(status).emit(
      'data',
      Buffer.from('synthetic-token private prompt'),
    );
    await assert.rejects(
      promise,
      (e) =>
        e.code === 'HTTP_ERROR' &&
        e.httpStatus === status &&
        !JSON.stringify(e).includes('private'),
    );
    assert.equal(g.reads, 1);
  }
});

test('network/early-close, wrong MIME and bounded response fail without successful image or retry', async () => {
  for (const mode of ['error', 'close', 'mime', 'limit', 'aborted']) {
    const f = fixture(),
      p = f.transport.send(body, undefined, mode === 'close' ? 10 : 1000);
    await flush();
    if (mode === 'error')
      f.request.emit('error', Error('synthetic-token raw detail'));
    else if (mode === 'close') f.request.emit('close');
    else if (mode === 'mime') f.response(200, 'application/json');
    else {
      const r = f.response();
      if (mode === 'aborted') r.emit('aborted');
      else {
        const block = Buffer.alloc(1024 * 1024);
        for (let i = 0; i < 65; i++) r.emit('data', block);
      }
    }
    await assert.rejects(
      p,
      (e) =>
        e.mayHaveReachedServer &&
        !e.message.includes('synthetic-token') &&
        e.code ===
          ({
            mime: 'RESPONSE_FORMAT',
            limit: 'RESPONSE_TOO_LARGE',
            close: 'TIMEOUT',
          }[mode] || 'NETWORK'),
    );
    assert.equal(f.reads, 1);
  }
});

test('invalid request bounds and unsafe tokens fail before transmission', async () => {
  for (const [input, timeout] of [
    [Buffer.alloc(0), 1],
    [Buffer.alloc(4 * 1024 * 1024 + 1), 1],
    [body, 0],
    [body, Infinity],
    [body, 180001],
  ]) {
    const f = fixture();
    await assert.rejects(f.transport.send(input, undefined, timeout), {
      code: 'INVALID_INPUT',
    });
    assert.equal(f.reads, 0);
  }
  const f = fixture({ token: () => 'header\r\ninjection' });
  await assert.rejects(f.transport.send(body), {
    code: 'INVALID_INPUT',
    mayHaveReachedServer: false,
  });
  assert.equal(f.request, undefined);
});

test('a synchronous credential provider cannot overrun the deadline and then send before the timer callback', async () => {
  const f = fixture({
    token: () => {
      const end = performance.now() + 25;
      while (performance.now() < end) {
        /* Simulate blocking OS keychain. */
      }
      return 'synthetic';
    },
  });
  await assert.rejects(f.transport.send(body, undefined, 5), {
    code: 'TIMEOUT',
    mayHaveReachedServer: false,
  });
  assert.equal(f.request, undefined);
});

test('Electron writable finish/close before the HTTP response does not abort a successful transaction', async () => {
  const f = fixture(),
    p = f.transport.send(body);
  await flush();
  f.request.emit('finish');
  f.request.emit('close');
  const response = f.response();
  response.emit('data', Buffer.from([80, 75, 3, 4]));
  response.emit('end');
  assert.deepEqual(Array.from(await p), [80, 75, 3, 4]);
  assert.equal(f.request.aborted, false);
});
