const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRuntimeOptions, allowsOfflineURL } = require('../runtimeOptions');
const { selectBackend } = require('../renderer/runtime');
const { MockBackend } = require('../renderer/backends/mockBackend');
const {
  AppUpdateNoticeService,
} = require('../renderer/models/AppUpdateNoticeService');

test('isolated profiles default offline, explicit opt-in is separate, mock always stays offline', () => {
  assert.equal(createRuntimeOptions({}, true).offline, true);
  assert.equal(
    createRuntimeOptions({ SDSTUDIO_OFFLINE: '0' }, true).offline,
    false,
  );
  assert.deepEqual(
    createRuntimeOptions({ SDSTUDIO_MOCK_BACKEND: '1', SDSTUDIO_OFFLINE: '0' }),
    { offline: true, mockBackend: true },
  );
});

test('offline policy accepts loopback but rejects remote and misleading host names', () => {
  for (const url of [
    'http://localhost:1212/',
    'ws://127.0.0.1:1212/',
    'http://[::1]/',
  ])
    assert.equal(allowsOfflineURL(url), true);
  for (const url of [
    'https://image.novelai.net/',
    'https://ip.sunho.kim/',
    'http://localhost.evil/',
    'http://localhost@evil.test/',
    'invalid',
  ])
    assert.equal(allowsOfflineURL(url), false);
});

test('mock selection does not construct an Android backend in a browser', () => {
  const factories = {
    mock: () => 'mock',
    electron: () => {
      throw new Error('unexpected Electron');
    },
    android: () => {
      throw new Error('unexpected Android');
    },
  };
  assert.equal(selectBackend(true, false, factories), 'mock');
});

test('mock file operations and generation stay in memory, with no fetch', async (t) => {
  let requests = 0;
  t.mock.method(global, 'fetch', () => {
    requests += 1;
    throw new Error('network not allowed');
  });
  const backend = new MockBackend();
  await backend.writeFile('projects/preview.json', '{"version":1}');
  assert.deepEqual(await backend.listFiles('projects'), ['preview.json']);
  await backend.generateImage({
    outputFilePath: 'outs/preview.png',
    prompt: 'synthetic preview',
    seed: 42,
  });
  assert.match(
    await backend.readDataFile('outs/preview.png'),
    /^data:image\/png;base64,/,
  );
  assert.equal(backend.generations[0].seed, 42);
  await assert.rejects(backend.login('example', 'fixture'), /disabled/);
  await assert.rejects(backend.download('https://example.test'), /disabled/);
  assert.equal(requests, 0);
});

test('disabled updates perform no version or network requests, including repeated run calls', async () => {
  const service = new AppUpdateNoticeService({
    getVersion: () => {
      throw new Error('unexpected version');
    },
    fetcher: () => {
      throw new Error('unexpected fetch');
    },
  });
  await service.run();
  await service.run();
  service.stop();
});

test('enabled update polling starts once, points at the fork, and stops', async () => {
  const urls = [];
  const service = new AppUpdateNoticeService({
    enabled: true,
    getVersion: async () => '3.1.11',
    fetcher: async (url) => {
      urls.push(url);
      return { ok: true, json: async () => ({ tag_name: 'v3.1.12' }) };
    },
  });
  const first = service.run();
  const second = service.run();
  await new Promise(setImmediate);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /HyunnJg\/SDStudio/);
  assert.equal(service.outdated, true);
  service.stop();
  await Promise.all([first, second]);
  assert.equal(service.isOutdated('3.1.11', 'v3.1.12'), true);
  assert.equal(service.isOutdated('bad', 'v3.1.12'), false);
});

test('restarting polling while an old request is pending cannot revive the old loop', async () => {
  let completeOldRequest;
  let requests = 0;
  let updates = 0;
  const service = new AppUpdateNoticeService({
    enabled: true,
    getVersion: async () => '3.1.11',
    fetcher: async () => {
      requests += 1;
      if (requests === 1)
        return new Promise((resolve) => {
          completeOldRequest = resolve;
        });
      return { status: 404 };
    },
  });
  service.addEventListener('updated', () => {
    updates += 1;
  });
  const old = service.run();
  await new Promise(setImmediate);
  service.stop();
  const current = service.run();
  await new Promise(setImmediate);
  completeOldRequest({ ok: true, json: async () => ({ tag_name: 'v3.1.12' }) });
  await old;
  assert.equal(updates, 0);
  assert.equal(requests, 2);
  service.stop();
  await current;
});

test('disabled local AI does not touch files, download or spawn a process', async () => {
  const Module = require('node:module');
  const load = Module._load;
  let accesses = 0;
  const backend = new Proxy(
    {},
    {
      get() {
        accesses += 1;
        throw new Error('disabled backend accessed');
      },
    },
  );
  let LocalAIService;
  Module._load = function (name, parent, ...rest) {
    if (name === '.' && parent?.filename.includes('/renderer/models/'))
      return { backend };
    return load.call(this, name, parent, ...rest);
  };
  try {
    ({ LocalAIService } = require('../renderer/models/LocalAIService'));
  } finally {
    Module._load = load;
  }
  const service = new LocalAIService(false);
  await service.statsModels();
  await assert.rejects(service.download(), /disabled/);
  await assert.rejects(service.spawnLocalAI(), /disabled/);
  assert.equal(accesses, 0);
});

test('offline Electron account and generation calls fail before reading a token or invoking IPC', async () => {
  const Module = require('node:module');
  const load = Module._load;
  const previousWindow = global.window;
  let invoked = 0;
  global.window = {
    electron: {
      ipcRenderer: {
        invoke: () => {
          invoked += 1;
          throw new Error('unexpected IPC');
        },
      },
    },
  };
  Module._load = function (name, parent, ...rest) {
    if (parent?.filename.endsWith('/backends/electronBackend.ts')) {
      if (name === '../runtime') return { runtimeOptions: { offline: true } };
      if (name === './genVendors/nai')
        return { NovelAiImageGenService: class {} };
    }
    return load.call(this, name, parent, ...rest);
  };
  let ElectornBackend;
  try {
    ({ ElectornBackend } = require('../renderer/backends/electronBackend'));
  } finally {
    Module._load = load;
  }
  try {
    const backend = new ElectornBackend();
    await assert.rejects(backend.generateImage({}), /disabled/);
    await assert.rejects(backend.login('fixture', 'fixture'), /disabled/);
    await assert.rejects(backend.getRemainCredits(), /disabled/);
    assert.equal(invoked, 0);
  } finally {
    global.window = previousWindow;
  }
});
