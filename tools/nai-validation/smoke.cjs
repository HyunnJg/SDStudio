// Offline test of the standalone dependency boundary. Synthetic token only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { app } = require('electron');
const allowed =
  fs.realpathSync(path.join(__dirname, 'node_modules')) + path.sep;
const resolve = Module._resolveFilename;
Module._resolveFilename = function (...args) {
  const file = resolve.apply(this, args);
  if (
    path.isAbsolute(file) &&
    file.includes(`${path.sep}node_modules${path.sep}`) &&
    !file.startsWith(allowed)
  )
    throw Error('Full app dependency forbidden');
  return file;
};
require('./register.cjs');
setTimeout(() => app.exit(1), 12000).unref();
require('../../.erb/scripts/nai-live-entry.cjs').start({
  onReady: async ({ window, runner }) => {
    const call = (code) => window.webContents.executeJavaScript(code);
    const value = await call('window.validation.status()');
    assert.equal(value.status.offline, true);
    assert.equal(value.status.tokenConfigured, false);
    assert.equal(
      (await call("window.validation.setToken('synthetic-only')")).code,
      'OFFLINE',
    );
    const evidence = {
      requestHash: runner.requestHash,
      beforeBalance: 100,
      displayedCost: 5,
      sameSettings: true,
      capture: true,
      candidateAcknowledged: true,
    };
    assert.equal(
      (await call(`window.validation.run(${JSON.stringify(evidence)})`)).code,
      'OFFLINE',
    );
    assert.equal(runner.status().used, false);
    assert.deepEqual(fs.readdirSync(runner.directory), []);
    assert.deepEqual(fs.readdirSync(process.env.XDG_CONFIG_HOME), []);
    process.stdout.write('STANDALONE_OFFLINE_OK\n');
    app.exit(0);
  },
});
