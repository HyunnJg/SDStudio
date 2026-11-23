// Test only: real app/preload/transport/worker, synthetic token and loopback ZIP response.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const http = require('node:http');
const { app, net, session, BrowserWindow, ipcMain } = require('electron');
const { png } = require('../../src/__tests__/fixtures/nai/png.cjs');
const JSZip = require('jszip');
const expectedPNG = png();
const phase = process.env.SDSTUDIO_GENERATION_PHASE;
const profile = process.env.SDSTUDIO_USER_DATA_DIR;
const checks = [],
  remote = [],
  errors = [];
let firstRequestHash;
let requests = 0,
  lock,
  loopback,
  completed = false;
app.requestSingleInstanceLock = () => true;
let pauseStatus = false;
const delayedStatus = [];
const releaseStatus = () => {
  pauseStatus = false;
  delayedStatus.splice(0).forEach((resolve) => resolve());
};
if (phase === 'queue-errors') {
  const realTimeout = global.setTimeout;
  // Test only: shorten the product90s network deadline without changing production options.
  global.setTimeout = (callback, delay, ...args) =>
    realTimeout(
      callback,
      delay >= 85000 && delay <= 90000 ? 900 : delay,
      ...args,
    );
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    handle(channel, async (...args) => {
      const value = await listener(...args);
      if (
        pauseStatus &&
        [
          'workspace-generation-status',
          'workspace-generation-queue-status',
        ].includes(channel)
      )
        await new Promise((resolve) => delayedStatus.push(resolve));
      return value;
    });
}
const archive = new JSZip();
archive.file('image.png', expectedPNG);
const payload = archive.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  streamFiles: true,
});
const server = http.createServer(async (request, response) => {
  requests++;
  const number = requests;
  assert.equal(
    request.headers.authorization,
    'Bearer synthetic-never-a-real-token',
  );
  let body = '';
  for await (const chunk of request) body += chunk;
  if (requests === 1)
    firstRequestHash = require('node:crypto')
      .createHash('sha256')
      .update(body)
      .digest('hex');
  const parsed = JSON.parse(body);
  assert.equal(parsed.model, 'nai-diffusion-4-5-full');
  assert.equal(parsed.parameters.n_samples, 1);
  if (phase === 'queue-errors') {
    if (number === 1) {
      response.writeHead(429);
      response.end('synthetic rate limit');
      return;
    }
    if (number === 3) {
      pauseStatus = true;
      return;
    } // Deliberately stall until the shortened test deadline.
    if (number === 4) {
      pauseStatus = true;
      fs.writeFileSync(lock, 'synthetic interrupted writer');
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (!response.destroyed) {
      response.writeHead(200, { 'Content-Type': 'binary/octet-stream' });
      response.end(await payload);
    }
    return;
  }
  if (number === (phase === 'queue' ? 13 : 3))
    fs.writeFileSync(lock, 'synthetic interrupted writer');
  await new Promise((r) =>
    setTimeout(r, number === (phase === 'queue' ? 7 : 2) ? 1200 : 150),
  );
  if (response.destroyed) return;
  response.writeHead(200, { 'Content-Type': 'binary/octet-stream' });
  response.end(await payload);
});
const originalRequest = net.request.bind(net);
net.request = (options) => {
  assert.equal(options.url, 'https://image.novelai.net/ai/generate-image');
  assert.equal(options.session, session.defaultSession);
  assert.equal(options.method, 'POST');
  assert.ok(loopback);
  return originalRequest({ ...options, url: loopback });
};
app.once('ready', async () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const allowed = new URL(details.url).hostname === '127.0.0.1';
      if (!allowed) remote.push('blocked-remote-request');
      callback({ cancel: !allowed });
    },
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  loopback = `http://127.0.0.1:${server.address().port}/fixture`;
});
function finish(code, error) {
  if (completed) return;
  completed = true;
  const report = {
    phase,
    ready: !error,
    checks,
    loopbackRequests: requests,
    actualAccountRequests: 0,
    externalRequests: remote,
    rendererErrors: errors,
    singleInstanceLockSimulated: true,
    nativeQuitObserved: !error,
    ...(error ? { error: String(error) } : {}),
  };
  fs.writeFileSync(
    process.env.SDSTUDIO_SMOKE_REPORT,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  app.exit(code);
}
setTimeout(() => finish(1, 'Generation smoke timeout'), 40000).unref();
process.on('uncaughtException', (error) => finish(1, error.stack));
process.on('unhandledRejection', (error) => finish(1, error.stack));
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message);
  });
  contents.on('render-process-gone', () =>
    finish(1, 'Unexpected renderer exit'),
  );
  contents.once('did-finish-load', async () => {
    const evaluate = (code) => contents.executeJavaScript(code);
    const pause = () => new Promise((r) => setTimeout(r, 30));
    const until = async (test) => {
      for (let n = 0; n < 250; n++) {
        if (await test()) return;
        await pause();
      }
      throw Error('Generation UI wait: ' + String(test));
    };
    const click = async (selector) => {
      await evaluate(
        `document.querySelector(${JSON.stringify(selector)}).click()`,
      );
      await pause();
    };
    const fill = async (selector, value) => {
      await evaluate(
        `(()=>{const c=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(c.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(c,${JSON.stringify(value)});c.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await pause();
    };
    try {
      await until(() =>
        evaluate("!!document.querySelector('[data-testid=open-preview]')"),
      );
      await click('[data-testid=open-preview]');
      await until(() =>
        evaluate(
          "!!document.querySelector('[data-testid=connected-workspace]')",
        ),
      );
      if (phase === 'queue-errors') {
        const set = await evaluate(
          "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
        );
        assert.equal(set.ok, true);
        await click('[aria-controls=live-queue-details]');
        await evaluate(
          "document.querySelectorAll('[data-queue-scene]').forEach(c=>c.click())",
        );
        await fill('#live-repeats', '2');
        const confirm = async () => {
          await until(() =>
            evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
          );
          assert.equal(
            await evaluate(
              "document.querySelector('[data-testid=send-live-queue]').disabled",
            ),
            true,
          );
          await click('[data-testid=queue-cost-confirm]');
          await click('[data-testid=send-live-queue]');
        };
        await click('[data-testid=prepare-live-queue]');
        assert.equal(requests, 0);
        await confirm();
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generation-status]').innerText.includes('요청 한도')",
          ),
        );
        assert.equal(requests, 1);
        checks.push(
          'first429 stops the reservation without retrying and exposes the current stop item',
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=resume-live-queue]').matches(':disabled')",
          ),
        );
        await click('[data-testid=resume-live-queue]');
        await confirm();
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generation-status]').innerText.includes('응답 기한')",
          ),
        );
        assert.equal(requests, 3);
        assert.equal(pauseStatus, true);
        assert.ok(
          !(
            await evaluate(
              "document.querySelector('[data-testid=generation-status]').innerText",
            )
          ).includes('요청 한도'),
        );
        checks.push(
          'while status polling is held, direct runQueue result displays later TIMEOUT rather than historic429',
        );
        releaseStatus();
        const listing = (await evaluate('window.electron.projects.list()'))
            .value,
          id = listing[0].id;
        const manifest = path.join(profile, 'projects-v1', id, 'project.json');
        lock = path.join(profile, 'projects-v1', id, 'write.lock');
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=resume-live-queue]').matches(':disabled')",
          ),
        );
        await click('[data-testid=resume-live-queue]');
        await confirm();
        await until(() =>
          evaluate(
            "!!document.querySelector('[data-testid=retry-result-save]') && !document.querySelector('[data-testid=retry-result-save]').disabled",
          ),
        );
        assert.equal(pauseStatus, true);
        assert.equal(requests, 4);
        assert.ok(
          (
            await evaluate(
              "document.querySelector('[data-testid=generation-status]').innerText",
            )
          ).includes('PNG는 받았지만'),
        );
        checks.push(
          'new result-pending and usable save-only recovery appear immediately despite historical429/TIMEOUT and held status polling',
        );
        releaseStatus();
        await click('[data-testid=save-result-new-project]');
        await until(
          async () =>
            (await evaluate('window.electron.projects.list()')).value.length ===
            2,
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=project-save]').matches(':disabled')",
          ),
        );
        assert.equal(requests, 4);
        assert.equal(JSON.parse(fs.readFileSync(manifest)).images.length, 1);
        assert.equal(
          fs.readFileSync(lock, 'utf8'),
          'synthetic interrupted writer',
        );
        checks.push(
          'result-only new project storage sends no fifth request and preserves the original lock/PNG',
        );
        // Local conflict exclusion: four untransmitted jobs, two are for the changed scene.
        await click('[aria-controls=live-queue-details]');
        await evaluate(
          "document.querySelectorAll('[data-queue-scene]').forEach((c,i)=>{if(c.checked!==(i<2))c.click()})",
        );
        await fill('#live-repeats', '2');
        await click('[data-testid=prepare-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );
        await evaluate(
          "Array.from(document.querySelectorAll('[data-testid=queue-confirm] button')).find(b=>b.innerText.includes('취소')).click()",
        );
        await until(() =>
          evaluate(
            "!document.querySelector('#live-scene').matches(':disabled')",
          ),
        );
        await evaluate(
          "(()=>{const c=document.querySelector('#live-scene');c.value=c.options[1].value;c.dispatchEvent(new Event('change',{bubbles:true}));})()",
        );
        await pause();
        await fill(
          '[data-testid=live-prompt]',
          'synthetic changed input for exclusion',
        );
        await click('[data-testid=resume-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-conflict]')"),
        );
        assert.equal(
          await evaluate(
            "document.querySelector('[data-testid=exclude-conflict-scene]').disabled",
          ),
          true,
        );
        assert.ok(
          (
            await evaluate(
              "document.querySelector('[data-testid=queue-conflict]').innerText",
            )
          ).includes('2건'),
        );
        assert.equal(requests, 4);
        await click('[data-testid=exclude-conflict-confirm]');
        await click('[data-testid=exclude-conflict-scene]');
        await until(() =>
          evaluate("!document.querySelector('[data-testid=queue-conflict]')"),
        );
        const excluded = (
          await evaluate('window.electron.generation.queueStatus()')
        ).value.queue;
        assert.equal(
          excluded.items.filter((item) => item.status === 'skipped').length,
          2,
        );
        assert.equal(
          excluded.items.filter((item) => item.status === 'pending').length,
          2,
        );
        assert.equal(
          await evaluate(
            "document.querySelector('[data-testid=live-prompt]').value",
          ),
          'synthetic changed input for exclusion',
        );
        assert.equal(requests, 4);
        checks.push(
          'explicit count2 exclusion removes only conflicting unsent jobs, keeps edited input and PNGs and sends zero requests',
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=resume-live-queue]').matches(':disabled')",
          ),
        );
        await click('[data-testid=resume-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );
        assert.ok(
          (
            await evaluate(
              "document.querySelector('[data-testid=queue-confirm]').innerText",
            )
          ).includes('총 2회'),
        );
        assert.equal(
          await evaluate(
            "document.querySelector('[data-testid=send-live-queue]').disabled",
          ),
          true,
        );
        assert.equal(requests, 4);
        await evaluate(
          "Array.from(document.querySelectorAll('[data-testid=queue-confirm] button')).find(b=>b.innerText.includes('취소')).click()",
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=clear-live-queue]').matches(':disabled')",
          ),
        );
        await click('[data-testid=clear-live-queue]');
        checks.push(
          'other unsent jobs require fresh2-request confirmation after exclusion; cancel/clear never transmits',
        );
        const window = BrowserWindow.fromWebContents(contents);
        window.setMinimumSize(360, 500);
        window.setSize(390, 844);
        await until(() => evaluate('innerWidth===390'));
        assert.equal(
          await evaluate('document.documentElement.scrollWidth<=innerWidth'),
          true,
        );
        checks.push(
          '390px controls remain within the viewport after failure/recovery/exclusion',
        );
      } else if (phase === 'queue') {
        const set = await evaluate(
          "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
        );
        assert.equal(set.ok, true);
        await click('[aria-controls=live-queue-details]');
        await evaluate(
          "document.querySelectorAll('[data-queue-scene]').forEach(c=>c.click())",
        );
        await fill('#live-repeats', '2');
        await click('[data-testid=prepare-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );
        assert.equal(requests, 0);
        assert.equal(
          await evaluate(
            "document.querySelector('[data-testid=send-live-queue]').disabled",
          ),
          true,
        );
        assert.ok(
          (
            await evaluate(
              "document.querySelector('[data-testid=queue-confirm]').innerText",
            )
          ).includes('총 6회'),
        );
        const reserved = (
          await evaluate('window.electron.generation.queueStatus()')
        ).value.queue;
        assert.equal(reserved.items.length, 6);
        assert.equal(new Set(reserved.items.map((i) => i.seed)).size, 6);
        checks.push(
          'selected3 scenes x2 prepare sends0; confirmation shows6 requests, fixed settings and six resolved random seeds',
        );
        await click('[data-testid=queue-cost-confirm]');
        await click('[data-testid=send-live-queue]');
        await until(
          async () =>
            requests === 6 &&
            !(await evaluate('window.electron.generation.status()')).value
              .active,
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=prepare-generation]').matches(':disabled')",
          ),
        );
        const listing = (await evaluate('window.electron.projects.list()'))
          .value;
        const id = listing[0].id,
          manifest = path.join(profile, 'projects-v1', id, 'project.json');
        lock = path.join(profile, 'projects-v1', id, 'write.lock');
        const saved = JSON.parse(fs.readFileSync(manifest));
        assert.equal(saved.images.length, 6);
        assert.deepEqual(
          saved.images.map((i) => i.sceneId),
          reserved.items.map((i) => i.sceneId),
        );
        assert.deepEqual(
          saved.images.map((i) => i.seed),
          reserved.items.map((i) => i.seed),
        );
        saved.images.forEach((i) =>
          assert.deepEqual(
            fs.readFileSync(
              path.join(
                profile,
                'projects-v1',
                id,
                'images',
                i.sha256 + '.png',
              ),
            ),
            expectedPNG,
          ),
        );
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generated-png]')?.naturalWidth===2",
          ),
        );
        checks.push(
          'real session transport/ASAR-compatible worker stores6 original PNG records in repetition-first order with the confirmed seeds',
        );
        const window = BrowserWindow.fromWebContents(contents);
        window.setSize(1280, 800);
        await until(() => evaluate('innerWidth===1280'));
        if (process.env.SDSTUDIO_GENERATION_SCREENSHOT)
          fs.writeFileSync(
            process.env.SDSTUDIO_GENERATION_SCREENSHOT + '.desktop.png',
            (await contents.capturePage()).toPNG(),
          );
        await click('[aria-controls=live-queue-details]');
        await until(() =>
          evaluate("!document.querySelector('#live-queue-details').hidden"),
        );
        const firstCheckboxes = await evaluate(
          "Array.from(document.querySelectorAll('[data-queue-scene]')).map(c=>c.checked)",
        );
        if (!firstCheckboxes.every(Boolean))
          await evaluate(
            "document.querySelectorAll('[data-queue-scene]').forEach(c=>{if(!c.checked)c.click()})",
          );
        await click('[data-testid=prepare-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );
        await click('[data-testid=queue-cost-confirm]');
        await click('[data-testid=send-live-queue]');
        await until(() => requests === 7);
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=stop-live-queue]')"),
        );
        await click('[data-testid=stop-live-queue]');
        await until(
          async () =>
            !(await evaluate('window.electron.generation.status()')).value
              .active,
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=resume-live-queue]').matches(':disabled')",
          ),
        );
        const stopped = (
          await evaluate('window.electron.generation.queueStatus()')
        ).value.queue;
        assert.equal(stopped.items[0].status, 'failed');
        assert.equal(stopped.items[0].error.mayHaveReachedServer, true);
        assert.equal(
          stopped.items.filter((i) => i.status === 'pending').length,
          5,
        );
        assert.equal(requests, 7);
        checks.push(
          'stop aborts the one in-flight request; five unsent tasks remain and no automatic eighth request starts',
        );
        // Regression: merely viewing a different scene and renaming the project must not invalidate unsent input.
        const changedScene = stopped.items[1].sceneId;
        await evaluate(
          `(()=>{const c=document.querySelector('#live-scene');c.value=${JSON.stringify(changedScene)};c.dispatchEvent(new Event('change',{bubbles:true}));})()`,
        );
        await pause();
        await fill('#workspace-project-name', 'renamed synthetic project');
        const originalPrompt = await evaluate(
          "document.querySelector('[data-testid=live-prompt]').value",
        );
        await fill(
          '[data-testid=live-prompt]',
          'synthetic changed reserved input',
        );
        await click('[data-testid=resume-live-queue]');
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generation-status]').innerText.includes('예약한 씬')",
          ),
        );
        const conflictMessage = await evaluate(
          "document.querySelector('[data-testid=generation-status]').innerText",
        );
        assert.ok(conflictMessage.includes(stopped.items[1].sceneName));
        assert.equal(requests, 7);
        const stillPending = (
          await evaluate('window.electron.generation.queueStatus()')
        ).value.queue;
        assert.equal(
          stillPending.items.filter((item) => item.status === 'pending').length,
          5,
        );
        checks.push(
          'changed reserved draft displays the local scene name, sends0 extra requests and preserves all5 unsent tasks',
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=resume-live-queue]').matches(':disabled')",
          ),
        );
        await fill('[data-testid=live-prompt]', originalPrompt);
        await click('[data-testid=resume-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );
        assert.ok(
          (
            await evaluate(
              "document.querySelector('[data-testid=queue-confirm]').innerText",
            )
          ).includes('총 5회'),
        );
        assert.equal(requests, 7);
        assert.equal(
          await evaluate(
            "document.querySelector('[data-testid=send-live-queue]').disabled",
          ),
          true,
        );
        checks.push(
          'restored draft permits5-task reconfirmation despite project rename and a different viewed scene; confirmed seeds stay unchanged',
        );
        await click('[data-testid=queue-cost-confirm]');
        await click('[data-testid=send-live-queue]');
        await until(
          async () =>
            requests === 12 &&
            !(await evaluate('window.electron.generation.status()')).value
              .active,
        );
        assert.equal(JSON.parse(fs.readFileSync(manifest)).images.length, 11);
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=prepare-live-queue]').matches(':disabled')",
          ),
        );
        checks.push(
          'fresh5-request confirmation resumes only unsent tasks; the cancelled request is not retried and11 PNG records remain',
        );
        // Prepare one task; the test server leaves a synthetic lock after request13 reaches it.
        await evaluate(
          "document.querySelectorAll('[data-queue-scene]').forEach((c,i)=>{if(c.checked!==(i===0))c.click()})",
        );
        await fill('#live-repeats', '1');
        await click('[data-testid=prepare-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );
        await click('[data-testid=queue-cost-confirm]');
        await click('[data-testid=send-live-queue]');
        await until(() =>
          evaluate(
            "!!document.querySelector('[data-testid=retry-result-save]') && !document.querySelector('[data-testid=retry-result-save]').disabled",
          ),
        );
        assert.equal(requests, 13);
        assert.equal(
          (await evaluate('window.electron.generation.status()')).value.pending,
          true,
        );
        await click('[data-testid=save-result-new-project]');
        await until(
          async () =>
            (await evaluate('window.electron.projects.list()')).value.length ===
            2,
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=project-save]').matches(':disabled')",
          ),
        );
        assert.equal(requests, 13);
        assert.equal(JSON.parse(fs.readFileSync(manifest)).images.length, 11);
        assert.equal(
          fs.readFileSync(lock, 'utf8'),
          'synthetic interrupted writer',
        );
        checks.push(
          'received PNG survives queue storage failure and saves to a new project with no14th request; original lock/11 PNG records stay intact',
        );
        window.setMinimumSize(360, 500);
        window.setSize(390, 844);
        await until(() => evaluate('innerWidth===390'));
        assert.equal(
          await evaluate('document.documentElement.scrollWidth<=innerWidth'),
          true,
        );
        if (process.env.SDSTUDIO_GENERATION_SCREENSHOT)
          fs.writeFileSync(
            process.env.SDSTUDIO_GENERATION_SCREENSHOT,
            (await contents.capturePage()).toPNG(),
          );
        checks.push(
          '390px queue/confirmation/result layout has no horizontal overflow; normal app minimum size is unchanged',
        );
      } else if (phase === 'offline') {
        assert.equal(
          await evaluate(
            "document.querySelector('[data-testid=prepare-generation]').disabled",
          ),
          true,
        );
        const denied = await evaluate(
          "window.electron.generation.prepare('invalid','invalid','invalid')",
        );
        assert.equal(denied.code, 'OFFLINE');
        assert.equal(requests, 0);
        const listing = await evaluate('window.electron.projects.list()');
        const target = listing.value.find((p) =>
          p.name.includes('(이번 결과)'),
        );
        await click('[data-testid=project-list]');
        await until(() =>
          evaluate(
            `!!document.querySelector('[data-project-open="${target.id}"]')`,
          ),
        );
        await click(`[data-project-open="${target.id}"]`);
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generated-png]')?.naturalWidth===2",
          ),
        );
        checks.push(
          'offline generation refuses prepare before token/network access while saved v2 PNG remains viewable',
        );
      } else if (phase === 'reopen') {
        const list = await evaluate('window.electron.projects.list()');
        assert.equal(list.ok, true);
        const restored = list.value.find((p) => p.name.includes('(이번 결과)'));
        assert.ok(restored);
        await click('[data-testid=project-list]');
        await until(() =>
          evaluate(
            `!!document.querySelector('[data-project-open="${restored.id}"]')`,
          ),
        );
        await click(`[data-project-open="${restored.id}"]`);
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generated-png]')?.naturalWidth===2",
          ),
        );
        const data = await evaluate(
          `window.electron.projects.open('${restored.id}')`,
        );
        assert.equal(data.value.project.images.length, 1);
        for (const image of data.value.project.images)
          assert.deepEqual(
            fs.readFileSync(
              path.join(
                profile,
                'projects-v1',
                data.value.project.id,
                'images',
                image.sha256 + '.png',
              ),
            ),
            expectedPNG,
          );
        assert.equal(requests, 0);
        checks.push(
          'new PID reopens the result-only project and decodes byte-identical PNG with no generation request',
        );
      } else {
        const set = await evaluate(
          "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
        );
        assert.equal(set.ok, true);
        await fill('[data-testid=live-prompt]', 'synthetic lake from UI');
        await evaluate(
          "(()=>{const s=document.querySelector('#live-seed-mode');s.value='fixed';s.dispatchEvent(new Event('change',{bubbles:true}));})()",
        );
        await fill('#live-seed', '0');
        const prepare = async () => {
          await until(() =>
            evaluate(
              "!document.querySelector('[data-testid=prepare-generation]').matches(':disabled')",
            ),
          );
          await click('[data-testid=prepare-generation]');
          await until(() =>
            evaluate(
              "!!document.querySelector('[data-testid=generation-confirm]')",
            ),
          );
          assert.equal(
            await evaluate(
              "document.querySelector('[data-testid=send-generation]').disabled",
            ),
            true,
          );
          await click('[data-testid=generation-cost-confirm]');
        };
        await prepare();
        assert.equal(requests, 0);
        checks.push(
          'save/prepare and unconfirmed button send zero requests; visible confirmation fixes request seed/settings',
        );
        await click('[data-testid=send-generation]');
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generated-png]')?.naturalWidth===2",
          ),
        );
        const list = await evaluate('window.electron.projects.list()');
        const id = list.value[0].id;
        const manifest = path.join(profile, 'projects-v1', id, 'project.json');
        lock = path.join(profile, 'projects-v1', id, 'write.lock');
        const first = JSON.parse(fs.readFileSync(manifest));
        assert.equal(first.images.length, 1);
        assert.equal(first.version, 2);
        assert.deepEqual(first.images[0].binding, {
          id: 'nai-v45-basic512-v1',
          requestHash: firstRequestHash,
        });
        assert.equal(first.images[0].seed, 0);
        assert.deepEqual(
          fs.readFileSync(
            path.join(
              profile,
              'projects-v1',
              id,
              'images',
              first.images[0].sha256 + '.png',
            ),
          ),
          expectedPNG,
        );
        checks.push(
          'actual Electron session transport accepts unknown MIME ZIP, worker persists original alpha/metadata PNG, renderer decodes it',
        );
        await prepare();
        await click('[data-testid=send-generation]');
        await until(() => requests === 2);
        await click('[data-testid=cancel-generation]');
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generation-status]').innerText.includes('서버가 이미')",
          ),
        );
        assert.equal(JSON.parse(fs.readFileSync(manifest)).images.length, 1);
        checks.push(
          'in-flight cancel reports possible server processing, preserves input and prior PNG, no automatic retry',
        );
        await prepare();
        await click('[data-testid=send-generation]');
        await until(() =>
          evaluate(
            "!!document.querySelector('[data-testid=retry-result-save]')",
          ),
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=retry-result-save]').disabled",
          ),
        );
        assert.equal(requests, 3);
        assert.equal(
          fs.readFileSync(lock, 'utf8'),
          'synthetic interrupted writer',
        );
        await click('[data-testid=save-result-new-project]');
        await until(
          async () =>
            (await evaluate('window.electron.projects.list()')).value.length ===
            2,
        );
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generation-status]').innerText.includes('PNG 원본')",
          ),
        );
        assert.equal(
          fs.readFileSync(lock, 'utf8'),
          'synthetic interrupted writer',
        );
        assert.equal(JSON.parse(fs.readFileSync(manifest)).images.length, 1);
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=project-save]').disabled",
          ),
        );
        assert.equal(requests, 3);
        checks.push(
          'post-response storage fault retains result; explicit new-project save preserves original lock/PNG and adds the received PNG without a fourth request',
        );
        const diag = JSON.parse(
          fs.readFileSync(
            path.join(profile, 'nai-diagnostics', 'first-response.v1.json'),
          ),
        );
        assert.equal(diag.mediaType, 'binary/octet-stream');
        assert.deepEqual(Object.keys(diag).sort(), [
          'httpStatus',
          'mediaType',
          'mediaTypeState',
          'version',
        ]);
        checks.push(
          'first response diagnostic contains only sanitized MIME/state/status/version in private profile',
        );
        const window = BrowserWindow.fromWebContents(contents);
        if (process.env.SDSTUDIO_GENERATION_SCREENSHOT)
          fs.writeFileSync(
            process.env.SDSTUDIO_GENERATION_SCREENSHOT + '.desktop.png',
            (await contents.capturePage()).toPNG(),
          );
        window.setMinimumSize(360, 500); // Test-only layout probe; normal V3 window minimum remains 1024px.
        window.setSize(390, 844);
        await until(() => evaluate('innerWidth===390'));
        assert.equal(
          await evaluate('document.documentElement.scrollWidth<=innerWidth'),
          true,
        );
        if (process.env.SDSTUDIO_GENERATION_SCREENSHOT)
          fs.writeFileSync(
            process.env.SDSTUDIO_GENERATION_SCREENSHOT,
            (await contents.capturePage()).toPNG(),
          );
        checks.push(
          '390px layout probe (test-only window minimum override) has no horizontal overflow',
        );
      }
      await until(
        async () =>
          !(await evaluate('window.electron.generation.status()')).value.active,
      );
      await new Promise((r) => setTimeout(r, 650));
      app.once('will-quit', () =>
        finish(remote.length || errors.length ? 1 : 0),
      );
      BrowserWindow.fromWebContents(contents).close();
    } catch (error) {
      finish(1, error.stack);
    }
  });
});
