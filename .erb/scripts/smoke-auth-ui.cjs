// Linux synthetic-profile wrapper; never enables account or generation requests.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
if (process.platform !== 'linux' || !process.env.DISPLAY)
  throw Error('Requires Linux X11');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-auth-ui-')),
  appData = path.join(root, 'app-data'),
  report = path.join(root, 'report.json');
fs.mkdirSync(appData);
const before = [];
for (const folder of ['sdstudio', 'SDStudio'])
  for (const name of [
    'SDStudio/config.json',
    'SDStudio/TOKEN.txt',
    'auth/novelai-token.v1.json',
  ]) {
    const target = path.join(appData, folder, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      name.endsWith('config.json') ? '{}' : 'synthetic-original',
    );
    before.push({
      target,
      bytes: fs.readFileSync(target),
      mtime: fs.statSync(target).mtimeMs,
    });
  }
const env = {
  ...process.env,
  NODE_ENV: 'production',
  XDG_CONFIG_HOME: appData,
  SDSTUDIO_MOCK_BACKEND: '0',
  SDSTUDIO_OFFLINE: process.argv[2] === 'offline' ? '1' : '0',
  SDSTUDIO_SMOKE_REPORT: report,
  SDSTUDIO_SMOKE_SKIP_SINGLETON: '1',
  SDSTUDIO_SMOKE_AUTH_UI: '1',
};
delete env.SDSTUDIO_USER_DATA_DIR;
const result = spawnSync(
  process.execPath,
  [
    require.resolve('electron/cli.js'),
    '-r',
    path.join(__dirname, 'smoke-harness.cjs'),
    path.resolve(__dirname, '../../release/app/dist/main/main.js'),
    '--ozone-platform=x11',
    '--disable-gpu',
    '--password-store=basic',
  ],
  { env, timeout: 45000, stdio: 'inherit' },
);
assert.equal(result.status, 0);
for (const file of before) {
  assert.deepEqual(fs.readFileSync(file.target), file.bytes);
  assert.equal(fs.statSync(file.target).mtimeMs, file.mtime);
}
const data = JSON.parse(fs.readFileSync(report));
assert.equal(data.authUI.profile, path.join(appData, 'SDStudio-HyunnJg'));
assert.deepEqual(data.externalRequests, []);
assert.deepEqual(data.rendererErrors, []);
data.originalFixtureUnchanged = true;
fs.writeFileSync(report, JSON.stringify(data, null, 2));
console.log('Auth UI report: ' + report);
