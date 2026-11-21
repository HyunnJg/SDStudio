// Injected by the loopback inspector before each actual packaged entry.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { app, session } = require('electron');
const root = process.env.SDSTUDIO_MODE_SMOKE_ROOT;
if (!root) throw Error('Disposable network-mode test root required');
require('ts-node/register/transpile-only');
const journal = path.join(root, 'journey.json');
const state = fs.existsSync(journal)
  ? JSON.parse(fs.readFileSync(journal))
  : {
      phase: 0,
      pids: [],
      checks: [],
      relaunchCalls: 0,
      externalRequests: [],
      rendererErrors: [],
    };
state.pids.push(process.pid);
const phase = state.phase;
const save = () => fs.writeFileSync(journal, JSON.stringify(state, null, 2));
const done = (error) => {
  if (error) state.error = String(error);
  else state.done = true;
  save();
  app.exit(error ? 1 : 0);
};
app.requestSingleInstanceLock = () => true;
const relaunch = app.relaunch.bind(app);
app.relaunch = (options) => {
  assert.equal(options, undefined);
  const file = path.join(
    app.getPath('userData'),
    'SDStudio/projects/restart-fixture.json',
  );
  assert.equal(
    JSON.parse(fs.readFileSync(file)).scenes.default.meta.restartFixture,
    'saved-before-relaunch',
  );
  state.relaunchCalls++;
  state.checks.push('native relaunch requested only after V3 fixture save');
  save();
  // Preserve the same test-only inspector flags for the next native process.
  return relaunch({
    args: [
      `--inspect-brk=127.0.0.1:${process.env.SDSTUDIO_MODE_INSPECTOR_PORT}`,
      '--ozone-platform=x11',
      '--disable-gpu',
      '--password-store=basic',
    ],
  });
};
app.once('ready', () =>
  require('../../src/main/offlineNetwork').installOfflineRequestGuard(
    session.defaultSession,
  ),
);
app.on('web-contents-created', (_event, contents) => {
  const filter = {
    urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'],
  };
  const observe = (details) => {
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(
        new URL(details.url).hostname,
      )
    ) {
      state.externalRequests.push(details.url);
      save();
    }
  };
  contents.session.webRequest.onCompleted(filter, observe);
  contents.session.webRequest.onErrorOccurred(filter, observe);
  contents.on('console-message', (_event, level, message) => {
    if (level >= 3) {
      state.rendererErrors.push(message);
      save();
    }
  });
  contents.on('did-finish-load', async () => {
    try {
      const evaluate = (code) => contents.executeJavaScript(code);
      const until = async (code) => {
        for (let i = 0; i < 150; i++) {
          if (await evaluate(code)) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw Error('Timeout: ' + code);
      };
      const click = async (selector) => {
        await evaluate(
          `document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 30));
      };
      await until(`!!document.querySelector('[data-testid=open-nai-auth]')`);
      for (const name of [
        'SDSTUDIO_OFFLINE',
        'SDSTUDIO_MOCK_BACKEND',
        'SDSTUDIO_USER_DATA_DIR',
      ])
        assert.equal(process.env[name], undefined);
      assert.equal(app.isPackaged, true);
      state.packaged = true;
      assert.equal(
        app.getPath('userData'),
        path.join(root, 'app-data/SDStudio-HyunnJg'),
      );
      state.profile = app.getPath('userData');
      await click('[data-testid=open-nai-auth]');
      await until(
        `!!document.querySelector('dialog[open]') && !document.querySelector('[data-testid=network-mode-save]').matches(':disabled')`,
      );
      const pref = path.join(app.getPath('userData'), 'network-mode.v1.json');
      const tokenFile = path.join(
        app.getPath('userData'),
        'auth/novelai-token.v1.json',
      );
      assert.equal(fs.existsSync(tokenFile), false);
      const current = await evaluate('window.electron.networkMode.status()');
      assert.equal(current.ok, true);
      assert.equal(current.status.lockedReason, undefined);
      if (phase === 0) {
        assert.equal(current.status.current, 'offline');
        assert.equal(fs.existsSync(pref), false);
        state.checks.push(
          'environment-free first package launch is offline and settings are editable',
        );
        // Unsupported settings are kept until the dedicated confirmation path.
        const future = '{"version":99,"mode":"online"}';
        fs.writeFileSync(pref, future);
        await click('[aria-label="토큰 설정 닫기"]');
        await click('[data-testid=open-nai-auth]');
        await until(
          `!!document.querySelector('[data-testid=network-mode-reset]')`,
        );
        assert.equal(fs.readFileSync(pref, 'utf8'), future);
        await click('[data-testid=network-mode-reset]');
        await click('[data-testid=network-mode-cancel]');
        assert.equal(fs.readFileSync(pref, 'utf8'), future);
        await click('[data-testid=network-mode-reset]');
        await click('[data-testid=network-mode-confirm]');
        await until(
          `!document.querySelector('[data-testid=network-mode-reset]')`,
        );
        assert.equal(fs.existsSync(pref), false);
        state.checks.push(
          'future network settings require confirmed settings-only reset',
        );
        await click('#network-mode-online');
        await click('[data-testid=network-mode-save]');
        await until(
          `document.querySelector('[data-testid=network-mode-status]').textContent.includes('재시작 필요')`,
        );
        assert.equal(JSON.parse(fs.readFileSync(pref)).mode, 'online');
        assert.equal(
          (await evaluate('window.electron.networkMode.status()')).status
            .current,
          'offline',
        );
        assert.equal(
          await evaluate(
            `document.querySelector('[data-testid=nai-auth-save]').matches(':disabled')`,
          ),
          true,
        );
        state.checks.push(
          'saving online does not unlock current offline IPC or requests',
        );
        await click('[data-testid=network-mode-restart]');
        await click('[data-testid=network-mode-cancel]');
        assert.equal(state.relaunchCalls, 0);
        state.checks.push(
          'cancelled restart leaves the process and running mode unchanged',
        );
        // A save failure must not schedule a native relaunch.
        await evaluate(
          `window.__modeSave=window.sessionService.saveAll;window.sessionService.saveAll=async()=>{throw Error('synthetic save failure')};void 0`,
        );
        await click('[data-testid=network-mode-restart]');
        await click('[data-testid=network-mode-confirm]');
        await until(
          `document.querySelector('[data-testid=network-mode-error]')?.textContent.includes('저장')`,
        );
        assert.equal(state.relaunchCalls, 0);
        await evaluate(
          'window.sessionService.saveAll=window.__modeSave;void 0',
        );
        state.checks.push(
          'V3 save failure blocks relaunch without discarding the selected next mode',
        );
        // Stop/empty queue can still have a pending async run; use a synthetic promise, no backend call.
        await evaluate(
          `window.__modeRun=window.taskQueueService.runInternal;window.taskQueueService.runInternal=()=>new Promise(resolve=>{window.__releaseModeRun=resolve});window.taskQueueService.run();window.taskQueueService.stop()`,
        );
        assert.equal(await evaluate('window.taskQueueService.isEmpty()'), true);
        assert.equal(
          await evaluate('window.taskQueueService.hasActiveRun()'),
          true,
        );
        await click('[data-testid=network-mode-restart]');
        await click('[data-testid=network-mode-confirm]');
        await until(
          `document.querySelector('[data-testid=network-mode-error]')?.textContent.includes('작업')`,
        );
        assert.equal(state.relaunchCalls, 0);
        await evaluate(
          'window.__releaseModeRun();window.taskQueueService.runInternal=window.__modeRun;void 0',
        );
        await until('!window.taskQueueService.hasActiveRun()');
        state.checks.push(
          'stopped and cleared asynchronous V3 run blocks restart until its promise completes',
        );
        await evaluate(
          `(async()=>{window.sessionService.running=false;await window.sessionService.add('restart-fixture');window.sessionService.getFast('restart-fixture').scenes.get('default').meta.set('restartFixture','saved-before-relaunch')})()`,
        );
        const fixture = path.join(
          app.getPath('userData'),
          'SDStudio/projects/restart-fixture.json',
        );
        assert.equal(
          fs.readFileSync(fixture, 'utf8').includes('saved-before-relaunch'),
          false,
        );
        if (process.env.SDSTUDIO_MODE_SCREENSHOT)
          fs.writeFileSync(
            process.env.SDSTUDIO_MODE_SCREENSHOT,
            (await contents.capturePage()).toPNG(),
          );
        state.phase = 1;
        save();
        await click('[data-testid=network-mode-restart]');
        await click('[data-testid=network-mode-confirm]');
      } else if (phase === 1) {
        assert.equal(state.relaunchCalls, 1);
        assert.equal(current.status.current, 'online');
        assert.equal(state.pids.length, 2);
        assert.notEqual(state.pids[0], state.pids[1]);
        state.checks.push(
          'actual native child reads saved online mode without a mode environment variable',
        );
        await until(
          `!document.querySelector('[data-testid=nai-auth-save]').matches(':disabled')`,
        );
        await evaluate(
          `document.querySelector('#nai-token-input').value='synthetic-mode-token'`,
        );
        await click('[data-testid=nai-auth-save]');
        await until(
          `document.querySelector('[data-testid=nai-auth-status]').textContent.includes('이번 실행')`,
        );
        await click('[data-testid=nai-auth-check]');
        await until(
          `document.querySelector('[data-testid=nai-auth-notice]')?.textContent.includes('이 기기에서')`,
        );
        assert.equal(fs.existsSync(tokenFile), false);
        state.checks.push(
          'token input and local check work after restart, with no authentication/generation request',
        );
        await click('#network-mode-offline');
        await click('[data-testid=network-mode-save]');
        await until(
          `document.querySelector('[data-testid=network-mode-status]').textContent.includes('재시작 필요')`,
        );
        assert.equal(
          (await evaluate('window.electron.networkMode.status()')).status
            .current,
          'online',
        );
        state.phase = 2;
        save();
        await click('[data-testid=network-mode-restart]');
        await click('[data-testid=network-mode-confirm]');
      } else {
        assert.equal(state.relaunchCalls, 2);
        assert.equal(state.pids.length, 3);
        assert.equal(new Set(state.pids).size, 3);
        assert.equal(current.status.current, 'offline');
        assert.equal(current.status.pendingRestart, false);
        assert.equal(
          (await evaluate('window.electron.naiAuth.status()')).code,
          'OFFLINE',
        );
        assert.equal(
          await evaluate(
            `document.querySelector('[data-testid=nai-auth-save]').matches(':disabled')`,
          ),
          true,
        );
        const blocked = await evaluate(
          `(async()=>{const ops=[['download','https://example.invalid/x','tmp','x'],['spawn-local-ai'],['load-model','x'],['remove-bg','x','x'],['open-web-page','https://example.invalid/']];let n=0;for(const [op,...args]of ops){try{await window.electron.ipcRenderer.invoke(op,...args)}catch(error){if(error.message.includes('disabled in offline preview'))n++}}return n})()`,
        );
        assert.equal(blocked, 5);
        state.checks.push(
          'second native restart restores offline auth and all five dangerous IPC guards',
        );
        assert.equal(
          JSON.parse(
            fs.readFileSync(
              path.join(
                app.getPath('userData'),
                'SDStudio/projects/restart-fixture.json',
              ),
            ),
          ).scenes.default.meta.restartFixture,
          'saved-before-relaunch',
        );
        state.checks.push('V3 fixture survives both native restarts');
        assert.deepEqual(state.externalRequests, []);
        assert.deepEqual(state.rendererErrors, []);
        done();
      }
    } catch (error) {
      done(error);
    }
  });
});
process.on('uncaughtException', (error) => done(error));
process.on('unhandledRejection', (error) => done(error));
save();
