const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const { LiveValidation } = require('../main/nai/liveValidation');
const { NaiError } = require('../main/nai/errors');
const { png } = require('./fixtures/nai/png.cjs');
const candidate = require('../../.erb/fixtures/nai-live-candidate.json');
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-live-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let sends = 0;
  const runner = new LiveValidation({
    profile: root,
    request: candidate.request,
    ready: () => {},
    transport: (capture) => ({
      send: async () => {
        sends++;
        const bytes = Buffer.from('synthetic invalid zip');
        capture(bytes);
        return bytes;
      },
    }),
    ...options,
  });
  const evidence = {
    requestHash: runner.requestHash,
    beforeBalance: 100,
    displayedCost: 5,
    sameSettings: true,
    capture: true,
    candidateAcknowledged: true,
  };
  return { root, runner, evidence, sends: () => sends };
}
test('cost/capture/settings/hash gates refuse before consuming an attempt or sending', async (t) => {
  const f = fixture(t);
  for (const [patch, code] of [
    [{ displayedCost: 11 }, 'COST_LIMIT'],
    [{ beforeBalance: 4 }, 'BALANCE_LOW'],
    [{ displayedCost: undefined }, 'COST_EVIDENCE_REQUIRED'],
    [{ beforeBalance: -1 }, 'COST_EVIDENCE_REQUIRED'],
    [{ displayedCost: NaN }, 'COST_EVIDENCE_REQUIRED'],
    [{ sameSettings: false }, 'COST_EVIDENCE_REQUIRED'],
    [{ candidateAcknowledged: false }, 'COST_EVIDENCE_REQUIRED'],
    [{ capture: false }, 'CAPTURE_REQUIRED'],
    [{ requestHash: 'wrong' }, 'REQUEST_CHANGED'],
  ]) {
    await assert.rejects(f.runner.run({ ...f.evidence, ...patch }), { code });
  }
  assert.equal(f.sends(), 0);
  assert.equal(f.runner.status().used, false);
  assert.deepEqual(fs.readdirSync(f.runner.directory), []);
});
test('failed ZIP is preserved privately before decode and replays with the same reason', async (t) => {
  const f = fixture(t),
    result = await f.runner.run(f.evidence);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'zip-eocd');
  assert.equal(result.mayHaveReachedServer, true);
  assert.equal(result.responseCaptured, true);
  assert.equal(f.sends(), 1);
  const file = path.join(f.runner.directory, 'response.zip');
  assert.equal(fs.readFileSync(file, 'utf8'), 'synthetic invalid zip');
  if (process.platform !== 'win32')
    for (const name of ['attempt.json', 'response.zip', 'result.json'])
      assert.equal(
        fs.statSync(path.join(f.runner.directory, name)).mode & 0o777,
        0o600,
      );
  const inspect = spawnSync(
    process.execPath,
    [path.resolve('.erb/scripts/inspect-nai-response.cjs'), file],
    { encoding: 'utf8' },
  );
  assert.equal(inspect.status, 1);
  assert.equal(JSON.parse(inspect.stdout).reason, result.reason);
  await assert.rejects(f.runner.run(f.evidence), { code: 'ALREADY_USED' });
  assert.equal(f.sends(), 1);
  const reopened = new LiveValidation({
    profile: f.root,
    request: candidate.request,
    ready: () => assert.fail(),
    transport: () => assert.fail(),
  });
  await assert.rejects(reopened.run(f.evidence), { code: 'ALREADY_USED' });
  assert.deepEqual(fs.readFileSync(file), Buffer.from('synthetic invalid zip'));
});
test('concurrent runs and a second process/controller cannot send twice', async (t) => {
  let release,
    sends = 0;
  const f = fixture(t, {
    transport: () => ({
      send: () => {
        sends++;
        return new Promise((resolve) => (release = resolve));
      },
    }),
  });
  const task = f.runner.run(f.evidence);
  assert.equal(f.runner.status().canRecordBalance, false);
  assert.throws(() => f.runner.recordAfterBalance(100), {
    code: 'NOT_FINISHED',
  });
  await assert.rejects(f.runner.run(f.evidence), { code: 'ALREADY_USED' });
  const other = new LiveValidation({
    profile: f.root,
    request: candidate.request,
    ready: () => {},
    transport: () => assert.fail(),
  });
  await assert.rejects(other.run(f.evidence), { code: 'ALREADY_USED' });
  release(Buffer.from('bad'));
  await task;
  assert.equal(sends, 1);
});
test('token/offline/pre-cancel errors do not consume an attempt', async (t) => {
  for (const code of ['TOKEN_MISSING', 'OFFLINE']) {
    const f = fixture(t, {
      ready: () => {
        throw new NaiError(code);
      },
    });
    await assert.rejects(f.runner.run(f.evidence), { code });
    assert.equal(f.sends(), 0);
    assert.equal(f.runner.status().used, false);
  }
  const f = fixture(t),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(f.runner.run(f.evidence, controller.signal), {
    code: 'CANCELLED',
  });
  assert.equal(f.runner.status().used, false);
});
test('valid PNG and zero displayed cost remain explicit and after-balance is recorded once', async (t) => {
  const archive = new JSZip();
  archive.file('image.png', png());
  const bytes = await archive.generateAsync({ type: 'nodebuffer' });
  const f = fixture(t, {
    transport: (capture) => ({
      send: async () => {
        capture(bytes);
        return bytes;
      },
    }),
    metadata: () => ({
      httpStatus: 200,
      contentType: 'application/zip',
      truncated: false,
    }),
  });
  const result = await f.runner.run({
    ...f.evidence,
    beforeBalance: 0,
    displayedCost: 0,
  });
  assert.equal(result.ok, true);
  assert.ok(Number.isInteger(result.elapsedMs) && result.elapsedMs >= 0);
  assert.equal(result.pngBytes, png().length);
  assert.deepEqual(
    fs.readFileSync(path.join(f.runner.directory, 'result.png')),
    png(),
  );
  assert.deepEqual(
    fs.readFileSync(path.join(f.runner.directory, 'response.zip')),
    bytes,
  );
  assert.deepEqual(f.runner.recordAfterBalance(0), { ok: true });
  const file = path.join(f.runner.directory, 'balance-after.json'),
    before = fs.readFileSync(file);
  assert.equal(JSON.parse(before).observedDifference, 0);
  assert.throws(() => f.runner.recordAfterBalance(99), {
    code: 'STORAGE_FAILED',
  });
  assert.deepEqual(fs.readFileSync(file), before);
});
test('interrupted attempt can record incomplete balance after reopening without sending or fabricating a result', async (t) => {
  const f = fixture(t);
  const file = path.join(f.runner.directory, 'attempt.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      requestHash: f.runner.requestHash,
      beforeBalance: 100,
    }),
    { mode: 0o600 },
  );
  const before = fs.readFileSync(file);
  const reopened = new LiveValidation({
    profile: f.root,
    request: candidate.request,
    ready: () => assert.fail(),
    transport: () => assert.fail(),
  });
  assert.equal(reopened.status().incomplete, true);
  assert.equal(reopened.status().canRecordBalance, true);
  await assert.rejects(reopened.run(f.evidence), { code: 'ALREADY_USED' });
  assert.deepEqual(reopened.recordAfterBalance(95), { ok: true });
  const record = path.join(reopened.directory, 'balance-after.json');
  const saved = fs.readFileSync(record);
  assert.equal(JSON.parse(saved).incomplete, true);
  assert.equal(JSON.parse(saved).resultRecord, 'missing');
  assert.equal(JSON.parse(saved).observedDifference, 5);
  assert.equal(
    fs.existsSync(path.join(reopened.directory, 'result.json')),
    false,
  );
  assert.deepEqual(fs.readFileSync(file), before);
  assert.throws(() => reopened.recordAfterBalance(90), {
    code: 'STORAGE_FAILED',
  });
  assert.deepEqual(fs.readFileSync(record), saved);
  assert.equal(f.sends(), 0);
});
test('incomplete balance recovery preserves invalid or different candidate attempt records', (t) => {
  for (const record of [
    { version: 2, requestHash: 'wrong', beforeBalance: 100 },
    { version: 1, requestHash: 'wrong', beforeBalance: 100 },
  ]) {
    const f = fixture(t);
    const file = path.join(f.runner.directory, 'attempt.json');
    fs.writeFileSync(file, JSON.stringify(record));
    const reopened = new LiveValidation({
      profile: f.root,
      request: candidate.request,
    });
    assert.throws(() => reopened.recordAfterBalance(100), {
      code: record.version === 2 ? 'STORAGE_FAILED' : 'REQUEST_CHANGED',
    });
    assert.equal(
      fs.existsSync(path.join(reopened.directory, 'balance-after.json')),
      false,
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), record);
  }
});
test('failure before a response records no complete capture; received HTTP error body stays private', async (t) => {
  const f = fixture(t, {
    transport: () => ({
      send: async () => {
        throw new NaiError('TIMEOUT', true);
      },
    }),
  });
  const timed = await f.runner.run(f.evidence);
  assert.equal(timed.responseCaptured, false);
  assert.equal(timed.mayHaveReachedServer, true);
  assert.equal(
    fs.statSync(path.join(f.runner.directory, 'response.zip')).size,
    0,
  );
  const g = fixture(t, {
    transport: (capture) => ({
      send: async () => {
        capture(Buffer.from('synthetic private server explanation'));
        throw new NaiError('HTTP_ERROR', true, 400);
      },
    }),
    metadata: () => ({ httpStatus: 400, contentType: 'application/json' }),
  });
  const result = await g.runner.run(g.evidence);
  assert.equal(result.code, 'HTTP_ERROR');
  assert.equal(result.responseCaptured, true);
  assert.equal(result.httpStatus, 400);
  assert.equal(JSON.stringify(result).includes('explanation'), false);
  assert.equal(
    fs.readFileSync(path.join(g.runner.directory, 'response.zip'), 'utf8'),
    'synthetic private server explanation',
  );
});
test('private storage refuses symlink/unsafe directory and does not overwrite existing capture', async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.runner.directory, 'response.zip'), 'protected');
  await assert.rejects(f.runner.run(f.evidence), { code: 'STORAGE_FAILED' });
  assert.equal(f.sends(), 0);
  assert.equal(
    fs.readFileSync(path.join(f.runner.directory, 'response.zip'), 'utf8'),
    'protected',
  );
  if (process.platform !== 'win32') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-live-mode-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = path.join(root, 'target');
    fs.mkdirSync(target, { mode: 0o700 });
    fs.symlinkSync(target, path.join(root, 'live-validation'));
    assert.throws(
      () => new LiveValidation({ profile: root, request: candidate.request }),
      { code: 'STORAGE_FAILED' },
    );
    fs.unlinkSync(path.join(root, 'live-validation'));
    fs.mkdirSync(path.join(root, 'live-validation'), { mode: 0o755 });
    assert.throws(
      () => new LiveValidation({ profile: root, request: candidate.request }),
      { code: 'STORAGE_FAILED' },
    );
  }
});
test('production renderer/preload cannot read internal image response diagnostics', () => {
  const roots = [
    path.resolve('src/renderer'),
    path.resolve('src/main/preload.ts'),
  ];
  const visit = (file) => {
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file)) visit(path.join(file, name));
    } else if (/\.(tsx?|jsx?)$/.test(file))
      assert.doesNotMatch(
        fs.readFileSync(file, 'utf8'),
        /imageResponseReason|responseReasons/,
        path.relative(process.cwd(), file),
      );
  };
  roots.forEach(visit);
});

test('unexpected synchronous post-response failure always clears active state and preserves the consumed attempt', async (t) => {
  const f = fixture(t, {
    metadata: () => ({
      get mediaTypeState() {
        throw Error('synthetic private failure');
      },
    }),
  });
  await assert.rejects(f.runner.run(f.evidence), /synthetic private failure/);
  assert.equal(f.runner.status().canRecordBalance, true);
  assert.equal(f.runner.status().incomplete, true);
  await assert.rejects(f.runner.run(f.evidence), { code: 'ALREADY_USED' });
  assert.deepEqual(f.runner.recordAfterBalance(100), { ok: true });
  assert.equal(f.sends(), 1);
});
test('persisted MIME diagnostics are sanitized again at the private result boundary', async (t) => {
  for (const value of [
    'application/x-synthetic; token=private',
    'bad\r\nprivate',
  ]) {
    const f = fixture(t, {
      metadata: () => ({ mediaTypeState: 'present', mediaType: value }),
    });
    const result = await f.runner.run(f.evidence);
    assert.equal(
      result.mediaTypeState,
      value.startsWith('application') ? 'present' : 'invalid',
    );
    assert.ok(!JSON.stringify(result).includes('private'));
    if (value.startsWith('application'))
      assert.equal(result.mediaType, 'application/x-synthetic');
  }
});
