const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const headless = process.env.SDSTUDIO_SMOKE_HEADLESS === '1';
if (process.platform !== 'linux' || (!headless && !process.env.DISPLAY))
  throw Error('Requires Linux X11 or explicit SDSTUDIO_SMOKE_HEADLESS=1');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-generation-ui-'));
const original = path.join(root, 'original');
fs.mkdirSync(original);
const reports = [];
try {
  for (const phase of [
    ['queue', 'queue-errors', 'characters'].includes(process.argv[2])
      ? process.argv[2]
      : 'create',
    'reopen',
    'offline',
  ]) {
    const report = path.join(root, phase + '.json');
    const run = spawnSync(
      process.execPath,
      [
        require.resolve('electron/cli.js'),
        '-r',
        path.resolve('.erb/scripts/generation-ui-harness.cjs'),
        path.resolve('release/app/dist/main/main.js'),
        `--ozone-platform=${headless ? 'headless' : 'x11'}`,
        ...(process.env.SDSTUDIO_SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
        '--disable-gpu',
      ],
      {
        timeout: 45000,
        encoding: 'utf8',
        env: {
          ...process.env,
          XDG_CONFIG_HOME: original,
          SDSTUDIO_USER_DATA_DIR: path.join(root, 'profile'),
          SDSTUDIO_OFFLINE: phase === 'offline' ? '1' : '0',
          SDSTUDIO_MOCK_BACKEND: '0',
          SDSTUDIO_GENERATION_PHASE: phase,
          SDSTUDIO_CHARACTER_SMOKE:
            process.argv[2] === 'characters' ? '1' : '0',
          SDSTUDIO_LIBRARY_REOPEN:
            ['queue', 'queue-errors', 'characters'].includes(process.argv[2]) ? '0' : '1',
          SDSTUDIO_SMOKE_REPORT: report,
        },
      },
    );
    const data = fs.existsSync(report)
      ? JSON.parse(fs.readFileSync(report))
      : {};
    assert.equal(
      run.status,
      0,
      JSON.stringify({ data, stderr: run.stderr, stdout: run.stdout }),
    );
    reports.push({ pid: run.pid, ...data });
  }
  assert.deepEqual(fs.readdirSync(original), []);
  const summary = {
    reports,
    actualAccountRequests: 0,
    transportDestinationRewrittenToLoopback: true,
  };
  if (process.env.SDSTUDIO_GENERATION_REPORT)
    fs.writeFileSync(
      process.env.SDSTUDIO_GENERATION_REPORT,
      JSON.stringify(summary, null, 2),
    );
  console.log(JSON.stringify(summary));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
