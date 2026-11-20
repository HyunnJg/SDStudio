const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const {
  extraElectronArgs,
} = require('../../.erb/scripts/isolated-profile.cjs');

test(
  'compiled Electron entry reports init failure and quits with no window',
  {
    skip:
      process.platform !== 'linux' || !process.env.DISPLAY
        ? 'Requires synthetic Linux appData and an X11 DISPLAY'
        : false,
  },
  (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sdstudio-startup-failure-'),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const original = path.join(root, 'original');
    fs.mkdirSync(original);
    const report = path.join(root, 'report.json');
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('electron/cli.js'),
        '-r',
        path.resolve(
          __dirname,
          '../../.erb/scripts/startup-failure-harness.cjs',
        ),
        path.resolve(__dirname, '../../release/app/dist/main/main.js'),
        '--ozone-platform=x11',
        '--disable-gpu',
        ...extraElectronArgs(process.env.SDSTUDIO_TEST_ELECTRON_ARGS),
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
        timeout: 20000,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: original,
          SDSTUDIO_USER_DATA_DIR: path.join(root, 'isolated'),
          SDSTUDIO_OFFLINE: '1',
          SDSTUDIO_MOCK_BACKEND: '0',
          SDSTUDIO_SMOKE_REPORT: report,
        },
      },
    );
    assert.equal(result.status, 1, result.stderr);
    assert.ok(fs.existsSync(report), result.stdout + result.stderr);
    const data = JSON.parse(fs.readFileSync(report, 'utf8'));
    assert.match(data.reported.title, /시작 실패/);
    assert.match(data.reported.message, /Synthetic missing tag DB/);
    assert.equal(data.windowCount, 0);
    assert.equal(data.quitObserved, true);
    assert.deepEqual(fs.readdirSync(original), [], JSON.stringify(data));
    assert.match(
      fs.readFileSync(path.join(root, 'isolated/logs/main.log'), 'utf8'),
      /Synthetic missing tag DB/,
    );
  },
);
