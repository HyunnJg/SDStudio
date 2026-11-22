const { test } = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process');
const {
  extraElectronArgs,
} = require('../../.erb/scripts/isolated-profile.cjs');
for (const mode of [
  'bad-zip',
  'http-error',
  'valid',
  'unknown-mime',
  'absent-mime',
  'cancel',
  'offline',
  'recovery',
])
  test(
    `real Electron one-shot validation UI: ${mode}`,
    {
      skip:
        process.platform !== 'linux' || !process.env.DISPLAY
          ? 'Requires Linux X11'
          : false,
    },
    (t) => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sdstudio-live-electron-'),
      );
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const original = path.join(root, 'original');
      fs.mkdirSync(original);
      const result = spawnSync(
        process.execPath,
        [
          require.resolve('electron/cli.js'),
          path.resolve('.erb/scripts/nai-live-smoke.cjs'),
          path.join(root, 'profile'),
          '--ozone-platform=x11',
          '--disable-gpu',
          '--password-store=basic',
          ...extraElectronArgs(process.env.SDSTUDIO_TEST_ELECTRON_ARGS),
        ],
        {
          encoding: 'utf8',
          timeout: 25000,
          env: {
            ...process.env,
            XDG_CONFIG_HOME: original,
            SDSTUDIO_LIVE_TEST_ROOT: root,
            SDSTUDIO_LIVE_TEST_MODE: mode,
            SDSTUDIO_LIVE_TEST_NODE: process.execPath,
            ...(mode === 'offline' ? { SDSTUDIO_OFFLINE: '1' } : {}),
          },
        },
      );
      const report = fs.existsSync(path.join(root, 'report.json'))
        ? JSON.parse(fs.readFileSync(path.join(root, 'report.json')))
        : {};
      assert.equal(
        result.status,
        0,
        JSON.stringify({ report, stderr: result.stderr }),
      );
      assert.deepEqual(fs.readdirSync(original), []);
      if (process.env.SDSTUDIO_LIVE_TEST_REPORT_DIR) {
        fs.mkdirSync(process.env.SDSTUDIO_LIVE_TEST_REPORT_DIR, {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(process.env.SDSTUDIO_LIVE_TEST_REPORT_DIR, mode + '.json'),
          JSON.stringify(report, null, 2),
        );
      }
      console.log(JSON.stringify(report));
    },
  );
