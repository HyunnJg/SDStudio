// Test-only Electron entry. Synthetic credentials, isolated paths, no generation endpoint access.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  safeStorage,
  net,
} = require('electron');
const root = process.env.SDSTUDIO_NAI_TEST_ROOT;
if (!root) throw Error('Requires a disposable test root');
app.setName('sdstudio-nai-test');
for (const name of ['userData', 'sessionData', 'crashDumps']) {
  const folder = path.join(root, name);
  fs.mkdirSync(folder, { recursive: true });
  app.setPath(name, folder);
}
app.setAppLogsPath(path.join(root, 'logs'));
require('ts-node/register/transpile-only');
const { NaiTokenStore } = require('../../src/main/nai/tokenStore');
const {
  registerNaiAuth,
  isTrustedAuthFrame,
} = require('../../src/main/nai/authIpc');
const { createNaiTransport } = require('../../src/main/nai/electronTransport');
const { installOfflineRequestGuard } = require('../../src/main/offlineNetwork');
const report = {
  electron: process.versions.electron,
  node: process.versions.node,
  platform: process.platform,
  syntheticCredentialsOnly: true,
  checks: [],
  remoteRequestsAllowed: 0,
};
let finished = false;
function finish(code, error) {
  if (finished) return;
  finished = true;
  if (error) report.failure = String(error);
  fs.writeFileSync(
    path.join(root, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
}
setTimeout(() => finish(1, 'Timed out'), 20000).unref();
app
  .whenReady()
  .then(async () => {
    const file = path.join(root, 'userData/auth/novelai-token.v1.json');
    const store = new NaiTokenStore(file, safeStorage);
    // Force a known insecure Linux provider for this test only. Production never enables it.
    if (process.platform === 'linux') {
      report.storageBackend = safeStorage.getSelectedStorageBackend();
      if (
        report.storageBackend === 'basic_text' ||
        report.storageBackend === 'unknown'
      ) {
        assert.throws(() => store.set('synthetic-never-a-real-token', true), {
          code: 'SECURE_STORAGE_UNAVAILABLE',
        });
        report.checks.push('insecure OS backend refuses persistent storage');
      }
    }
    let offline = false;
    const html = path.join(root, 'index.html');
    fs.writeFileSync(
      html,
      '<!doctype html><title>Synthetic authentication bridge</title>',
    );
    const expected = require('node:url').pathToFileURL(html).href;
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.resolve(
          __dirname,
          '../../release/app/dist/main/preload.js',
        ),
      },
    });
    registerNaiAuth(
      ipcMain,
      store,
      () => offline,
      (event) => isTrustedAuthFrame(event, window.webContents, expected),
    );
    await window.loadURL(expected);
    const call = (code) => window.webContents.executeJavaScript(code);
    assert.deepEqual(
      await call(
        'window.electron.naiAuth.setToken("synthetic-never-a-real-token", false)',
      ),
      {
        ok: true,
        status: {
          configured: true,
          storage: 'session',
          secureStorageAvailable: store.status().secureStorageAvailable,
        },
      },
    );
    assert.equal(fs.existsSync(file), false);
    assert.equal(store.read(), 'synthetic-never-a-real-token');
    const status = await call('window.electron.naiAuth.status()');
    assert.equal(JSON.stringify(status).includes('synthetic-never'), false);
    report.checks.push(
      'compiled preload IPC stores session token without returning it or writing a file',
    );
    offline = true;
    assert.deepEqual(
      await call(
        'window.electron.naiAuth.setToken("synthetic-rejected", true)',
      ),
      { ok: false, code: 'OFFLINE' },
    );
    assert.deepEqual(await call('window.electron.naiAuth.status()'), {
      ok: false,
      code: 'OFFLINE',
    });
    assert.equal(store.read(), 'synthetic-never-a-real-token');
    report.checks.push('offline IPC rejects before accessing token storage');
    offline = false;
    assert.equal(
      (await call('window.electron.naiAuth.clear()')).status.configured,
      false,
    );
    report.checks.push('clear drops session credential');
    // A proxy pointing to a closed loopback port provides an additional local-only backstop.
    await session.defaultSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:9;https=127.0.0.1:9',
    });
    let reads = 0,
      blocked = 0;
    const webRequest = session.defaultSession.webRequest;
    const install = webRequest.onBeforeRequest.bind(webRequest);
    webRequest.onBeforeRequest = (filter, listener) =>
      install(filter, (details, callback) =>
        listener(details, (decision) => {
          if (decision.cancel) blocked++;
          else if (
            !['127.0.0.1', 'localhost', '[::1]'].includes(
              new URL(details.url).hostname,
            )
          )
            report.remoteRequestsAllowed++;
          callback(decision);
        }),
      );
    installOfflineRequestGuard(session.defaultSession);
    webRequest.onBeforeRequest = install;
    const originalRequest = net.request.bind(net);
    let loopbackURL;
    net.request = (options) => {
      assert.equal(options.session, session.defaultSession);
      report.boundToDefaultSession = true;
      assert.equal(options.url, 'https://image.novelai.net/ai/generate-image');
      // A test-only URL rewrite; production offers no caller-controlled URL.
      const request = originalRequest(
        loopbackURL ? { ...options, url: loopbackURL } : options,
      );
      request.on('error', (error) => {
        report.networkDiagnostic = error.message;
      });
      request.on('response', (response) => {
        report.responseStatus = response.statusCode;
        response.on('error', (error) => {
          report.responseDiagnostic = error.message;
        });
      });
      report.events = [];
      for (const name of ['close', 'finish', 'abort', 'response', 'error'])
        request.on(name, () => report.events.push(name));
      return request;
    };
    const fakeStore = {
      read: () => {
        reads++;
        return 'synthetic-never-a-real-token';
      },
    };
    await assert.rejects(
      createNaiTransport(fakeStore, () => true).send(Buffer.from('{}')),
      { code: 'OFFLINE' },
    );
    assert.equal(reads, 0);
    report.checks.push('transport offline gate refuses before reading a token');
    // Deliberately open the transport-level gate; shared defaultSession guard must still cancel.
    await assert.rejects(
      createNaiTransport(fakeStore, () => false).send(
        Buffer.from('{"model":"fixture-model-not-for-api"}'),
        undefined,
        5000,
      ),
      { code: 'NETWORK' },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(blocked, 1);
    assert.equal(reads, 1);
    report.blockedByDefaultSession = blocked;
    report.checks.push(
      'Electron net.request is blocked by the production defaultSession webRequest guard',
    );
    // The shared production guard remains installed. Only loopback traffic can pass.
    const http = require('node:http');
    let requests = 0;
    const bytes = Buffer.from([80, 75, 3, 4, 0, 255]);
    const server = http.createServer((request, response) => {
      requests++;
      report.loopbackRequests = requests;
      assert.equal(
        request.headers.authorization,
        'Bearer synthetic-never-a-real-token',
      );
      assert.equal(request.headers.cookie, undefined);
      if (request.url === '/redirect') {
        response.writeHead(307, {
          Location: `http://127.0.0.1:${server.address().port}/should-not-follow`,
        });
        response.end();
      } else {
        response.writeHead(200, { 'Content-Type': 'application/zip' });
        response.end(bytes);
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    loopbackURL = `http://127.0.0.1:${server.address().port}/success`;
    await session.defaultSession.cookies.set({
      url: loopbackURL,
      name: 'synthetic-session-cookie',
      value: 'must-not-send',
    });
    const response = await createNaiTransport(fakeStore, () => false).send(
      Buffer.from('{}'),
      undefined,
      5000,
    );
    assert.deepEqual(Buffer.from(response), bytes);
    report.checks.push(
      'real loopback response preserves bytes and sends explicit Authorization without cookies',
    );
    const { png } = require('../../src/__tests__/fixtures/nai/png.cjs');
    const JSZip = require('jszip');
    const archive = new JSZip();
    archive.file('image.png', png());
    const validImage = await archive.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    // The same real Electron transport now validates the bounded ZIP-to-PNG path.
    let imagePayload = validImage;
    server.removeAllListeners('request');
    server.on('request', (request, response) => {
      requests++;
      assert.equal(
        request.headers.authorization,
        'Bearer synthetic-never-a-real-token',
      );
      assert.equal(request.headers.cookie, undefined);
      if (request.url === '/redirect') {
        response.writeHead(307, {
          Location: `http://127.0.0.1:${server.address().port}/should-not-follow`,
        });
      } else response.writeHead(200, { 'Content-Type': 'application/zip' });
      response.end(imagePayload);
    });
    assert.deepEqual(
      Buffer.from(
        await createNaiTransport(fakeStore, () => false).sendImage(
          Buffer.from('{}'),
          undefined,
          5000,
        ),
      ),
      png(),
    );
    report.checks.push(
      'real Electron ZIP decoding preserves original RGBA and opaque metadata bytes',
    );
    imagePayload = Buffer.from('synthetic invalid image response');
    await assert.rejects(
      createNaiTransport(fakeStore, () => false).sendImage(
        Buffer.from('{}'),
        undefined,
        5000,
      ),
      {
        code: 'INVALID_IMAGE_RESPONSE',
        mayHaveReachedServer: true,
        imageResponseReason: 'zip-eocd',
      },
    );
    report.checks.push(
      'invalid image response retains zip-eocd internally and mayHaveReachedServer without retry',
    );
    loopbackURL = `http://127.0.0.1:${server.address().port}/redirect`;
    await assert.rejects(
      createNaiTransport(fakeStore, () => false).send(
        Buffer.from('{}'),
        undefined,
        5000,
      ),
      { code: 'REDIRECT' },
    );
    assert.equal(requests, 4);
    report.loopbackRequests = requests;
    report.checks.push('real HTTP redirect is rejected without following');
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    window.destroy();
    store.lock();
    finish(0);
  })
  .catch(async (error) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    finish(1, error);
  });
