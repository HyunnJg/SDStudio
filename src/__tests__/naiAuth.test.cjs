const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { NaiTokenStore } = require('../main/nai/tokenStore');
const { registerNaiAuth, isTrustedAuthFrame } = require('../main/nai/authIpc');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-auth-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'auth', 'novelai-token.v1.json');
  const key = crypto.randomBytes(32);
  let failEncryption = false;
  let backend = 'gnome_libsecret';
  let decryptions = 0;
  // Synthetic provider: exercise ciphertext persistence without requiring a real keyring.
  const encryption = {
    isAsyncEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: (s) => {
      if (failEncryption) throw Error('synthetic sensitive provider detail');
      const iv = crypto.randomBytes(12),
        cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptStringAsync: (data) => {
      decryptions++;
      const cipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        data.subarray(0, 12),
      );
      cipher.setAuthTag(data.subarray(12, 28));
      return {
        result: Buffer.concat([
          cipher.update(data.subarray(28)),
          cipher.final(),
        ]).toString(),
        shouldReEncrypt: false,
      };
    },
  };
  const create = () => new NaiTokenStore(file, encryption, 'linux');
  return {
    root,
    file,
    create,
    encryption,
    fail: () => {
      failEncryption = true;
    },
    basic: () => {
      backend = 'basic_text';
    },
    decryptions: () => decryptions,
  };
}
test('ciphertext survives restart, status never decrypts, file is private, legacy TOKEN untouched', async (t) => {
  const f = fixture(t),
    old = path.join(f.root, 'TOKEN.txt');
  fs.writeFileSync(old, 'synthetic-legacy');
  const before = fs.statSync(old).mtimeMs;
  const a = f.create();
  assert.equal((await a.status()).configured, false);
  assert.equal(fs.existsSync(path.dirname(f.file)), false);
  await a.set('synthetic-persistent-token', true);
  assert.equal(
    fs.readFileSync(f.file, 'utf8').includes('synthetic-persistent-token'),
    false,
  );
  assert.equal((await f.create().status()).storage, 'encrypted');
  assert.equal(f.decryptions(), 0);
  assert.equal(await f.create().read(), 'synthetic-persistent-token');
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(old, 'utf8'), 'synthetic-legacy');
  assert.equal(fs.statSync(old).mtimeMs, before);
});
test('basic_text and missing secure storage refuse persistence; session mode has no file and no resurrection', async (t) => {
  const f = fixture(t),
    a = f.create();
  await a.set('synthetic-old', true);
  f.basic();
  await assert.rejects(async () => await a.set('synthetic-new', true), {
    code: 'SECURE_STORAGE_UNAVAILABLE',
  });
  await assert.rejects(async () => await f.create().read(), {
    code: 'SECURE_STORAGE_UNAVAILABLE',
  });
  assert.equal((await a.set('synthetic-memory', false)).storage, 'session');
  assert.equal(fs.existsSync(f.file), false);
  assert.equal(await a.read(), 'synthetic-memory');
  a.lock();
  await assert.rejects(async () => await a.read(), { code: 'TOKEN_MISSING' });
  f.encryption.isAsyncEncryptionAvailable = () => false;
  assert.equal((await a.status()).secureStorageAvailable, false);
  await assert.rejects(async () => await a.set('synthetic', true), {
    code: 'SECURE_STORAGE_UNAVAILABLE',
  });
});
test('failed replacement preserves old ciphertext and memory, leaves no temp file or raw error', async (t) => {
  const f = fixture(t),
    a = f.create();
  await a.set('synthetic-old', true);
  const bytes = fs.readFileSync(f.file);
  f.fail();
  await assert.rejects(async () => await a.set('synthetic-new', true), {
    message: 'STORE_WRITE_FAILED',
  });
  assert.deepEqual(fs.readFileSync(f.file), bytes);
  assert.equal(await a.read(), 'synthetic-old');
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), [
    path.basename(f.file),
  ]);
  await a.set('synthetic-session', false);
  await assert.rejects(async () => await a.set('synthetic-persist', true), {
    code: 'STORE_WRITE_FAILED',
  });
  assert.equal(await a.read(), 'synthetic-session');
});
test('corrupt, future-version and undecryptable files are preserved until explicit clear', async (t) => {
  const f = fixture(t),
    a = f.create();
  fs.mkdirSync(path.dirname(f.file));
  for (const [text, code] of [
    ['{invalid', 'STORE_UNREADABLE'],
    ['{"version":2}', 'STORE_VERSION'],
  ]) {
    fs.writeFileSync(f.file, text);
    await assert.rejects(async () => await a.read(), { code });
    await assert.rejects(async () => await a.set('synthetic-new', true), {
      code,
    });
    await assert.rejects(async () => await a.set('synthetic-new', false), {
      code,
    });
    assert.equal(fs.readFileSync(f.file, 'utf8'), text);
  }
  fs.rmSync(f.file);
  await a.set('synthetic-old', true);
  const envelope = JSON.parse(fs.readFileSync(f.file));
  envelope.ciphertext = Buffer.from('invalid cryptographic payload').toString(
    'base64',
  );
  fs.writeFileSync(f.file, JSON.stringify(envelope));
  const bytes = fs.readFileSync(f.file);
  await assert.rejects(async () => await a.read(), {
    code: 'STORE_UNREADABLE',
  });
  assert.deepEqual(fs.readFileSync(f.file), bytes);
  assert.equal((await a.clear()).configured, false);
});
test('invalid token/remember values cannot replace a token or become a header', async (t) => {
  const f = fixture(t),
    a = f.create();
  await a.set('synthetic-old', false);
  for (const token of [
    '',
    null,
    {},
    'has spaces',
    'line\r\ninjected',
    'x'.repeat(4097),
  ])
    await assert.rejects(async () => await a.set(token, false), {
      code: 'INVALID_INPUT',
    });
  await assert.rejects(async () => await a.set('synthetic-new', 'true'), {
    code: 'INVALID_INPUT',
  });
  assert.equal(await a.read(), 'synthetic-old');
});
test('IPC refuses offline and foreign frames before store access; replies have no secret or raw exception', async () => {
  const handlers = new Map();
  let offline = true,
    trusted = false,
    accesses = 0;
  const store = {
    status: () => {
      accesses++;
      return {
        configured: false,
        storage: 'none',
        secureStorageAvailable: false,
      };
    },
    set: () => {
      accesses++;
      throw Error('SENSITIVE FIXTURE');
    },
    clear: async () => {
      accesses++;
      return await store.status();
    },
  };
  registerNaiAuth(
    { handle: (name, fn) => handlers.set(name, fn) },
    store,
    () => offline,
    () => trusted,
  );
  for (const fn of handlers.values())
    assert.deepEqual(await fn({}, 'synthetic-secret', true), {
      ok: false,
      code: 'UNTRUSTED_SENDER',
    });
  trusted = true;
  for (const fn of handlers.values())
    assert.deepEqual(await fn({}, 'synthetic-secret', true), {
      ok: false,
      code: 'OFFLINE',
    });
  assert.equal(accesses, 0);
  offline = false;
  assert.equal((await handlers.get('nai-auth-status')({})).ok, true);
  const response = await handlers.get('nai-auth-set')(
    {},
    'synthetic-secret',
    true,
  );
  assert.deepEqual(response, { ok: false, code: 'STORE_UNREADABLE' });
  assert.equal(JSON.stringify(response).includes('SENSITIVE'), false);
  assert.equal(handlers.has('nai-auth-get-token'), false);
});
test('auth trust is tied to current main frame and exact approved document path, not file origin alone', () => {
  const frame = { url: 'file:///app/index.html#/workspace' },
    contents = { mainFrame: frame };
  const event = { sender: contents, senderFrame: frame };
  assert.equal(
    isTrustedAuthFrame(event, contents, 'file:///app/index.html'),
    true,
  );
  assert.equal(
    isTrustedAuthFrame(
      { ...event, senderFrame: { ...frame } },
      contents,
      'file:///app/index.html',
    ),
    false,
  );
  assert.equal(isTrustedAuthFrame(event, {}, 'file:///app/index.html'), false);
  frame.url = 'file:///tmp/untrusted.html';
  assert.equal(
    isTrustedAuthFrame(event, contents, 'file:///app/index.html'),
    false,
  );
  frame.url = 'http://localhost:1212/index.html';
  assert.equal(
    isTrustedAuthFrame(event, contents, 'http://localhost:1212/index.html'),
    true,
  );
  frame.url = 'http://localhost:1313/index.html';
  assert.equal(
    isTrustedAuthFrame(event, contents, 'http://localhost:1212/index.html'),
    false,
  );
});
test('explicit local check returns readability without returning the token, and reports missing/corrupt data', async (t) => {
  const f = fixture(t),
    store = f.create(),
    handlers = new Map();
  registerNaiAuth(
    { handle: (name, fn) => handlers.set(name, fn) },
    store,
    () => false,
    () => true,
  );
  const check = async () => await handlers.get('nai-auth-check')({});
  assert.deepEqual(await check(), { ok: false, code: 'TOKEN_MISSING' });
  await store.set('synthetic-readability-secret', false);
  const result = await check();
  assert.equal(result.status.locallyReadable, true);
  assert.equal(
    JSON.stringify(result).includes('synthetic-readability-secret'),
    false,
  );
  await store.clear();
  fs.mkdirSync(path.dirname(f.file), { recursive: true });
  fs.writeFileSync(f.file, '{"version":999}');
  assert.deepEqual(await check(), { ok: false, code: 'STORE_VERSION' });
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('Gemini rejects a NovelAI token before replacing a stored key; NovelAI accepts it', async (t) => {
  const handlers = new Map();
  const ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const gemini = fixture(t).create();
  const nai = fixture(t).create();
  registerNaiAuth(
    ipc,
    gemini,
    () => false,
    () => true,
    'gemini-auth',
  );
  registerNaiAuth(
    ipc,
    nai,
    () => false,
    () => true,
  );
  await gemini.set('synthetic-gemini', true);
  const token = 'pst-synthetic-test-only';
  for (const remember of [true, false]) {
    assert.deepEqual(
      await handlers.get('gemini-auth-set')({}, token, remember),
      {
        ok: false,
        code: 'WRONG_PROVIDER',
      },
    );
    assert.equal(await gemini.read(), 'synthetic-gemini');
  }
  assert.ok((await handlers.get('nai-auth-set')({}, token, false)).ok);
  assert.equal(await nai.read(), token);
});

test('clear during encryption removes the old file immediately and late encryption cannot resurrect it', async (t) => {
  const f = fixture(t),
    store = f.create();
  await store.set('synthetic-old', true);
  const started = deferred(),
    gate = deferred(),
    encrypt = f.encryption.encryptStringAsync;
  f.encryption.encryptStringAsync = async (token) => {
    started.resolve();
    await gate.promise;
    return encrypt(token);
  };
  const result = assert.rejects(store.set('synthetic-late', true), {
    code: 'CANCELLED',
  });
  await started.promise;
  await store.clear();
  await assert.rejects(store.read(), { code: 'TOKEN_MISSING' });
  assert.equal(fs.existsSync(f.file), false);
  gate.resolve();
  await result;
  assert.equal((await store.status()).configured, false);
  assert.equal(fs.existsSync(f.file), false);
});

test('lock invalidates a pending write without waiting for the OS keyring', async (t) => {
  const f = fixture(t),
    store = f.create(),
    gate = deferred(),
    started = deferred();
  await store.set('synthetic-session', false);
  const encrypt = f.encryption.encryptStringAsync;
  f.encryption.encryptStringAsync = async (token) => {
    started.resolve();
    await gate.promise;
    return encrypt(token);
  };
  const result = assert.rejects(store.set('synthetic-late', true), {
    code: 'CANCELLED',
  });
  await started.promise;
  store.lock();
  gate.resolve();
  await result;
  await assert.rejects(store.read(), { code: 'TOKEN_MISSING' });
  assert.equal(fs.existsSync(f.file), false);
});

test('a newer session token wins over a pending persistent replacement', async (t) => {
  const f = fixture(t),
    store = f.create(),
    gate = deferred(),
    started = deferred();
  const encrypt = f.encryption.encryptStringAsync;
  f.encryption.encryptStringAsync = async (token) => {
    started.resolve();
    await gate.promise;
    return encrypt(token);
  };
  const old = assert.rejects(store.set('synthetic-old-pending', true), {
    code: 'CANCELLED',
  });
  await started.promise;
  await store.set('synthetic-current', false);
  gate.resolve();
  await old;
  assert.equal(await store.read(), 'synthetic-current');
  assert.equal(fs.existsSync(f.file), false);
});

test('a decrypt completing after token replacement never returns the previous plaintext', async (t) => {
  const f = fixture(t),
    store = f.create(),
    gate = deferred(),
    started = deferred();
  await store.set('synthetic-old', true);
  const decrypt = f.encryption.decryptStringAsync;
  f.encryption.decryptStringAsync = async (bytes) => {
    started.resolve();
    await gate.promise;
    return decrypt(bytes);
  };
  const old = assert.rejects(store.read(), { code: 'CANCELLED' });
  await started.promise;
  await store.set('synthetic-current', false);
  gate.resolve();
  await old;
  assert.equal(await store.read(), 'synthetic-current');
});

test('provider key rotation hints do not modify the v1 envelope on read', async (t) => {
  const f = fixture(t),
    store = f.create();
  await store.set('synthetic-existing', true);
  const before = fs.readFileSync(f.file),
    decrypt = f.encryption.decryptStringAsync;
  f.encryption.decryptStringAsync = async (bytes) => ({
    ...decrypt(bytes),
    shouldReEncrypt: true,
  });
  assert.equal(await store.read(), 'synthetic-existing');
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('a future envelope installed during encryption is preserved rather than overwritten', async (t) => {
  const f = fixture(t),
    store = f.create(),
    gate = deferred(),
    started = deferred(),
    encrypt = f.encryption.encryptStringAsync;
  await store.set('synthetic-old', true);
  f.encryption.encryptStringAsync = async (token) => {
    started.resolve();
    await gate.promise;
    return encrypt(token);
  };
  const result = assert.rejects(store.set('synthetic-new', true), {
    code: 'STORE_VERSION',
  });
  await started.promise;
  fs.writeFileSync(f.file, '{"version":999}');
  gate.resolve();
  await result;
  assert.equal(fs.readFileSync(f.file, 'utf8'), '{"version":999}');
});

test('clearing during token decryption makes transport fail before creating a network request', async (t) => {
  const { NaiTransport } = require('../main/nai/transport');
  const f = fixture(t),
    store = f.create(),
    gate = deferred(),
    started = deferred();
  await store.set('synthetic-old', true);
  const decrypt = f.encryption.decryptStringAsync;
  f.encryption.decryptStringAsync = async (bytes) => {
    started.resolve();
    await gate.promise;
    return decrypt(bytes);
  };
  let requests = 0;
  const transport = new NaiTransport({
    token: () => store.read(),
    offline: () => false,
    session: {},
    request: () => {
      requests++;
      throw Error('must not request');
    },
  });
  const result = assert.rejects(
    transport.sendImage(Buffer.from('{}')),
    (error) => error.code === 'CANCELLED' && !error.mayHaveReachedServer,
  );
  await started.promise;
  await store.clear();
  gate.resolve();
  await result;
  assert.equal(requests, 0);
});

test('read waits for the current async save; temporary provider errors preserve original ciphertext', async (t) => {
  const f = fixture(t),
    store = f.create(),
    gate = deferred(),
    started = deferred(),
    encrypt = f.encryption.encryptStringAsync;
  f.encryption.encryptStringAsync = async (token) => {
    started.resolve();
    await gate.promise;
    return encrypt(token);
  };
  const save = store.set('synthetic-current', true);
  await started.promise;
  const read = store.read();
  gate.resolve();
  await save;
  assert.equal(await read, 'synthetic-current');
  const before = fs.readFileSync(f.file);
  f.encryption.decryptStringAsync = async () => {
    throw Object.assign(Error('sensitive-provider-detail'), {
      isTemporarilyUnavailable: true,
    });
  };
  await assert.rejects(store.read(), { code: 'SECURE_STORAGE_UNAVAILABLE' });
  assert.deepEqual(fs.readFileSync(f.file), before);
});

test('auth IPC awaits provider completion and converts async failures to fixed codes', async () => {
  const gate = deferred(),
    handlers = new Map();
  let accessed = 0;
  registerNaiAuth(
    { handle: (n, f) => handlers.set(n, f) },
    {
      set: () => {
        accessed++;
        return gate.promise;
      },
    },
    () => false,
    () => true,
  );
  let settled = false;
  const request = handlers
    .get('nai-auth-set')({}, 'synthetic', true)
    .then((x) => {
      settled = true;
      return x;
    });
  await new Promise(setImmediate);
  assert.equal(settled, false);
  assert.equal(accessed, 1);
  gate.reject(Error('sensitive-provider-detail'));
  assert.deepEqual(await request, { ok: false, code: 'STORE_UNREADABLE' });
});

for (const remember of [false, true]) {
  test(`failed replacement does not fail a concurrent read of preserved ${remember ? 'encrypted' : 'session'} token`, async (t) => {
    const f = fixture(t),
      store = f.create(),
      started = deferred(),
      gate = deferred();
    await store.set('synthetic-preserved-A', remember);
    const before = remember ? fs.readFileSync(f.file) : undefined;
    f.encryption.encryptStringAsync = async () => {
      started.resolve();
      await gate.promise;
      throw Error('synthetic-provider-detail');
    };
    const write = assert.rejects(store.set('synthetic-rejected-B', true), {
      code: 'STORE_WRITE_FAILED',
    });
    await started.promise;
    const read = store.read();
    gate.resolve();
    await write;
    assert.equal(await read, 'synthetic-preserved-A');
    if (remember) assert.deepEqual(fs.readFileSync(f.file), before);
    else assert.equal(fs.existsSync(f.file), false);
  });
}

test('failed initial save leaves a concurrent read with TOKEN_MISSING rather than the setter error', async (t) => {
  const f = fixture(t),
    store = f.create(),
    started = deferred(),
    gate = deferred();
  f.encryption.encryptStringAsync = async () => {
    started.resolve();
    await gate.promise;
    throw Error('synthetic-provider-detail');
  };
  const write = assert.rejects(store.set('synthetic-rejected', true), {
    code: 'STORE_WRITE_FAILED',
  });
  await started.promise;
  const read = assert.rejects(store.read(), { code: 'TOKEN_MISSING' });
  gate.resolve();
  await Promise.all([write, read]);
  assert.equal(fs.existsSync(f.file), false);
});

for (const action of ['clear', 'lock', 'replace']) {
  test(`read waiting for a failed replacement still cancels after ${action}`, async (t) => {
    const f = fixture(t),
      store = f.create(),
      started = deferred(),
      gate = deferred();
    await store.set('synthetic-preserved-A', false);
    f.encryption.encryptStringAsync = async () => {
      started.resolve();
      await gate.promise;
      throw Error('synthetic-provider-detail');
    };
    const write = assert.rejects(store.set('synthetic-rejected-B', true), {
      code: 'CANCELLED',
    });
    await started.promise;
    const read = assert.rejects(store.read(), { code: 'CANCELLED' });
    if (action === 'clear') await store.clear();
    else if (action === 'lock') store.lock();
    else await store.set('synthetic-current-C', false);
    gate.resolve();
    await Promise.all([write, read]);
    if (action === 'replace')
      assert.equal(await store.read(), 'synthetic-current-C');
    else await assert.rejects(store.read(), { code: 'TOKEN_MISSING' });
    assert.equal(fs.existsSync(f.file), false);
  });
}

for (const [bytes, code] of [
  ['{"version":999}', 'STORE_VERSION'],
  ['invalid-json', 'STORE_UNREADABLE'],
]) {
  test(`read after failed replacement still rejects changed ${code} envelope`, async (t) => {
    const f = fixture(t),
      store = f.create(),
      started = deferred(),
      gate = deferred();
    await store.set('synthetic-preserved-A', true);
    f.encryption.encryptStringAsync = async () => {
      started.resolve();
      await gate.promise;
      throw Error('synthetic-provider-detail');
    };
    const write = assert.rejects(store.set('synthetic-rejected-B', true), {
      code: 'STORE_WRITE_FAILED',
    });
    await started.promise;
    const read = assert.rejects(store.read(), { code });
    fs.writeFileSync(f.file, bytes);
    gate.resolve();
    await Promise.all([write, read]);
    assert.equal(fs.readFileSync(f.file, 'utf8'), bytes);
  });
}
