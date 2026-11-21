const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  extraElectronArgs,
} = require('../../.erb/scripts/isolated-profile.cjs');
test(
  'real Electron auth bridge and session-bound network boundary',
  {
    skip:
      process.platform !== 'linux' || !process.env.DISPLAY
        ? 'Requires Linux X11; no credentials or external service'
        : false,
  },
  (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sdstudio-nai-electron-'),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const original = path.join(root, 'original');
    fs.mkdirSync(original);
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('electron/cli.js'),
        path.resolve(__dirname, '../../.erb/scripts/nai-main-harness.cjs'),
        '--ozone-platform=x11',
        '--disable-gpu',
        '--password-store=basic',
        ...extraElectronArgs(process.env.SDSTUDIO_TEST_ELECTRON_ARGS),
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        env: {
          ...process.env,
          XDG_CONFIG_HOME: original,
          SDSTUDIO_NAI_TEST_ROOT: root,
        },
        timeout: 25000,
        encoding: 'utf8',
      },
    );
    const filename = path.join(root, 'report.json');
    const report = fs.existsSync(filename)
      ? JSON.parse(fs.readFileSync(filename))
      : {};
    assert.equal(
      result.status,
      0,
      JSON.stringify({ report, stderr: result.stderr, stdout: result.stdout }),
    );
    assert.equal(report.blockedByDefaultSession, 1);
    assert.equal(report.remoteRequestsAllowed, 0);
    assert.ok(report.checks.length >= 6);
    assert.deepEqual(fs.readdirSync(original), []);
    if (process.env.SDSTUDIO_NAI_TEST_REPORT)
      fs.copyFileSync(filename, process.env.SDSTUDIO_NAI_TEST_REPORT);
    console.log(JSON.stringify(report));
  },
);
