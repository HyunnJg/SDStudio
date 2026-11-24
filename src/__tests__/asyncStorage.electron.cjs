const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { spawnSync } = require('node:child_process');
const producers = [['current', undefined]];
if (process.env.SDSTUDIO_LEGACY_ELECTRON) {
  assert.equal(process.platform, 'win32');
  assert.ok(path.isAbsolute(process.env.SDSTUDIO_LEGACY_ELECTRON));
  producers.push(['electron26', process.env.SDSTUDIO_LEGACY_ELECTRON]);
}
for (const [producer, legacy] of producers)
  test(`actual OS async crypto and production store, producer=${producer}`, (t) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'sdstudio-async-storage-'),
    );
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const reports = [];
    for (const phase of ['write', 'read']) {
      const old = legacy && phase === 'write';
      const args = [
        require.resolve('../../.erb/scripts/async-storage-probe.cjs'),
        '--ozone-platform=headless',
        '--disable-gpu',
        ...(process.platform === 'linux' ? ['--password-store=basic'] : []),
        ...JSON.parse(process.env.SDSTUDIO_TEST_ELECTRON_ARGS || '[]'),
      ];
      const result = spawnSync(
        old ? legacy : process.execPath,
        old ? args : [require.resolve('electron/cli.js'), ...args],
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
      const file = path.join(root, `${phase}-report.json`);
      const report = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file))
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
      assert.equal(
        report.electron,
        old
          ? '26.6.10'
          : require('../../package.json').devDependencies.electron,
      );
      assert.equal(report.ok, true);
      assert.equal(report.networkAttempts, 0);
      if (process.platform === 'linux')
        assert.equal(report.result, 'insecure-provider-not-tested');
      else if (phase === 'read')
        for (const key of [
          'legacyReadableAfterRestart',
          'asyncRoundTrip',
          'legacyFileUnchanged',
          'productionStoreRead',
          'productionStoreRoundTrip',
        ])
          assert.equal(report[key], true, key);
      reports.push(report);
    }
    console.log(
      JSON.stringify({
        producer,
        asyncStorageCompatibility: reports,
        actualAccountRequests: 0,
      }),
    );
  });
