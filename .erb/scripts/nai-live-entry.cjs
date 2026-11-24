// Explicit developer validation entry. No account login, credential discovery or retries.
const fs = require('node:fs'),
  path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  net,
  safeStorage,
  Menu,
} = require('electron');
// The standalone runner registers its own pinned compiler before loading this file.
if (!require.extensions['.ts']) require('ts-node/register/transpile-only');
const { initializeForkProfile } = require('../../src/main/forkProfile');
const { NaiTokenStore } = require('../../src/main/nai/tokenStore');
const {
  registerNaiAuth,
  isTrustedAuthFrame,
} = require('../../src/main/nai/authIpc');
const {
  NaiTransport,
  IMAGE_ENDPOINT,
} = require('../../src/main/nai/transport');
const {
  LiveValidation,
  ValidationError,
} = require('../../src/main/nai/liveValidation');
const { NaiError } = require('../../src/main/nai/errors');
const { mediaTypeBucket } = require('../../src/main/nai/responseMediaType');
function start(options = {}) {
  const profile = process.argv[2];
  if (
    !profile ||
    !path.isAbsolute(profile) ||
    (!options.synthetic && process.env.SDSTUDIO_LIVE_VALIDATION !== '1')
  )
    throw Error('Use npm run nai:validate-live -- /absolute/private-profile');
  const repository = path.resolve(__dirname, '../..');
  const overlaps = (a, b) => {
    const r = path.relative(a, b);
    return (
      r === '' ||
      (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r))
    );
  };
  const canonical = (value) => {
    try {
      return fs.realpathSync(value);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(value);
      if (parent === value) throw Error('Invalid profile root');
      return path.join(canonical(parent), path.basename(value));
    }
  };
  const selected = canonical(profile);
  if (overlaps(repository, selected) || overlaps(selected, repository))
    throw Error('Choose a private profile outside the checkout');
  initializeForkProfile(app, selected);
  const candidate = require('../fixtures/nai-live-candidate.json');
  const offline =
    (process.env.SDSTUDIO_OFFLINE !== undefined &&
      process.env.SDSTUDIO_OFFLINE !== '0') ||
    process.env.SDSTUDIO_MOCK_BACKEND === '1';
  app
    .whenReady()
    .then(async () => {
      if (options.synthetic && options.prepare) await options.prepare();
      Menu.setApplicationMenu(null);
      const allowed = options.synthetic ? options.loopbackURL : IMAGE_ENDPOINT;
      session.defaultSession.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
        (details, callback) =>
          callback({
            cancel:
              offline || details.url !== allowed || details.method !== 'POST',
          }),
      );
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      const store = new NaiTokenStore(
        path.join(selected, 'auth/validation-token.v1.json'),
        safeStorage,
      );
      let metadata = {},
        controller,
        pending;
      const runner = new LiveValidation({
        profile: selected,
        request: candidate.request,
        ready: async () => {
          if (offline) throw new NaiError('OFFLINE');
          await store.read();
        },
        metadata: () => metadata,
        transport: (capture) =>
          new NaiTransport({
            session: session.defaultSession,
            offline: () => offline,
            token: () => store.read(),
            acceptZipSignature: true,
            observeResponse: (info) => {
              metadata = { ...info, contentType: mediaTypeBucket(info) };
            },
            diagnosticCapture: (result) => {
              capture(result.bytes);
              metadata.truncated = result.truncated;
              metadata.acceptedByZipSignature =
                result.acceptedByZipSignature === true;
            },
            request: (requestOptions) => {
              return net.request(
                options.synthetic
                  ? { ...requestOptions, url: allowed }
                  : requestOptions,
              );
            },
          }),
      });
      const expected = pathToFileURL(
        path.join(__dirname, 'nai-live-window.html'),
      ).href;
      const window = new BrowserWindow({
        width: 850,
        height: 900,
        minWidth: 390,
        minHeight: 600,
        webPreferences: {
          devTools: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: path.join(__dirname, 'nai-live-preload.cjs'),
        },
      });
      const trusted = (event) =>
        isTrustedAuthFrame(event, window.webContents, expected);
      registerNaiAuth(ipcMain, store, () => offline, trusted);
      const handle = (channel, action) =>
        ipcMain.handle(channel, async (event, ...args) => {
          try {
            if (!trusted(event)) throw new NaiError('UNTRUSTED_SENDER');
            return await action(...args);
          } catch (error) {
            return {
              ok: false,
              code:
                error instanceof NaiError || error instanceof ValidationError
                  ? error.code
                  : 'VALIDATION_FAILED',
            };
          }
        });
      handle('validation-status', async () => ({
        ok: true,
        status: {
          ...runner.status(),
          offline,
          tokenConfigured: (await store.status()).configured,
          candidate,
        },
      }));
      handle('validation-run', (evidence) => {
        if (pending) throw new ValidationError('ALREADY_USED');
        controller = new AbortController();
        pending = runner.run(evidence, controller.signal).finally(() => {
          pending = undefined;
          if (runner.status().used) store.lock();
        });
        return pending;
      });
      handle('validation-cancel', () => {
        controller?.abort();
        return { ok: true };
      });
      handle('validation-after', (balance) =>
        runner.recordAfterBalance(balance),
      );
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event, url) => {
        if (url !== expected) event.preventDefault();
      });
      window.on('close', (event) => {
        store.lock();
        if (pending) {
          event.preventDefault();
          controller.abort();
          pending
            .catch(() => {})
            .finally(() => {
              window.destroy();
              app.quit();
            });
        }
      });
      app.on('before-quit', () => store.lock());
      await window.loadURL(expected);
      if (options.onReady) await options.onReady({ window, runner, store });
    })
    .catch(() => {
      process.stderr.write(
        'Validation startup failed; private paths and details omitted.\n',
      );
      app.exit(1);
    });
  app.on('window-all-closed', () => app.quit());
}
module.exports = { start };
if (require.main === module) {
  try {
    start();
  } catch {
    process.stderr.write('Validation profile/startup settings rejected.\n');
    app.exit(1);
  }
}
