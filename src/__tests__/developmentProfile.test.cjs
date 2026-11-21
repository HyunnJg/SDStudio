const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  initializeDevelopmentProfile,
  storageDirectory,
} = require('../main/developmentProfile');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-profile-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appData = path.join(root, 'app-data');
  const original = path.join(appData, 'SDStudio');
  fs.mkdirSync(original, { recursive: true });
  const config = path.join(original, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ saveLocation: original }));
  fs.writeFileSync(path.join(original, 'TOKEN.txt'), 'fixture-token');
  const paths = { appData, userData: original };
  const calls = [];
  const app = {
    getName: () => 'SDStudio',
    setName: () => {},
    getPath: (name) => paths[name],
    setPath: (name, value) => {
      paths[name] = value;
      calls.push(name);
    },
    isReady: () => false,
  };
  return { root, original, config, paths, calls, app };
}

test('no override preserves legacy paths without creating or changing files', (t) => {
  const f = fixture(t);
  const before = fs.statSync(f.config).mtimeMs;
  const profile = initializeDevelopmentProfile(f.app, undefined);
  assert.equal(profile.active, false);
  assert.equal(profile.appDirectory, path.join(f.original, 'SDStudio'));
  assert.deepEqual(f.calls, []);
  assert.equal(
    storageDirectory(profile, '/custom/saved', 'old'),
    '/custom/saved',
  );
  assert.equal(storageDirectory(profile, undefined, 'old'), 'old');
  assert.equal(fs.statSync(f.config).mtimeMs, before);
});

test('isolates Electron storage and ignores a saved path pointing at original data', (t) => {
  const f = fixture(t);
  const contents = fs.readFileSync(f.config);
  const before = fs.statSync(f.config).mtimeMs;
  const selected = path.join(f.root, 'development');
  const profile = initializeDevelopmentProfile(f.app, selected);
  assert.deepEqual(f.calls, ['userData', 'sessionData', 'logs', 'crashDumps']);
  for (const name of f.calls) assert.ok(f.paths[name].startsWith(selected));
  assert.equal(
    storageDirectory(profile, f.original, f.original),
    path.join(selected, 'SDStudio'),
  );
  assert.deepEqual(fs.readFileSync(f.config), contents);
  assert.equal(fs.statSync(f.config).mtimeMs, before);
  assert.equal(
    fs.readFileSync(path.join(f.original, 'TOKEN.txt'), 'utf8'),
    'fixture-token',
  );
  assert.equal(
    fs.existsSync(path.join(selected, 'SDStudio/config.json')),
    false,
  );
});

test('rejects empty, relative, overlapping and case-only original paths', (t) => {
  const f = fixture(t);
  for (const invalid of [
    '',
    ' ',
    'relative',
    f.original,
    path.join(f.original, 'child'),
    path.dirname(f.original),
  ]) {
    assert.throws(() => initializeDevelopmentProfile(f.app, invalid));
  }
  for (const platform of ['win32', 'darwin']) {
    assert.throws(() =>
      initializeDevelopmentProfile(
        f.app,
        path.join(path.dirname(f.original), 'sdstudio'),
        platform,
      ),
    );
  }
  assert.deepEqual(f.calls, []);
});

test('rejects both existing and not-yet-created paths through a symlink to original data', (t) => {
  const f = fixture(t);
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.original, alias, 'junction');
  assert.throws(() => initializeDevelopmentProfile(f.app, alias));
  assert.throws(() =>
    initializeDevelopmentProfile(f.app, path.join(alias, 'new')),
  );
  assert.equal(fs.existsSync(path.join(f.original, 'new')), false);
});

test('fails if selected after Electron ready', (t) => {
  const f = fixture(t);
  f.app.isReady = () => true;
  assert.throws(
    () => initializeDevelopmentProfile(f.app, path.join(f.root, 'late')),
    /before Electron is ready/,
  );
  assert.deepEqual(f.calls, []);
});

test('rejects existing Chromium or app-storage symlinks escaping the development profile', (t) => {
  const f = fixture(t);
  for (const name of ['chromium', 'SDStudio']) {
    const selected = path.join(f.root, `development-${name}`);
    fs.mkdirSync(selected);
    fs.symlinkSync(f.original, path.join(selected, name), 'junction');
    assert.throws(
      () => initializeDevelopmentProfile(f.app, selected),
      /inside the selected profile/,
    );
  }
  assert.deepEqual(f.calls, []);
});

test('actual main entry selects the profile and exits before loading native modules', (t) => {
  const f = fixture(t);
  const selected = path.join(f.root, 'entry-profile');
  const script = `
    const Module = require('node:module');
    const load = Module._load;
    const paths = ${JSON.stringify(f.paths)};
    Module._load = function(name, ...args) {
      if (name === 'electron') return { app: {
        getName: () => 'SDStudio',
    setName: () => {},
        getPath: (key) => paths[key],
        setPath: (key, value) => { paths[key] = value; },
        isReady: () => false,
        exit: (code) => process.exit(code),
      }};
      if (['sharp', 'sdsnative', 'electron-log'].includes(name)) throw new Error('Loaded before profile check exited: ' + name);
      return load.call(this, name, ...args);
    };
    require('ts-node/register/transpile-only');
    require('./src/main/main.ts');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      SDSTUDIO_USER_DATA_DIR: selected,
      SDSTUDIO_PROFILE_CHECK: '1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"checkOnly":true/);
  const line = result.stdout
    .split('\n')
    .find((value) => value.startsWith('[SDStudio profile] '));
  const report = JSON.parse(line.slice('[SDStudio profile] '.length));
  assert.equal(
    report.appDirectory,
    path.join(fs.realpathSync(selected), 'SDStudio'),
  );
  assert.equal(fs.existsSync(path.join(selected, 'SDStudio')), false);
  assert.equal(
    fs.readFileSync(path.join(f.original, 'TOKEN.txt'), 'utf8'),
    'fixture-token',
  );
});

test('isolated mode does not ask Electron for userData before the override', (t) => {
  const f = fixture(t);
  const getPath = f.app.getPath;
  f.app.getPath = (name) => {
    assert.notEqual(name, 'userData');
    return getPath(name);
  };
  initializeDevelopmentProfile(f.app, path.join(f.root, 'clean'));
});

test('a missing filesystem root fails without unbounded recursion', (t) => {
  const f = fixture(t);
  t.mock.method(fs, 'realpathSync', () => {
    throw Object.assign(new Error('missing volume'), { code: 'ENOENT' });
  });
  assert.throws(
    () => initializeDevelopmentProfile(f.app, path.join(f.root, 'missing')),
    /filesystem root/,
  );
  assert.deepEqual(f.calls, []);
});

test('profile runner keeps flags separate from an omitted directory', () => {
  const {
    parseArguments,
    extraElectronArgs,
  } = require('../../.erb/scripts/isolated-profile.cjs');
  assert.deepEqual(parseArguments(['check', '--ozone-platform=headless']), {
    mode: 'check',
    directory: undefined,
    electronArgs: ['--ozone-platform=headless'],
  });
  assert.deepEqual(parseArguments(['check', '/tmp/profile', '--disable-gpu']), {
    mode: 'check',
    directory: '/tmp/profile',
    electronArgs: ['--disable-gpu'],
  });
  assert.deepEqual(extraElectronArgs('["--no-sandbox"]'), ['--no-sandbox']);
  assert.throws(() => extraElectronArgs('{"flag":true}'), /JSON array/);
});

test('start runner without npm fails with a clear message', () => {
  const env = { ...process.env };
  delete env.npm_execpath;
  const result = spawnSync(
    process.execPath,
    ['.erb/scripts/isolated-profile.cjs', 'start'],
    { cwd: path.resolve(__dirname, '../..'), env, encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /npm_execpath/);
});

test('isolated runner forwards offline defaults and permits an explicit online opt-in', (t) => {
  const f = fixture(t);
  const entry = path.join(f.root, 'npm-fixture.cjs');
  fs.writeFileSync(entry, 'process.stdout.write(process.env.SDSTUDIO_OFFLINE)');
  for (const expected of ['1', '0']) {
    const env = { ...process.env, npm_execpath: entry };
    delete env.SDSTUDIO_OFFLINE;
    if (expected === '0') env.SDSTUDIO_OFFLINE = '0';
    const result = spawnSync(
      process.execPath,
      [
        '.erb/scripts/isolated-profile.cjs',
        'start',
        path.join(f.root, 'development'),
      ],
      { cwd: path.resolve(__dirname, '../..'), env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test('Electron mock mode without an isolated directory exits before looking up userData', () => {
  const env = { ...process.env, SDSTUDIO_MOCK_BACKEND: '1' };
  delete env.SDSTUDIO_USER_DATA_DIR;
  const script = `
    const Module = require('node:module');
    const load = Module._load;
    Module._load = function(name, ...args) {
      if (name === 'electron') return { app: {
        getPath: () => { throw new Error('Unexpected original profile lookup'); },
        exit: (code) => process.exit(code)
      }};
      return load.call(this, name, ...args);
    };
    require('ts-node/register/transpile-only');
    require('./src/main/main.ts');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.resolve(__dirname, '../..'),
    env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mock preview requires SDSTUDIO_USER_DATA_DIR/);
  assert.doesNotMatch(result.stderr, /Unexpected original profile lookup/);
});
