const assert = require('node:assert/strict'),
  { test } = require('node:test');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const {
  NetworkModeSettings,
  registerNetworkMode,
} = require('../main/networkMode');
const {
  prepareRestart,
  restartFailureMessage,
} = require('../renderer/network/restartPreparation');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-network-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'network-mode.v1.json');
  return {
    root,
    file,
    create: (env = {}, explicit = false) =>
      new NetworkModeSettings(file, explicit, env),
  };
}
test('normal first run is online without writing; saved choices apply only to a fresh process', (t) => {
  const f = fixture(t),
    first = f.create();
  assert.deepEqual(first.status(), {
    current: 'online',
    next: 'online',
    pendingRestart: false,
  });
  assert.equal(fs.existsSync(f.file), false);
  assert.deepEqual(first.set('offline'), {
    current: 'online',
    next: 'offline',
    pendingRestart: true,
  });
  const second = f.create();
  assert.equal(second.current, 'offline');
  assert.equal(second.set('online').current, 'offline');
  assert.equal(f.create().current, 'online');
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
});
test('mock, environment and explicit development overrides cannot be defeated by saved online mode', (t) => {
  const f = fixture(t);
  f.create().set('online');
  const before = fs.readFileSync(f.file);
  for (const [env, explicit, current, reason] of [
    [
      { SDSTUDIO_MOCK_BACKEND: '1', SDSTUDIO_OFFLINE: '0' },
      false,
      'offline',
      'mock',
    ],
    [{ SDSTUDIO_OFFLINE: '1' }, false, 'offline', 'environment'],
    [{ SDSTUDIO_OFFLINE: 'invalid' }, false, 'offline', 'environment'],
    [{ SDSTUDIO_OFFLINE: '0' }, true, 'online', 'environment'],
    [{}, true, 'offline', 'development'],
  ]) {
    const s = f.create(env, explicit);
    assert.equal(s.current, current);
    assert.equal(s.status().lockedReason, reason);
    for (const fn of [
      () => s.set('online'),
      () => s.reset(),
      () => s.restart(() => assert.fail()),
    ])
      assert.throws(fn, { code: 'MODE_LOCKED' });
  }
  assert.deepEqual(fs.readFileSync(f.file), before);
});
test('malformed/future/oversized preferences fail closed and remain until explicit settings-only reset', (t) => {
  const f = fixture(t);
  const token = path.join(f.root, 'TOKEN.txt');
  fs.writeFileSync(token, 'synthetic-protected');
  const mtime = fs.statSync(token).mtimeMs;
  for (const text of [
    'null',
    '{bad',
    JSON.stringify({ version: 2, mode: 'online' }),
    JSON.stringify({ version: 1, mode: 'online', unknown: 'keep' }),
    'x'.repeat(2049),
  ]) {
    fs.writeFileSync(f.file, text);
    const s = f.create();
    assert.equal(s.current, 'offline');
    assert.ok(s.status().issue);
    assert.throws(() => s.set('online'));
    assert.throws(() => s.restart(() => assert.fail()));
    assert.equal(fs.readFileSync(f.file, 'utf8'), text);
    s.reset();
    assert.equal(fs.existsSync(f.file), false);
  }
  assert.equal(fs.readFileSync(token, 'utf8'), 'synthetic-protected');
  assert.equal(fs.statSync(token).mtimeMs, mtime);
});
test('failed atomic replacement preserves previous file and removes temporary file without raw error details', (t) => {
  const f = fixture(t),
    s = f.create();
  s.set('offline');
  const before = fs.readFileSync(f.file);
  t.mock.method(fs, 'renameSync', () => {
    throw Error('SENSITIVE synthetic filesystem detail');
  });
  assert.throws(() => s.set('online'), {
    code: 'SETTINGS_WRITE_FAILED',
    message: 'SETTINGS_WRITE_FAILED',
  });
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.deepEqual(fs.readdirSync(f.root), [path.basename(f.file)]);
});
test('invalid mode data is not persisted', (t) => {
  const f = fixture(t),
    s = f.create();
  for (const v of [null, {}, true, 'ONLINE', 'https://example.invalid'])
    assert.throws(() => s.set(v), { code: 'INVALID_MODE' });
  assert.equal(fs.existsSync(f.file), false);
});
test('restart requires a valid pending change and schedules only once; synchronous failure permits retry', (t) => {
  const f = fixture(t),
    s = f.create();
  let called = 0;
  assert.throws(() => s.restart(() => called++), {
    code: 'NO_RESTART_REQUIRED',
  });
  s.set('offline');
  assert.throws(
    () =>
      s.restart(() => {
        throw Error('raw');
      }),
    { code: 'RESTART_FAILED' },
  );
  assert.equal(s.restarting, false);
  s.restart(() => called++);
  assert.equal(called, 1);
  assert.equal(s.restarting, true);
  assert.throws(() => s.restart(() => called++), { code: 'RESTARTING' });
  assert.throws(() => s.set('offline'), { code: 'RESTARTING' });
  assert.equal(called, 1);
});
test('a later corrupt file cannot pass the restart gate', (t) => {
  const f = fixture(t),
    s = f.create();
  s.set('online');
  fs.writeFileSync(f.file, '{"version":2}');
  assert.throws(() => s.restart(() => assert.fail()), {
    code: 'SETTINGS_VERSION',
  });
  assert.equal(s.restarting, false);
});
test('startup IPC rejects foreign senders but supports offline local configuration without secrets', (t) => {
  const f = fixture(t),
    s = (f.create().set('offline'), f.create()),
    handlers = new Map();
  let trusted = false,
    restarts = 0;
  registerNetworkMode(
    { handle: (n, fn) => handlers.set(n, fn) },
    s,
    () => trusted,
    () => restarts++,
  );
  for (const fn of handlers.values())
    assert.deepEqual(fn({}, 'online'), { ok: false, code: 'UNTRUSTED_SENDER' });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), {
    version: 1,
    mode: 'offline',
  });
  trusted = true;
  assert.equal(
    handlers.get('network-mode-set')({}, 'online').status.current,
    'offline',
  );
  assert.equal(handlers.get('network-mode-restart')({}).ok, true);
  assert.equal(restarts, 1);
  assert.equal(handlers.has('network-mode-get-token'), false);
});
test('restart preparation waits for save and rechecks pending work', async () => {
  let busy = 'LEGACY_RUNNING',
    saves = 0;
  assert.equal(
    await prepareRestart(
      () => busy,
      async () => saves++,
    ),
    'LEGACY_RUNNING',
  );
  assert.equal(saves, 0);
  busy = undefined;
  assert.equal(
    await prepareRestart(
      () => busy,
      async () => {
        throw Error('raw');
      },
    ),
    'SAVE_FAILED',
  );
  assert.equal(
    await prepareRestart(
      () => busy,
      async () => {
        saves++;
        busy = 'WORKSPACE_PENDING';
      },
    ),
    'WORKSPACE_PENDING',
  );
  busy = undefined;
  assert.equal(
    await prepareRestart(
      () => busy,
      async () => saves++,
    ),
    undefined,
  );
  assert.equal(saves, 2);
});

test('restart guidance distinguishes legacy run completion from both pending queues', () => {
  assert.match(restartFailureMessage('LEGACY_RUNNING'), /0이어도/);
  assert.match(restartFailureMessage('LEGACY_PENDING'), /기존 V3/);
  assert.match(restartFailureMessage('WORKSPACE_PENDING'), /새 작업실/);
});
