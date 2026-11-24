// Test-only entry: disposable OS profile, synthetic token, no renderer or API request.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app, session, safeStorage } = require('electron');
const root = process.env.SDSTUDIO_ASYNC_STORAGE_TEST_ROOT;
const phase = process.env.SDSTUDIO_ASYNC_STORAGE_TEST_PHASE;
if (!root || !path.isAbsolute(root) || !['write', 'read'].includes(phase))
  throw Error('Requires a disposable test profile and write/read phase');
app.setName('sdstudio-async-storage-test');
for (const [name, relative] of [
  ['userData', 'profile'],
  ['sessionData', 'profile/chromium'],
  ['crashDumps', 'crash-dumps'],
]) {
  const directory = path.join(root, relative);
  fs.mkdirSync(directory, { recursive: true });
  app.setPath(name, directory);
}
app.setAppLogsPath(path.join(root, 'logs'));
const report = {
  phase,
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  syntheticOnly: true,
  networkAttempts: 0,
};
let stage = 'startup',
  done = false;
function finish(code) {
  if (done) return;
  done = true;
  report.ok = code === 0;
  if (code) report.code = 'ASYNC_STORAGE_PROBE_FAILED';
  report.stage = stage;
  fs.writeFileSync(
    path.join(root, `${phase}-report.json`),
    JSON.stringify(report, null, 2),
    { flag: 'wx', mode: 0o600 },
  );
  if (code === 0) app.quit();
  else app.exit(code);
}
setTimeout(() => finish(1), 25000).unref();
process.on('uncaughtException', () => finish(1));
process.on('unhandledRejection', () => finish(1));
app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => {
        report.networkAttempts++;
        callback({ cancel: true });
      },
    );
    require('ts-node/register/transpile-only');
    const { NaiTokenStore } = require('../../src/main/nai/tokenStore');
    const file = path.join(root, 'profile/auth/novelai-token.v1.json');
    stage = 'api-and-provider';
    for (const method of [
      'isAsyncEncryptionAvailable',
      'encryptStringAsync',
      'decryptStringAsync',
    ])
      assert.equal(typeof safeStorage[method], 'function');
    report.asyncMethodsPresent = true;
    const backend =
      process.platform === 'linux'
        ? safeStorage.getSelectedStorageBackend()
        : process.platform;
    report.backend = [
      'gnome_libsecret',
      'kwallet',
      'kwallet5',
      'kwallet6',
      'basic_text',
      'unknown',
      'win32',
      'darwin',
    ].includes(backend)
      ? backend
      : 'other';
    const allowed =
      process.platform !== 'linux' ||
      ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend);
    if (!allowed) {
      assert.equal(fs.existsSync(file), false);
      report.result = 'insecure-provider-not-tested';
      report.availabilityQueried = false;
      stage = 'complete';
      return finish(0);
    }
    stage = 'async-availability';
    report.availabilityQueried = true;
    report.asyncAvailable = await safeStorage.isAsyncEncryptionAvailable();
    assert.equal(report.asyncAvailable, true);
    if (phase === 'write') {
      stage = 'legacy-producer';
      // Frozen legacy producer, independent of the future async production writer.
      assert.equal(typeof safeStorage.encryptString, 'function');
      const legacyCiphertext = safeStorage.encryptString(
        'synthetic-async-storage-token',
      );
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(
        file,
        JSON.stringify({
          format: 'sdstudio-nai-token',
          version: 1,
          ciphertext: legacyCiphertext.toString('base64'),
        }),
        { flag: 'wx', mode: 0o600 },
      );
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.includes('synthetic-async-storage-token'), false);
      report.result = 'legacy-v1-written';
    } else {
      stage = 'legacy-read-after-restart';
      const before = fs.readFileSync(file);
      const saved = JSON.parse(before);
      assert.equal(saved.version, 1);
      assert.equal(saved.format, 'sdstudio-nai-token');
      const legacy = await safeStorage.decryptStringAsync(
        Buffer.from(saved.ciphertext, 'base64'),
      );
      assert.equal(legacy.result, 'synthetic-async-storage-token');
      assert.equal(typeof legacy.shouldReEncrypt, 'boolean');
      report.legacyReadableAfterRestart = true;
      report.rotationRequested = legacy.shouldReEncrypt;
      stage = 'async-roundtrip';
      const input = 'synthetic-async-storage-roundtrip';
      const ciphertext = await safeStorage.encryptStringAsync(input);
      assert.ok(Buffer.isBuffer(ciphertext));
      assert.equal(ciphertext.includes(input), false);
      const result = await safeStorage.decryptStringAsync(ciphertext);
      assert.equal(result.result, input);
      assert.equal(typeof result.shouldReEncrypt, 'boolean');
      report.asyncRoundTrip = true;
      // Reading and a rotation hint must not silently replace the old v1 file.
      assert.deepEqual(fs.readFileSync(file), before);
      report.legacyFileUnchanged = true;
      report.result = 'legacy-and-async-compatible';
    }
    assert.equal(report.networkAttempts, 0);
    stage = 'complete';
    finish(0);
  })
  .catch(() => finish(1));
