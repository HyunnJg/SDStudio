const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { extraElectronArgs } = require('./isolated-profile.cjs');
if (process.platform !== 'linux')
  throw new Error('This smoke test uses a synthetic Linux appData directory');
if (!process.env.DISPLAY)
  throw new Error(
    'Full UI smoke requires an X11 DISPLAY (for example, xvfb-run). Profile-only headless checks are separate.',
  );
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-offline-smoke-'));
const appData = path.join(root, 'original-app-data');
fs.mkdirSync(appData);
const reportPath = path.join(root, 'report.json');
const mode = process.argv[2] === 'real' ? '0' : '1';
const result = spawnSync(
  process.execPath,
  [
    require.resolve('electron/cli.js'),
    '-r',
    path.join(__dirname, 'smoke-harness.cjs'),
    path.resolve(__dirname, '../../release/app/dist/main/main.js'),
    ...(process.env.DISPLAY
      ? ['--ozone-platform=x11']
      : ['--ozone-platform=headless']),
    '--disable-gpu',
    ...extraElectronArgs(process.env.SDSTUDIO_TEST_ELECTRON_ARGS),
  ],
  {
    cwd: path.resolve(__dirname, '../..'),
    stdio: 'inherit',
    timeout: 45000,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: appData,
      SDSTUDIO_USER_DATA_DIR: path.join(root, 'isolated'),
      SDSTUDIO_OFFLINE: '1',
      SDSTUDIO_MOCK_BACKEND: mode,
      SDSTUDIO_SMOKE_REPORT: reportPath,
    },
  },
);
assert.deepEqual(fs.readdirSync(appData), [], 'Original appData was modified');
process.stdout.write(`Smoke report: ${reportPath}\n`);
process.exit(result.status ?? 1);
