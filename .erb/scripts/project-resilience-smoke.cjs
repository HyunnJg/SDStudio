// Test-only fault injection, loaded before production entry by the package inspector.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
let worker;
let dialogs = [];
exports.expectedCrash = false;
exports.install = () => {
  const threads = require('node:worker_threads');
  const Original = threads.Worker;
  threads.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      worker = this;
    }
  };
  electron.dialog.showMessageBox = async (_window, options) => {
    assert.deepEqual(options.buttons.slice(1), ['저장하지 않고 닫기']);
    assert.equal(options.defaultId, 0);
    assert.equal(options.cancelId, 0);
    dialogs.push(options.title);
    return { response: dialogs.length === 1 ? 0 : 1 };
  };
};
exports.exercise = async (contents, mode) => {
  const window = electron.BrowserWindow.fromWebContents(contents);
  const checks = [];
  const pause = () => new Promise((r) => setTimeout(r, 30));
  const evaluate = (code) => contents.executeJavaScript(code);
  const until = async (test) => {
    for (let i = 0; i < 150; i++) {
      if (await test()) return;
      await pause();
    }
    throw Error('Resilience smoke timeout');
  };
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const fill = async (value) => {
    await evaluate(
      `(()=>{const c=document.querySelector('[data-testid=base-prompt]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(c,${JSON.stringify(value)});c.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await pause();
  };
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=project-save]')"),
  );
  await click('[data-testid=project-save]');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=project-dirty]').innerText==='저장됨'",
    ),
  );
  const listed = await evaluate('window.electron.projects.list()');
  assert.equal(listed.ok, true);
  const manifest = path.join(
    process.env.SDSTUDIO_USER_DATA_DIR,
    'projects-v1',
    listed.value[0].id,
    'project.json',
  );
  const before = fs.readFileSync(manifest);
  await fill('synthetic unsaved resilience input');
  if (mode === 'worker') {
    assert.ok(worker);
    await worker.terminate();
    await pause();
    window.close();
    await until(() =>
      evaluate("document.querySelector('[data-testid=project-confirm]')?.open"),
    );
    await click('[data-testid=project-confirm-save]');
    await until(() =>
      evaluate(
        "!!document.querySelector('[data-testid=restart-project-storage-confirm]')",
      ),
    );
    assert.equal(window.isDestroyed(), false);
    assert.deepEqual(fs.readFileSync(manifest), before);
    checks.push(
      'terminated real worker returns stopped error; failed close-save keeps window and original manifest',
    );
    await click('[data-testid=restart-project-storage-confirm]');
    await until(() =>
      evaluate(
        "!document.querySelector('[data-testid=restart-project-storage-confirm]') && !document.querySelector('[data-testid=project-confirm-cancel]').disabled",
      ),
    );
    assert.deepEqual(fs.readFileSync(manifest), before);
    assert.equal(
      await evaluate(
        "document.querySelector('[data-testid=base-prompt]').value",
      ),
      'synthetic unsaved resilience input',
    );
    checks.push(
      'explicit storage restart keeps input and never replays failed save',
    );
    await click('[data-testid=project-confirm-cancel]');
    await until(() =>
      evaluate(
        "!document.querySelector('[data-testid=project-save]').disabled",
      ),
    );
    await click('[data-testid=project-save]');
    await until(() =>
      evaluate(
        "document.querySelector('[data-testid=project-dirty]').innerText==='저장됨'",
      ),
    );
    assert.notDeepEqual(fs.readFileSync(manifest), before);
    checks.push(
      'new explicit save after restart succeeds through replacement worker',
    );
  } else {
    if (mode === 'crash') {
      exports.expectedCrash = true;
      const gone = new Promise((resolve) =>
        contents.once('render-process-gone', resolve),
      );
      contents.forcefullyCrashRenderer();
      await gone;
      checks.push('real renderer crash observed');
    } else {
      window.emit('unresponsive');
      checks.push('synthetic unresponsive event enters native close path');
    }
    window.close();
    await until(() => dialogs.length === 1);
    await pause();
    assert.equal(window.isDestroyed(), false);
    assert.deepEqual(fs.readFileSync(manifest), before);
    checks.push('native dialog cancel/wait retains window and saved bytes');
    // Caller requests another real close after report assignment; simulated user then chooses discard.
  }
  return {
    mode,
    checks,
    nativeDialogSelectionsSimulated: mode !== 'worker',
    dialogs,
  };
};
