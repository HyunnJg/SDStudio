const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
test('launcher rejects missing/relative profiles and extra credential arguments', () => {
  for (const args of [
    [],
    ['relative'],
    [path.resolve('profile'), 'not-a-token-argument'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, 'launch.cjs'), ...args],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Usage:/);
    assert.equal(result.stdout, '');
  }
});
test('lock contains no full app native build toolchain', () => {
  const lock = require('./package-lock.json');
  assert.equal(
    lock.packages['node_modules/electron'].version,
    require('./package.json').dependencies.electron,
  );
  for (const name of Object.keys(lock.packages))
    assert.doesNotMatch(
      name,
      /node-gyp|sharp|sdsnative|electron-builder|@electron\/rebuild/,
    );
});
test(
  'real Electron starts offline without any root node_modules',
  {
    skip:
      process.platform !== 'linux' || !process.env.DISPLAY
        ? 'Requires Linux X11'
        : false,
  },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-standalone-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const checkout = path.join(root, 'checkout');
    const repository = path.resolve(__dirname, '../..');
    for (const file of [
      '.erb/scripts/nai-live-entry.cjs',
      '.erb/scripts/nai-live-preload.cjs',
      '.erb/scripts/nai-live-renderer.js',
      '.erb/scripts/nai-live-window.html',
      '.erb/fixtures/nai-live-candidate.json',
      'src/main/nai',
      'src/main/forkProfile.ts',
      'src/main/developmentProfile.ts',
      'src/appIdentity.ts',
      'tools/nai-validation/register.cjs',
      'tools/nai-validation/smoke.cjs',
    ]) {
      fs.mkdirSync(path.dirname(path.join(checkout, file)), {
        recursive: true,
      });
      fs.cpSync(path.join(repository, file), path.join(checkout, file), {
        recursive: true,
      });
    }
    const standalone = path.join(checkout, 'tools/nai-validation');
    fs.symlinkSync(
      path.join(__dirname, 'node_modules'),
      path.join(standalone, 'node_modules'),
      'dir',
    );
    const original = path.join(root, 'original');
    fs.mkdirSync(original);
    const extras = JSON.parse(process.env.SDSTUDIO_TEST_ELECTRON_ARGS || '[]');
    assert.ok(
      Array.isArray(extras) && extras.every((x) => typeof x === 'string'),
    );
    const result = spawnSync(
      require('electron'),
      [
        path.join(standalone, 'smoke.cjs'),
        path.join(root, 'profile'),
        '--ozone-platform=x11',
        '--disable-gpu',
        ...extras,
      ],
      {
        encoding: 'utf8',
        timeout: 18000,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: original,
          SDSTUDIO_LIVE_VALIDATION: '1',
          SDSTUDIO_OFFLINE: '1',
        },
      },
    );
    assert.equal(fs.existsSync(path.join(checkout, 'node_modules')), false);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /STANDALONE_OFFLINE_OK/);
  },
);
