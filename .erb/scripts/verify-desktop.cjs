// Test the installed binaries in Electron's actual Node runtime without profiles or network requests.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
async function probe() {
  const expected = require(
    path.join(root, 'node_modules/electron/package.json'),
  ).version;
  assert.equal(process.versions.electron, expected);
  const native = require(path.join(root, 'src/native'));
  const id = native.createDB('synthetic-runtime');
  try {
    native.loadDB(id, 'synthetic_cat,0,50,\nsynthetic_dog,0,30,');
    assert.ok(
      native
        .search(id, 'synthetic_cat')
        .some((item) => item.word === 'synthetic_cat'),
    );
  } finally {
    native.releaseDB(id);
  }
  const sharp = require(path.join(root, 'release/app/node_modules/sharp'));
  const png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 20, g: 30, b: 40, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 2);
  assert.equal(metadata.hasAlpha, true);
  console.log(
    JSON.stringify({
      electron: process.versions.electron,
      node: process.versions.node,
      modules: process.versions.modules,
      napi: process.versions.napi,
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
      nativeSearch: true,
      pngAlphaRoundTrip: true,
    }),
  );
}
if (process.argv.includes('--electron-probe')) {
  probe().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const run = spawnSync(require('electron'), [__filename, '--electron-probe'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    cwd: root,
  });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
}
