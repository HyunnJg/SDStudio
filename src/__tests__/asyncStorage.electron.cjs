const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawnSync } = require('node:child_process');
test('actual OS crypto: old v1 ciphertext survives a new process and async roundtrip, or insecure Linux is explicitly left untested', (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sdstudio-async-storage-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reports = [];
  for (const phase of ['write', 'read']) {
    const result = spawnSync(
      process.execPath,
      [
        require.resolve('electron/cli.js'),
        require.resolve('../../.erb/scripts/async-storage-probe.cjs'),
        '--ozone-platform=headless',
        '--disable-gpu',
        ...(process.platform === 'linux' ? ['--password-store=basic'] : []),
        ...JSON.parse(process.env.SDSTUDIO_TEST_ELECTRON_ARGS || '[]'),
      ],
      {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
        timeout: 35000,
        env: {
          ...process.env,
          SDSTUDIO_ASYNC_STORAGE_TEST_ROOT: root,
          SDSTUDIO_ASYNC_STORAGE_TEST_PHASE: phase,
        },
      },
    );
    const reportFile = path.join(root, `${phase}-report.json`);
    const report = fs.existsSync(reportFile)
      ? JSON.parse(fs.readFileSync(reportFile))
      : {};
    assert.equal(
      result.status,
      0,
      JSON.stringify({
        report,
        signal: result.signal,
        stderr: result.stderr.slice(-1500),
      }),
    );
    assert.equal(report.ok, true);
    assert.equal(report.networkAttempts, 0);
    if (process.platform === 'linux')
      assert.equal(report.result, 'insecure-provider-not-tested');
    else if (phase === 'read') {
      assert.equal(report.legacyReadableAfterRestart, true);
      assert.equal(report.asyncRoundTrip, true);
      assert.equal(report.legacyFileUnchanged, true);
    }
    reports.push(report);
  }
  console.log(
    JSON.stringify({
      asyncStorageCompatibility: reports,
      actualAccountRequests: 0,
    }),
  );
});
