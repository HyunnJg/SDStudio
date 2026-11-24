// One first-party path owns runtime installation and the Electron-targeted native build.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkToolchain } = require('./check-toolchain.cjs');
const root = path.resolve(__dirname, '../..');
function run(file, args, cwd = root) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(
      `Desktop setup failed (${result.status ?? result.signal}): ${path.basename(file)} ${args.join(' ')}`,
    );
}
function main() {
  checkToolchain();
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--rebuild-only'))
    throw Error('Usage: npm run setup:desktop [-- --rebuild-only]');
  const rebuildOnly = args.includes('--rebuild-only');
  const npm = process.env.npm_execpath;
  if (!npm || !fs.existsSync(npm))
    throw Error('Run desktop setup through npm run setup:desktop.');
  if (!rebuildOnly) {
    // Dependency lifecycle scripts are unnecessary here; the explicit build below is authoritative.
    for (const folder of ['src/native', 'release/app'])
      run(
        npm,
        [
          'ci',
          '--ignore-scripts',
          '--include=optional',
          '--no-audit',
          '--no-fund',
        ],
        path.join(root, folder),
      );
  }
  const electronRoot = path.dirname(require.resolve('electron/package.json'));
  const electron = require(path.join(electronRoot, 'package.json'));
  const installBin = electron.bin['install-electron'];
  if (!installBin)
    throw Error('The pinned Electron package must provide install-electron.');
  run(path.join(electronRoot, installBin), ['--no']);
  // Target Electron's headers, not the developer's Node ABI; no PATH-selected node-gyp.
  run(
    require.resolve('node-gyp/bin/node-gyp.js'),
    [
      'rebuild',
      `--target=${electron.version}`,
      `--arch=${process.arch}`,
      '--dist-url=https://www.electronjs.org/headers',
    ],
    path.join(root, 'src/native'),
  );
  const sourceModules = path.join(root, 'src/node_modules');
  const runtimeModules = path.join(root, 'release/app/node_modules');
  if (fs.existsSync(sourceModules)) {
    if (fs.realpathSync(sourceModules) !== fs.realpathSync(runtimeModules))
      throw Error(
        'src/node_modules already exists and does not point to release/app/node_modules. Preserve it and resolve the conflict manually.',
      );
  } else fs.symlinkSync(runtimeModules, sourceModules, 'junction');
  run(path.join(__dirname, 'verify-desktop.cjs'), []);
  if (!rebuildOnly) run(npm, ['run', 'build:dll']);
  console.log(
    `Desktop ready: Node ${process.versions.node}, Electron ${electron.version}, ${process.platform}/${process.arch}`,
  );
}
module.exports = { main, run };
if (require.main === module) main();
