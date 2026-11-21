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
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (s) => {
      if (failEncryption) throw Error('synthetic sensitive provider detail');
      const iv = crypto.randomBytes(12),
        cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), data]);
    },
    decryptString: (data) => {
      decryptions++;
      const cipher = crypto.createDecipheriv(
        'aes-256-gcm',
        key,
        data.subarray(0, 12),
      );
      cipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final(),
      ]).toString();
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

test('ciphertext survives restart, status never decrypts, file is private, legacy TOKEN untouched', (t) => {
  const f = fixture(t),
    old = path.join(f.root, 'TOKEN.txt');
  fs.writeFileSync(old, 'synthetic-legacy');
  const before = fs.statSync(old).mtimeMs;
  const a = f.create();
  assert.equal(a.status().configured, false);
  assert.equal(fs.existsSync(path.dirname(f.file)), false);
  a.set('synthetic-persistent-token', true);
  assert.equal(
    fs.readFileSync(f.file, 'utf8').includes('synthetic-persistent-token'),
    false,
  );
  assert.equal(f.create().status().storage, 'encrypted');
  assert.equal(f.decryptions(), 0);
  assert.equal(f.create().read(), 'synthetic-persistent-token');
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(old, 'utf8'), 'synthetic-legacy');
  assert.equal(fs.statSync(old).mtimeMs, before);
});

test('basic_text and missing secure storage refuse persistence; session mode has no file and no resurrection', (t) => {
  const f = fixture(t),
    a = f.create();
  a.set('synthetic-old', true);
  f.basic();
  assert.throws(() => a.set('synthetic-new', true), {
    code: 'SECURE_STORAGE_UNAVAILABLE',
  });
  assert.throws(() => f.create().read(), {
    code: 'SECURE_STORAGE_UNAVAILABLE',
  });
  assert.equal(a.set('synthetic-memory', false).storage, 'session');
  assert.equal(fs.existsSync(f.file), false);
  assert.equal(a.read(), 'synthetic-memory');
  a.lock();
  assert.throws(() => a.read(), { code: 'TOKEN_MISSING' });
  f.encryption.isEncryptionAvailable = () => false;
  assert.equal(a.status().secureStorageAvailable, false);
  assert.throws(() => a.set('synthetic', true), {
    code: 'SECURE_STORAGE_UNAVAILABLE',
  });
});

test('failed replacement preserves old ciphertext and memory, leaves no temp file or raw error', (t) => {
  const f = fixture(t),
    a = f.create();
  a.set('synthetic-old', true);
  const bytes = fs.readFileSync(f.file);
  f.fail();
  assert.throws(() => a.set('synthetic-new', true), {
    message: 'STORE_WRITE_FAILED',
  });
  assert.deepEqual(fs.readFileSync(f.file), bytes);
  assert.equal(a.read(), 'synthetic-old');
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), [
    path.basename(f.file),
  ]);
  a.set('synthetic-session', false);
  assert.throws(() => a.set('synthetic-persist', true), {
    code: 'STORE_WRITE_FAILED',
  });
  assert.equal(a.read(), 'synthetic-session');
});

test('corrupt, future-version and undecryptable files are preserved until explicit clear', (t) => {
  const f = fixture(t),
    a = f.create();
  fs.mkdirSync(path.dirname(f.file));
  for (const [text, code] of [
    ['{invalid', 'STORE_UNREADABLE'],
    ['{"version":2}', 'STORE_VERSION'],
  ]) {
    fs.writeFileSync(f.file, text);
    assert.throws(() => a.read(), { code });
    assert.throws(() => a.set('synthetic-new', true), { code });
    assert.equal(fs.readFileSync(f.file, 'utf8'), text);
  }
  fs.rmSync(f.file);
  a.set('synthetic-old', true);
  const envelope = JSON.parse(fs.readFileSync(f.file));
  envelope.ciphertext = Buffer.from('invalid cryptographic payload').toString(
    'base64',
  );
  fs.writeFileSync(f.file, JSON.stringify(envelope));
  const bytes = fs.readFileSync(f.file);
  assert.throws(() => a.read(), { code: 'STORE_UNREADABLE' });
  assert.deepEqual(fs.readFileSync(f.file), bytes);
  assert.equal(a.clear().configured, false);
});

test('invalid token/remember values cannot replace a token or become a header', (t) => {
  const f = fixture(t),
    a = f.create();
  a.set('synthetic-old', false);
  for (const token of [
    '',
    null,
    {},
    'has spaces',
    'line\r\ninjected',
    'x'.repeat(4097),
  ])
    assert.throws(() => a.set(token, false), { code: 'INVALID_INPUT' });
  assert.throws(() => a.set('synthetic-new', 'true'), {
    code: 'INVALID_INPUT',
  });
  assert.equal(a.read(), 'synthetic-old');
});

test('IPC refuses offline and foreign frames before store access; replies have no secret or raw exception', () => {
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
    clear: () => {
      accesses++;
      return store.status();
    },
  };
  registerNaiAuth(
    { handle: (name, fn) => handlers.set(name, fn) },
    store,
    () => offline,
    () => trusted,
  );
  for (const fn of handlers.values())
    assert.deepEqual(fn({}, 'synthetic-secret', true), {
      ok: false,
      code: 'UNTRUSTED_SENDER',
    });
  trusted = true;
  for (const fn of handlers.values())
    assert.deepEqual(fn({}, 'synthetic-secret', true), {
      ok: false,
      code: 'OFFLINE',
    });
  assert.equal(accesses, 0);
  offline = false;
  assert.equal(handlers.get('nai-auth-status')({}).ok, true);
  const response = handlers.get('nai-auth-set')({}, 'synthetic-secret', true);
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
