const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const webpack = require('webpack');
const BundleLicensePlugin = require('../../.erb/scripts/bundle-license-plugin.cjs');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-notice-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, text) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  const lock = '{"packages":{}}\n';
  put('package-lock.json', lock);
  put(
    'LICENSES/electron-react-boilerplate.txt',
    fs.readFileSync(
      path.resolve(__dirname, '../../LICENSES/electron-react-boilerplate.txt'),
    ),
  );
  put('CREDITS.md', 'Synthetic credits.\n');
  put('entry.js', 'import {value} from "foo"; console.log(value);');
  for (const name of ['foo', 'bar', 'unused']) {
    put(
      `node_modules/${name}/package.json`,
      JSON.stringify({
        name,
        version: '1.0.0',
        type: 'module',
        license: 'MIT',
        main: 'index.js',
      }),
    );
    put(
      `node_modules/${name}/LICENSE`,
      Buffer.from(`Notice for ${name}\r\nKeep original bytes.\r\n`),
    );
  }
  put(
    'node_modules/foo/index.js',
    'import {value as other} from "bar"; export const value=other+1;',
  );
  put('node_modules/bar/index.js', 'export const value=2;');
  put('node_modules/unused/index.js', 'throw Error("never included");');
  put(
    'release/app/node_modules/missing/package.json',
    JSON.stringify({ name: 'missing', version: '1.0.0', license: 'ISC' }),
  );
  put(
    'release/app/node_modules/readme-only/package.json',
    JSON.stringify({ name: 'readme-only', version: '1.0.0', license: 'MIT' }),
  );
  put(
    'release/app/node_modules/readme-only/README.md',
    fs.readFileSync(
      path.resolve(__dirname, '../../LICENSES/electron-react-boilerplate.txt'),
    ),
  );
  put(
    '.erb/scripts/notice-package-identity.cjs',
    fs.readFileSync(
      path.resolve(__dirname, '../../.erb/scripts/notice-package-identity.cjs'),
    ),
  );
  put(
    'release/app/node_modules/missing/types/embedded/package.json',
    JSON.stringify({ name: 'embedded', version: '1.0.0', license: 'MIT' }),
  );
  put(
    'release/app/node_modules/missing/types/embedded/LICENSE',
    fs.readFileSync(
      path.resolve(__dirname, '../../LICENSES/electron-react-boilerplate.txt'),
    ),
  );
  put(
    'docs/licenses/APP_LICENSE_STATUS.md',
    'Fixture scope: unresolved native-style notice.\n',
  );
  put(
    '.erb/scripts/collect-bundle-notices.cjs',
    fs.readFileSync(
      path.resolve(__dirname, '../../.erb/scripts/collect-bundle-notices.cjs'),
    ),
  );
  const output = path.join(root, 'release/app/dist/renderer');
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      context: root,
      mode: 'production',
      target: 'node',
      entry: './entry.js',
      output: { path: output, filename: 'renderer.js' },
      optimization: { concatenateModules: true },
      plugins: [new BundleLicensePlugin('renderer')],
    });
    compiler.run((error, stats) =>
      compiler.close(() => {
        if (error) reject(error);
        else if (stats.hasErrors())
          reject(new Error(stats.toString('errors-only')));
        else resolve();
      }),
    );
  });
  put(
    'release/app/dist/main/bundle-licenses.json',
    JSON.stringify({
      formatVersion: 1,
      compiler: 'fixture-main',
      assets: [],
      packages: [],
      lockSha256: hash(lock),
    }),
  );
  const run = () =>
    spawnSync(process.execPath, ['.erb/scripts/collect-bundle-notices.cjs'], {
      cwd: root,
      encoding: 'utf8',
    });
  return { root, put, run, output };
}

test('actual compilation includes concatenated dependencies, excludes unused packages, and preserves notice bytes', async (t) => {
  const { root, run, output } = await fixture(t);
  const graph = JSON.parse(
    fs.readFileSync(path.join(output, 'bundle-licenses.json')),
  );
  assert.deepEqual(graph.packages.map((p) => p.name).sort(), ['bar', 'foo']);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const folder = path.join(root, '.erb/generated/notices');
  const index = JSON.parse(fs.readFileSync(path.join(folder, 'index.json')));
  assert.deepEqual(
    index.unresolved.map((p) => p.name),
    ['missing'],
  );
  for (const item of index.packages.filter((p) => p.notices.length))
    for (const notice of item.notices) {
      const original = fs.readFileSync(path.join(root, notice.source));
      assert.deepEqual(
        fs.readFileSync(path.join(folder, notice.copy)),
        original,
      );
      assert.equal(hash(original), notice.sha256);
    }
  assert.equal(
    index.packages.find((p) => p.name === 'readme-only').notices[0].basis,
    'readme-with-MIT-grant-text',
  );
  assert.ok(
    index.packages
      .find((p) => p.name === 'embedded')
      .origins.includes('embedded-runtime-metadata'),
  );
  const first = fs.readFileSync(path.join(folder, 'index.json'));
  assert.equal(run().status, 0);
  assert.deepEqual(fs.readFileSync(path.join(folder, 'index.json')), first);
});

test('a changed bundle is rejected before replacing an existing notice collection', async (t) => {
  const { root, run, output } = await fixture(t);
  assert.equal(run().status, 0);
  const index = path.join(root, '.erb/generated/notices/index.json');
  const before = fs.readFileSync(index);
  fs.appendFileSync(
    path.join(output, 'renderer.js'),
    '\n// changed after build\n',
  );
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Bundle changed/);
  assert.deepEqual(fs.readFileSync(index), before);
});

test('a changed dependency package is rejected instead of using mismatched notices', async (t) => {
  const { put, run } = await fixture(t);
  put(
    'node_modules/foo/package.json',
    JSON.stringify({ name: 'foo', version: '2.0.0', license: 'MIT' }),
  );
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Bundled package changed/);
});
