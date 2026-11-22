const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { BrowserWindow } = require('electron');
module.exports = async function (contents) {
  const checks = [],
    evaluate = (code) => contents.executeJavaScript(code),
    window = BrowserWindow.fromWebContents(contents);
  const until = async (code) => {
    for (let n = 0; n < 150; n++) {
      if (await evaluate(code)) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw Error('Project UI timeout: ' + code);
  };
  const click = async (selector) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await new Promise((r) => setTimeout(r, 35));
  };
  const fill = async (selector, value) => {
    await evaluate(
      `(()=>{const c=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(c instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(c,${JSON.stringify(value)});c.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await new Promise((r) => setTimeout(r, 35));
  };
  const saved = () =>
    until(
      "document.querySelector('[data-testid=project-dirty]')?.innerText === '저장됨'",
    );
  const list = async () => {
    const result = await evaluate('window.electron.projects.list()');
    assert.equal(result.ok, true);
    return result.value;
  };
  await until("!!document.querySelector('[data-testid=project-controls]')");
  const phase = process.env.SDSTUDIO_PROJECT_UI_PHASE;
  if (phase === 'reopen') {
    const projects = await list();
    assert.ok(projects.length >= 2);
    const target = projects.find((p) => p.name === 'synthetic-ui-copy');
    assert.ok(target);
    await click('[data-testid=project-list]');
    await until("document.querySelector('[data-testid=project-dialog]').open");
    await until(
      `!!document.querySelector('[data-project-open="${target.id}"]')`,
    );
    await click(`[data-project-open="${target.id}"]`);
    await saved();
    assert.equal(
      await evaluate(
        "document.querySelector('[data-testid=base-prompt]').value",
      ),
      'synthetic edited in UI',
    );
    checks.push('new PID opens saved three-scene input through the project UI');
    window.close(); // clean native close should finish without a project confirmation.
    // Caller arms will-quit before running this phase. No renderer calls follow close.
    return { checks, nativeCloseRequested: true };
  }
  await fill('[aria-label="프로젝트 이름"]', 'synthetic-ui-source');
  await fill('[data-testid=base-prompt]', 'synthetic edited in UI');
  await click('[data-testid=project-save]');
  await saved();
  let source = (await list()).find((p) => p.name === 'synthetic-ui-source');
  assert.ok(source);
  checks.push(
    'explicit UI save preserves the edited selected scene through worker IPC',
  );
  await fill('[data-testid=base-prompt]', 'unsaved change');
  await click('[data-testid=project-new]');
  await until("document.querySelector('[data-testid=project-confirm]').open");
  await click('[data-testid=project-confirm-cancel]');
  assert.equal(
    await evaluate("document.querySelector('[data-testid=base-prompt]').value"),
    'unsaved change',
  );
  await click('[data-testid=project-list]');
  await until(`!!document.querySelector('[data-project-open="${source.id}"]')`);
  await click(`[data-project-open="${source.id}"]`);
  await until("document.querySelector('[data-testid=project-confirm]').open");
  await click('[data-testid=project-confirm-discard]');
  await saved();
  assert.equal(
    await evaluate("document.querySelector('[data-testid=base-prompt]').value"),
    'synthetic edited in UI',
  );
  checks.push(
    'new/open dirty guard cancels without losing input and explicit discard restores saved input',
  );
  // Force a stale lock only in this disposable profile; the application must never remove it.
  const folder = path.join(
    process.env.SDSTUDIO_USER_DATA_DIR,
    'projects-v1',
    source.id,
  );
  fs.writeFileSync(
    path.join(folder, 'write.lock'),
    'synthetic interrupted writer',
  );
  await fill('[aria-label="프로젝트 이름"]', 'synthetic-ui-copy');
  await click('[data-testid=project-save]');
  await until(
    "document.querySelector('[data-testid=project-controls]').innerText.includes('잠금')",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(\'[aria-label="프로젝트 이름"]\').value',
    ),
    'synthetic-ui-copy',
  );
  await click('[data-testid=project-copy]');
  await saved();
  assert.equal(
    fs.readFileSync(path.join(folder, 'write.lock'), 'utf8'),
    'synthetic interrupted writer',
  );
  checks.push(
    'busy save keeps the current input and explicit new copy leaves the original lock untouched',
  );
  await fill('[data-testid=base-prompt]', 'native close unsaved');
  window.close();
  await until("document.querySelector('[data-testid=project-confirm]').open");
  await click('[data-testid=project-confirm-cancel]');
  assert.equal(window.isDestroyed(), false);
  assert.equal(
    await evaluate("document.querySelector('[data-testid=base-prompt]').value"),
    'native close unsaved',
  );
  checks.push(
    'actual native close waits for unsaved decision; cancel retains the live window',
  );
  await click('[data-testid=project-list]');
  await until("document.querySelector('[data-testid=project-dialog]').open");
  const copied = (await list()).find((p) => p.name === 'synthetic-ui-copy');
  await until(`!!document.querySelector('[data-project-open="${copied.id}"]')`);
  await click(`[data-project-open="${copied.id}"]`);
  await until("document.querySelector('[data-testid=project-confirm]').open");
  await click('[data-testid=project-confirm-discard]');
  await saved();
  // Create a prior revision, corrupt only current manifest, and recover through visible history controls.
  await fill('[aria-label="프로젝트 이름"]', 'synthetic-ui-newer');
  await click('[data-testid=project-save]');
  await saved();
  const copyFolder = path.join(
    process.env.SDSTUDIO_USER_DATA_DIR,
    'projects-v1',
    copied.id,
  );
  fs.writeFileSync(
    path.join(copyFolder, 'project.json'),
    '{synthetic corrupted',
  );
  await click('[data-testid=project-list]');
  await until(
    `!!document.querySelector('[data-project-history="${copied.id}"]')`,
  );
  await click(`[data-project-history="${copied.id}"]`);
  await until("!!document.querySelector('[data-project-recover]')");
  await click('[data-project-recover]');
  await saved();
  assert.equal(
    fs.readFileSync(path.join(copyFolder, 'project.json'), 'utf8'),
    '{synthetic corrupted',
  );
  checks.push(
    'visible history recovery creates a new copy while the corrupt source stays byte-identical',
  );
  if (process.env.SDSTUDIO_PROJECT_UI_SCREENSHOT)
    fs.writeFileSync(
      process.env.SDSTUDIO_PROJECT_UI_SCREENSHOT + '.desktop.png',
      (await contents.capturePage()).toPNG(),
    );
  window.setSize(390, 844);
  await until('innerWidth===390');
  assert.equal(
    await evaluate('document.documentElement.scrollWidth<=innerWidth'),
    true,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-testid=project-save]').getBoundingClientRect().right<=innerWidth",
    ),
    true,
  );
  checks.push('390px controls and dialogs stay within the window width');
  if (process.env.SDSTUDIO_PROJECT_UI_SCREENSHOT)
    fs.writeFileSync(
      process.env.SDSTUDIO_PROJECT_UI_SCREENSHOT,
      (await contents.capturePage()).toPNG(),
    );
  // Leave dirty, choose save in the native-close confirmation and let the real lifecycle quit.
  await fill('[aria-label="프로젝트 이름"]', 'synthetic-ui-copy');
  await fill('[data-testid=base-prompt]', 'synthetic edited in UI');
  return { checks, closeWithSave: true };
};
