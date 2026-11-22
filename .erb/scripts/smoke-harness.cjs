const fs = require('node:fs');
const { app } = require('electron');
const singletonSimulated = process.env.SDSTUDIO_SMOKE_SKIP_SINGLETON === '1';
if (singletonSimulated) app.requestSingleInstanceLock = () => true;
const authUI = process.env.SDSTUDIO_SMOKE_AUTH_UI === '1';
if (authUI) {
  require('ts-node/register/transpile-only');
  app.once('ready', () =>
    require('../../src/main/offlineNetwork').installOfflineRequestGuard(
      require('electron').session.defaultSession,
    ),
  );
}
const resilience = process.env.SDSTUDIO_SMOKE_RESILIENCE;
const resilienceTest = resilience
  ? require('./project-resilience-smoke.cjs')
  : undefined;
resilienceTest?.install();
const external = [];
const errors = [];
let finished = false;
function finish(code, data = {}) {
  if (finished) return;
  finished = true;
  const report = {
    ...data,
    singleInstanceLockSimulated: singletonSimulated,
    externalRequests: external,
    rendererErrors: errors,
  };
  fs.writeFileSync(
    process.env.SDSTUDIO_SMOKE_REPORT,
    JSON.stringify(report, null, 2),
  );
  process.stdout.write(`[SDStudio smoke] ${JSON.stringify(report)}\n`);
  app.exit(code);
}
setTimeout(
  () => finish(1, { error: 'UI did not become ready within 30 seconds' }),
  30000,
).unref();
process.on('uncaughtException', (error) => finish(1, { error: error.message }));
process.on('unhandledRejection', (error) =>
  finish(1, { error: String(error) }),
);
app.on('web-contents-created', (_event, contents) => {
  const filter = {
    urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'],
  };
  const record = (details) => {
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(
        new URL(details.url).hostname,
      )
    )
      external.push(details.url);
  };
  contents.session.webRequest.onCompleted(filter, record);
  contents.session.webRequest.onErrorOccurred(filter, record);
  contents.on('console-message', (_event, level, message) => {
    if (level >= 3) errors.push(message);
  });
  contents.on('render-process-gone', (_event, details) =>
    resilience === 'crash' && resilienceTest.expectedCrash
      ? undefined
      : finish(1, { error: `Renderer exited: ${details.reason}` }),
  );
  contents.on('did-finish-load', async () => {
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await contents.executeJavaScript(`({
          ready: document.getElementById('root')?.children.length > 0,
          text: document.body.innerText,
          project: window.curSession?.name,
          offline: window.electron?.runtime.offline,
          mock: window.electron?.runtime.mockBackend
        })`);
        if (
          result.ready &&
          (result.offline || authUI) &&
          (process.env.SDSTUDIO_MOCK_BACKEND !== '1' || result.project)
        ) {
          if (authUI)
            result.authUI = await require('./auth-ui-smoke.cjs')(
              contents,
              result.offline,
            );
          if (!result.mock && !authUI) {
            result.blockedOperations =
              await contents.executeJavaScript(`(async () => {
              const calls = [
                ['download', 'https://example.invalid/fixture', 'tmp', 'fixture'],
                ['spawn-local-ai'], ['load-model', 'models/fixture'],
                ['remove-bg', 'fixture', 'outs/fixture.png'], ['open-web-page', 'https://example.invalid/']
              ];
              const blocked = [];
              for (const [operation, ...args] of calls) {
                try { await window.electron.ipcRenderer.invoke(operation, ...args); }
                catch (error) {
                  if (!error.message.includes('disabled in offline preview')) throw error;
                  blocked.push(operation);
                }
              }
              if (blocked.length !== calls.length) throw new Error('An offline operation was permitted');
              return blocked;
            })()`);
          }
          if (result.mock && resilience) {
            let report;
            app.once('will-quit', () =>
              finish(external.length || errors.length ? 1 : 0, {
                resilience: report,
                nativeQuitObserved: true,
                ...result,
                text: undefined,
              }),
            );
            report = await resilienceTest.exercise(contents, resilience);
            setImmediate(() =>
              require('electron')
                .BrowserWindow.fromWebContents(contents)
                .close(),
            );
            return;
          }
          if (result.mock && process.env.SDSTUDIO_SMOKE_PROJECTS === '1') {
            let projectUI;
            app.once('will-quit', () =>
              finish(external.length || errors.length ? 1 : 0, {
                projectUI,
                nativeQuitObserved: true,
                ...result,
                text: undefined,
              }),
            );
            projectUI = await require('./project-ui-smoke.cjs')(contents);
            if (projectUI.closeWithSave) {
              require('electron')
                .BrowserWindow.fromWebContents(contents)
                .close();
              for (let n = 0; n < 100; n++) {
                if (
                  await contents.executeJavaScript(
                    "document.querySelector('[data-testid=project-confirm]')?.open",
                  )
                )
                  break;
                await new Promise((resolve) => setTimeout(resolve, 20));
              }
              await contents.executeJavaScript(
                "document.querySelector('[data-testid=project-confirm-save]').click()",
              );
            }
            return;
          }
          if (result.mock && process.env.SDSTUDIO_SMOKE_WORKSPACE === '1') {
            result.workspace = await require('./workspace-smoke.cjs')(contents);
            if (process.env.SDSTUDIO_SMOKE_AUTH_PREVIEW === '1')
              result.previewAuth = await require('./auth-ui-smoke.cjs')(
                contents,
                result.offline,
              );
          }
          if (result.mock && process.env.SDSTUDIO_SMOKE_WORKSPACE !== '1') {
            result.generation = await contents.executeJavaScript(`(async () => {
              const queue = window.taskQueueService;
              const session = window.curSession;
              const scene = session.scenes.get('default');
              let output;
              await new Promise((resolve, reject) => {
                queue.addEventListener('complete', resolve, { once: true });
                queue.addEventListener('error', (event) => reject(new Error(event.detail.error)), { once: true });
                queue.addTask({ session, scene, outputPath: 'outs/preview/default', nodelay: true,
                  onComplete: (name) => { output = name; },
                  job: { type: 'sd', prompt: { type: 'text', text: 'synthetic preview' }, uc: '',
                    vibes: [], seed: 42, sampling: 'k_euler_ancestral', steps: 28,
                    promptGuidance: 5, cfgRescale: 0, noiseSchedule: 'native', smea: false, dyn: false }
                }, 1);
                queue.run();
              });
              const image = await window.imageService.fetchImage(output);
              if (!image?.startsWith('data:image/png;base64,')) throw new Error('Preview generation did not produce a PNG');
              return { completed: true, fixturePNG: true };
            })()`);
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (process.env.SDSTUDIO_SMOKE_SCREENSHOT && !result.workspace)
            fs.writeFileSync(
              process.env.SDSTUDIO_SMOKE_SCREENSHOT,
              (await contents.capturePage()).toPNG(),
            );
          finish(external.length || errors.length ? 1 : 0, {
            ...result,
            text: result.text.slice(0, 500),
          });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      finish(1, { error: 'Renderer loaded but application did not mount' });
    } catch (error) {
      finish(1, { error: error.message, stack: error.stack });
    }
  });
});
