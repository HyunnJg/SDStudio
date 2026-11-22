const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { extraElectronArgs } = require('./isolated-profile.cjs');
if (process.platform !== 'linux' || !process.env.DISPLAY)
  throw Error('Requires Linux X11');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-project-ui-')),
  original = path.join(root, 'original');
fs.mkdirSync(original);
const reports = [];
try {
  for (const phase of ['create', 'reopen']) {
    const file = path.join(root, phase + '.json');
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('electron/cli.js'),
        '-r',
        path.resolve('.erb/scripts/smoke-harness.cjs'),
        path.resolve('release/app/dist/main/main.js'),
        '--ozone-platform=x11',
        '--disable-gpu',
        ...extraElectronArgs(process.env.SDSTUDIO_TEST_ELECTRON_ARGS),
      ],
      {
        encoding: 'utf8',
        timeout: 45000,
        env: {
          ...process.env,
          XDG_CONFIG_HOME: original,
          SDSTUDIO_USER_DATA_DIR: path.join(root, 'profile'),
          SDSTUDIO_OFFLINE: '1',
          SDSTUDIO_MOCK_BACKEND: '1',
          SDSTUDIO_SMOKE_SKIP_SINGLETON: '1',
          SDSTUDIO_SMOKE_PROJECTS: '1',
          SDSTUDIO_PROJECT_UI_PHASE: phase,
          SDSTUDIO_SMOKE_REPORT: file,
        },
      },
    );
    const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
    assert.equal(
      result.status,
      0,
      JSON.stringify({
        phase,
        report,
        stderr: result.stderr,
        stdout: result.stdout,
      }),
    );
    assert.ok(report.projectUI);
    assert.deepEqual(report.externalRequests, []);
    assert.deepEqual(report.rendererErrors, []);
    reports.push({ phase, pid: result.pid, ...report });
  }
  assert.deepEqual(fs.readdirSync(original), []);
  assert.notEqual(reports[0].pid, reports[1].pid);
  const summary = { reports, actualAccountRequests: 0, syntheticOnly: true };
  if (process.env.SDSTUDIO_PROJECT_UI_REPORT)
    fs.writeFileSync(
      process.env.SDSTUDIO_PROJECT_UI_REPORT,
      JSON.stringify(summary, null, 2),
    );
  console.log(JSON.stringify(summary));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
