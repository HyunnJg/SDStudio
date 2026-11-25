// Synthetic File/drag injection into the real renderer; requests go only to the loopback harness.
const assert = require('node:assert/strict');
const { BrowserWindow } = require('electron');
const { png } = require('../../src/__tests__/fixtures/nai/png.cjs');
module.exports = async ({ contents, evaluate, click, fill, until, checks, requestCount, setLock }) => {
  const selected = await evaluate("window.electron.naiAuth.setToken('synthetic-never-a-real-token', false)");
  assert.equal(selected.ok, true);
  await fill('[data-testid=live-prompt]', 'synthetic reference illustration');
  const data = JSON.stringify(Array.from(png()));
  await evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(${data})],'synthetic-reference.png',{type:'image/png'}));const c=document.querySelector('[data-testid=reference-file]');c.files=d.files;c.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(() => evaluate("document.querySelector('[data-testid=reference-panel] img')?.naturalWidth>0"));
  assert.equal(requestCount(), 0);
  assert.equal(await evaluate("!!document.querySelector('[data-testid=metadata-dialog]')?.open"), false);
  assert.ok((await evaluate("document.querySelector('[data-testid=reference-panel]').textContent")).includes('5 Anlas'));
  checks.push('visible reference chooser creates a local crop preview and cost notice without uploading or opening metadata import');
  await evaluate("(()=>{const c=document.querySelector('[data-testid=reference-role]');c.value='style';c.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await fill('[data-testid=reference-strength]', '2.5');
  // Dropping on the reference card replaces only the image and keeps its role/strength.
  await evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(${data})],'replacement.png',{type:'image/png'}));document.querySelector('[data-testid=reference-panel]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d}));})()`);
  await until(() => evaluate("document.querySelector('[data-testid=reference-panel] img')?.naturalWidth>0 && !document.querySelector('[data-testid=prepare-generation]').matches(':disabled')"));
  assert.equal(await evaluate("document.querySelector('[data-testid=reference-role]').value"), 'style');
  assert.equal(await evaluate("document.querySelector('[data-testid=reference-strength]').value"), '2.5');
  checks.push('reference-card drop is local and preserves role/strength rather than opening the metadata importer');

  await until(() => evaluate("!document.querySelector('[data-testid=prepare-generation]').matches(':disabled')"));
  await click('[data-testid=prepare-generation]');
  await until(() => evaluate("document.querySelector('[data-testid=generated-png]')?.naturalWidth===2"));
  const list = (await evaluate('window.electron.projects.list()')).value;
  const result = (await evaluate(`window.electron.projects.open('${list[0].id}')`)).value;
  assert.equal(result.project.version, 5); assert.equal(result.project.images.length, 1);
  assert.equal(result.project.images[0].binding.id, 'nai-v5-reference-v1');
  assert.equal(result.project.images[0].draft.reference.role, 'style');
  assert.equal(result.project.images[0].draft.reference.strength, 2.5);
  checks.push('one-click reference generation uses the real main transport/worker and persists v5 result/reference snapshot');
  if (process.env.SDSTUDIO_REFERENCE_SCREENSHOT) {
    const win = BrowserWindow.fromWebContents(contents); win.setSize(1440, 950);
    await until(() => evaluate('innerWidth===1440'));
    await evaluate("document.querySelector('[data-testid=reference-panel]').scrollIntoView({block:'center'})");
    await new Promise((resolve) => setTimeout(resolve, 150));
    require('node:fs').writeFileSync(process.env.SDSTUDIO_REFERENCE_SCREENSHOT, (await contents.capturePage()).toPNG());
  }
  setLock(result.project.id);
  await evaluate("[...document.querySelectorAll('.connected-sidebar-tabs button')].find(b=>b.textContent==='씬·대기열').click()");
  await click('[aria-controls=live-queue-details]');
  await until(() => evaluate("document.querySelectorAll('[data-testid=connected-queue] input[type=checkbox]').length>0"));
  // Existing queue selector uses scene IDs; choose only the current scene.
  const selection = await evaluate("[...document.querySelectorAll('input[data-queue-scene]')].map(e=>({id:e.dataset.queueScene,checked:e.checked}))");
  if (selection.length) {
    await click(`[data-queue-scene="${result.project.selectedSceneId}"]`);
  } else {
    await click('[data-testid=connected-queue] input[type=checkbox]');
  }
  await click('[data-testid=prepare-live-queue]');
  await until(() => evaluate("!!document.querySelector('[data-testid=queue-confirm]')"));
  assert.ok((await evaluate("document.querySelector('[data-testid=queue-confirm]').textContent")).includes('참조 1장'));
  assert.ok((await evaluate("document.querySelector('[data-testid=queue-reference-cost]').textContent")).includes('5 Anlas'));
  await click('[data-testid=send-live-queue]');
  await until(() => evaluate("!!document.querySelector('[data-testid=save-result-new-project]')"));
  assert.equal(requestCount(), 3);
  await click('[data-testid=save-result-new-project]');
  await until(async () => !(await evaluate('window.electron.generation.status()')).value.pending);
  assert.equal(requestCount(), 3);
  const copied = (await evaluate('window.electron.projects.list()')).value.find((p) => p.name.includes('(이번 결과)'));
  assert.ok(copied);
  const copy = (await evaluate(`window.electron.projects.open('${copied.id}')`)).value;
  assert.equal(copy.project.version, 5); assert.equal(copy.project.images.length, 1);
  assert.equal((await evaluate(`window.electron.generation.referenceImage('${copied.id}', '${copy.project.selectedSceneId}')`)).ok, true);
  checks.push('queue confirmation includes reference settings/cost; third synthetic response save failure recovers PNG and reference to a new project without a fourth request');
  const win = BrowserWindow.fromWebContents(contents); win.setMinimumSize(390,400); win.setSize(390,780);
  await until(() => evaluate('innerWidth===390'));
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  checks.push('reference card and preview fit the390px input panel');
};
