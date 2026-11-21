const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { initializeForkProfile } = require('../main/forkProfile');
const {
  FORK_APP_NAME,
  FORK_APP_ID,
  FORK_EXECUTABLE,
} = require('../appIdentity');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-fork-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let name = 'sdstudio';
  const paths = { appData: root };
  return {
    root,
    paths,
    app: {
      setName: (value) => {
        name = value;
      },
      getName: () => name,
      getPath: (n) => {
        assert.notEqual(n, 'userData');
        return paths[n];
      },
      setPath: (n, v) => {
        paths[n] = v;
      },
      isReady: () => false,
    },
  };
}
test('fork runtime and builder identity agree; default profile leaves upstream files unchanged', (t) => {
  const f = fixture(t);
  for (const name of ['sdstudio', 'SDStudio']) {
    fs.mkdirSync(path.join(f.root, name));
    fs.writeFileSync(
      path.join(f.root, name, 'TOKEN.txt'),
      'synthetic-original',
    );
  }
  const original = path.join(f.root, 'SDStudio', 'TOKEN.txt'),
    before = fs.statSync(original).mtimeMs;
  const selected = initializeForkProfile(f.app);
  assert.equal(f.app.getName(), FORK_APP_NAME);
  assert.equal(f.paths.userData, path.join(f.root, FORK_APP_NAME));
  assert.equal(selected.active, true);
  assert.equal(fs.readFileSync(original, 'utf8'), 'synthetic-original');
  assert.equal(fs.statSync(original).mtimeMs, before);
  const build = require('../../package.json').build;
  assert.equal(build.productName, FORK_APP_NAME);
  assert.equal(build.appId, FORK_APP_ID);
  assert.equal(build.executableName, FORK_EXECUTABLE);
  assert.equal(fs.existsSync(path.join(f.paths.userData, 'auth')), false);
});
test('explicit development directory cannot overlap either production fork or original profile', (t) => {
  const f = fixture(t);
  for (const folder of [FORK_APP_NAME, 'sdstudio', 'SDStudio'])
    assert.throws(
      () => initializeForkProfile(f.app, path.join(f.root, folder, 'child')),
      /overlap/,
    );
  const explicit = path.join(f.root, 'isolated');
  initializeForkProfile(f.app, explicit);
  assert.equal(f.paths.userData, explicit);
  assert.equal(fs.existsSync(path.join(f.root, FORK_APP_NAME)), false);
});
test('default fork profile rejects a symlink to the original data', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'SDStudio'));
  fs.symlinkSync(
    path.join(f.root, 'SDStudio'),
    path.join(f.root, FORK_APP_NAME),
  );
  assert.throws(() => initializeForkProfile(f.app), /overlap/);
});
