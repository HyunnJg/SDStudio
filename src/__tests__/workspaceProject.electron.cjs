const { test } = require('node:test');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  extraElectronArgs,
} = require('../../.erb/scripts/isolated-profile.cjs');
test(
  'real Electron sandbox preload persists local projects and recovers byte-identical PNG without network',
  {
    skip:
      process.platform !== 'linux' || !process.env.DISPLAY
        ? 'Requires Linux X11'
        : false,
  },
  (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sdstudio-project-electron-'),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const original = path.join(root, 'original');
    fs.mkdirSync(original);
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('electron/cli.js'),
        path.resolve('.erb/scripts/project-store-harness.cjs'),
        '--ozone-platform=x11',
        '--disable-gpu',
        ...extraElectronArgs(process.env.SDSTUDIO_TEST_ELECTRON_ARGS),
      ],
      {
        encoding: 'utf8',
        timeout: 25000,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: original,
          SDSTUDIO_PROJECT_TEST_ROOT: root,
        },
      },
    );
    const file = path.join(root, 'report.json'),
      report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
    assert.equal(
      result.status,
      0,
      JSON.stringify({ report, stderr: result.stderr }),
    );
    assert.equal(report.checks.length, 6);
    assert.deepEqual(fs.readdirSync(original), []);
    assert.deepEqual(report.rendererErrors, []);
    if (process.env.SDSTUDIO_PROJECT_TEST_REPORT)
      fs.copyFileSync(file, process.env.SDSTUDIO_PROJECT_TEST_REPORT);
    console.log(JSON.stringify(report));
  },
);
