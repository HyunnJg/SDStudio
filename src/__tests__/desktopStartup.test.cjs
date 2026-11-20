const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const {
  startDesktop,
  usesDevelopmentAssets,
  resolvePreloadPath,
} = require('../main/desktopStartup');

test('initialization failure is reported then quits without creating a window', async () => {
  const calls = [];
  await startDesktop({
    ready: async () => {
      calls.push('ready');
    },
    initialize: async () => {
      throw new Error('fixture: db.csv missing');
    },
    open: async () => {
      calls.push('window');
    },
    logError: (error) => {
      calls.push('log');
      assert.match(error.message, /db.csv/);
    },
    showError: (title, message) => {
      calls.push('dialog');
      assert.match(title, /시작 실패/);
      assert.match(message, /db.csv/);
    },
    quit: () => {
      calls.push('quit');
    },
  });
  assert.deepEqual(calls, ['ready', 'log', 'dialog', 'quit']);
});

test('startup waits for initialization and also reports a window failure', async () => {
  const calls = [];
  await startDesktop({
    ready: async () => {
      calls.push('ready');
    },
    initialize: async () => {
      await new Promise(setImmediate);
      calls.push('init');
    },
    open: async () => {
      calls.push('window');
      throw new Error('fixture window failure');
    },
    logError: () => {
      calls.push('log');
    },
    showError: () => {
      calls.push('dialog');
    },
    quit: () => {
      calls.push('quit');
    },
  });
  assert.deepEqual(calls, ['ready', 'init', 'window', 'log', 'dialog', 'quit']);
});

test('DEBUG_PROD production and packaged apps use the adjacent preload', () => {
  for (const packaged of [true, false]) {
    const development = usesDevelopmentAssets(packaged, 'production');
    assert.equal(development, false);
    assert.equal(
      resolvePreloadPath('/fixture/dist/main', development),
      path.join('/fixture/dist/main', 'preload.js'),
    );
  }
  assert.equal(usesDevelopmentAssets(true, 'development'), false);
  assert.equal(usesDevelopmentAssets(false, 'development'), true);
  assert.equal(
    resolvePreloadPath('/fixture/src/main', true),
    path.resolve('/fixture/.erb/dll/preload.js'),
  );
});

test('a failed error log cannot prevent the error dialog or process exit', async () => {
  const calls = [];
  await startDesktop({
    ready: async () => {},
    initialize: async () => {
      throw new Error('fixture permission failure');
    },
    open: async () => {
      throw new Error('unexpected window');
    },
    logError: () => {
      throw new Error('fixture unwritable log directory');
    },
    showError: (_title, message) => {
      calls.push('dialog');
      assert.match(message, /permission failure/);
    },
    quit: () => {
      calls.push('quit');
    },
  });
  assert.deepEqual(calls, ['dialog', 'quit']);
});
