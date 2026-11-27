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
if (phase === 'recipe') {
  global.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, 'https://generativelanguage.googleapis.com');
    assert.equal(options.headers['x-goog-api-key'], 'synthetic-gemini-key');
    const body = JSON.parse(options.body);
    assert.equal(body.serviceTier, 'flex');
    assert.equal(body.generationConfig.topP, 0.9);
    assert.ok(new URL(url).pathname.endsWith('/gemini-3.8-flash:generateContent'));
    const input = JSON.parse(body.contents[0].parts[0].text);
    if (['한 컷. 맑은 하늘.', '취소할 컷'].includes(input.instruction)) {
      options.signal.throwIfAborted();
      return new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    }
    assert.deepEqual(input, { instruction: '표정 세 컷, 각 두 장', style: '', characters: [] });
    const cuts = ['tense', 'smile', 'relieved'].map((emotion) => ({
      name: emotion, setting: 'courtyard', emotion,
    }));
    return Response.json({ candidates: [{ finishReason: 'STOP', content: {
      parts: [{ text: JSON.stringify({ cuts, repeats: 2 }) }],
    } }] });
  };
}
const profile = process.env.SDSTUDIO_USER_DATA_DIR;
if (phase === 'inpaint') {
  const root = path.join(profile, 'SDStudio', 'projects');
  fs.mkdirSync(root, { recursive:true });
  const image = require('electron').nativeImage.createFromBitmap(Buffer.alloc(64 * 64 * 4, 255), {width:64, height:64}).toPNG();
  const vibes = path.join(profile, 'SDStudio', 'vibes', 'MaskCopy');
  fs.mkdirSync(vibes,{recursive:true});
  fs.writeFileSync(path.join(vibes,'source.png'),image);
  fs.writeFileSync(path.join(vibes,'mask.png'),image);
  const outputs = path.join(profile, 'SDStudio', 'outs', 'MaskCopy', 'Garden');
  fs.mkdirSync(outputs, { recursive:true });
  const {fixture} = require('../../src/__tests__/fixtures/nai/metadataPNG.cjs');
  const picked = fixture({Comment:{prompt:'imported sky',uc:'mist',seed:7}}, {width:64,height:64}).bytes;
  fs.writeFileSync(path.join(outputs, 'picked.png'), picked);
  fs.writeFileSync(path.join(outputs, 'second.png'), image);
  fs.writeFileSync(path.join(root, 'MaskCopy.json'), JSON.stringify({
    version:1, name:'MaskCopy', presets:{SDImageGen:[{type:'SDImageGen',name:'Palette',frontPrompt:'blue sky',backPrompt:'day',uc:'fog'}]}, presetShareds:{}, library:{},
    scenes:{Garden:{name:'Garden',type:'scene',resolution:'portrait',slots:Array.from({length:3}, (_,s)=>Array.from({length:5}, (_,n)=>({prompt:`slot${s}-${n}`}))),mains:['picked.png','second.png']}},
    inpaints:{Missing:{type:'inpaint',workflowType:'SDInpaint',name:'Missing',resolution:'square',mains:[],imageMap:[],preset:{type:'SDInpaint',image:'source.png',mask:'missing.png'}},Retouch:{type:'inpaint',workflowType:'SDInpaint',name:'Retouch',resolution:'square',mains:[],imageMap:[],
      preset:{type:'SDInpaint',name:'Retouch',prompt:'copied sky',image:'source.png',mask:'mask.png'}}},
  }));
}
if (phase === 'recipe') {
  const legacy = path.join(profile, 'SDStudio');
  const name = 'Bridge';
  const scene = { type: 'scene', name: 'Test', resolution: 'portrait', slots: [], main: 'favorite.png', imageMap: ['favorite.png'] };
  const inpaint = { type: 'inpaint', workflowType: 'SDInpaint', name: 'Retouch', resolution: 'portrait', mains: [], imageMap: ['output.png'] };
  const fixture = { name, presets: {}, presetShareds: {}, scenes: { Test: scene }, inpaints: { Retouch: inpaint }, library: { Sky: { version: 1, name: 'Sky', pieces: [{ name:'weather', prompt:'rain' }] } } };
  for (const [file, content] of [
    ['projects/Bridge.json', JSON.stringify(fixture)],
    ['outs/Bridge/Test/favorite.png', expectedPNG],
    ['inpaints/Bridge/Retouch/output.png', expectedPNG],
  ]) {
    const target = path.join(legacy, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}
const checks = [],
  remote = [],
  errors = [];
let firstRequestHash;
const sentSteps = [];
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
  sentSteps.push(parsed.parameters.steps);
  if (phase === 'inpaint') {
    assert.equal(parsed.model,'nai-diffusion-3-inpainting');
    assert.equal(parsed.action,'infill');
    assert.ok(parsed.parameters.mask && parsed.parameters.image);
    assert.equal(parsed.parameters.add_original_image, true);
    response.writeHead(200,{'Content-Type':'application/zip'});
    response.end(await payload);
    return;
  }
  if (phase === 'recipe') {
    assert.equal(parsed.model,'nai-diffusion-furry-3');
    assert.equal(parsed.parameters.width,640);
    assert.equal(parsed.parameters.height,896);
    assert.equal(parsed.parameters.v4_prompt,undefined);
    assert.match(parsed.input,/^(red|blue) coat, (rain|snow)$/);
    response.writeHead(200,{'Content-Type':'application/zip'});
    response.end(await payload);
    return;
  }
  assert.equal(parsed.model, 'nai-diffusion-5-full');
  assert.equal(parsed.parameters.image_format, 'png');
  assert.equal(parsed.parameters.width, 832);
  assert.equal(parsed.parameters.height, 1216);
  assert.equal(parsed.parameters.n_samples, 1);
  if (phase === 'img2img') {
    assert.equal(parsed.action, 'img2img');
    assert.equal(parsed.parameters.strength, 0.4);
    assert.equal(parsed.parameters.noise, 0.1);
    assert.equal(parsed.parameters.extra_noise_seed, parsed.parameters.seed);
    if (number === 1) assert.equal(parsed.parameters.director_reference_images, undefined);
    else {
      assert.equal(parsed.parameters.director_reference_images.length, 1);
      assert.notEqual(parsed.parameters.director_reference_images[0],parsed.parameters.image);
    }
    const source = Buffer.from(parsed.parameters.image, 'base64');
    assert.equal(source.readUInt32BE(16), 832);
    assert.equal(source.readUInt32BE(20), 1216);
    response.writeHead(200, { 'Content-Type': 'application/zip' });
    response.end(await payload);
    return;
  }
  if (phase === 'reference') {
    assert.equal(parsed.parameters.director_reference_images.length, 1);
    assert.equal(parsed.parameters.director_reference_descriptions[0].caption.base_caption, 'style');
    assert.deepEqual(parsed.parameters.director_reference_strength_values, [2.5]);
    assert.deepEqual(parsed.parameters.director_reference_secondary_strength_values, [0]);
    if (number === 3) fs.writeFileSync(lock, 'synthetic interrupted reference save');
    response.writeHead(200, { 'Content-Type': 'binary/octet-stream' });
    response.end(await payload); return;
  }
  if (phase === 'characters') {
    assert.equal(parsed.input, '');
    assert.equal(parsed.parameters.v4_prompt.caption.base_caption, '');
    const expected =
      number === 1
        ? ['person, blue coat']
        : ['person, blue coat', 'person, red coat'];
    assert.deepEqual(
      parsed.parameters.v4_prompt.caption.char_captions.map(
        (c) => c.char_caption,
      ),
      expected,
    );
    assert.deepEqual(
      parsed.parameters.v4_negative_prompt.caption.char_captions.map(
        (c) => c.char_caption,
      ),
      number === 1 ? [''] : ['', 'hat'],
    );
    assert.equal(parsed.parameters.v4_prompt.use_coords, false);
    assert.equal(parsed.parameters.v4_prompt.use_order, true);
    await new Promise((r) => setTimeout(r, 100));
    response.writeHead(200, { 'Content-Type': 'binary/octet-stream' });
    response.end(await payload);
    return;
  }
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
  contents.on('console-message', ({ level, message }) => {
    if (level === 'error') errors.push(message);
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
        evaluate("!!document.querySelector('[data-testid=connected-workspace]')"),
      );
      checks.push('new workspace is the default startup without a legacy screen detour');
      await until(() =>
        evaluate(
          "!!document.querySelector('[data-testid=connected-workspace]')",
        ),
      );
      await require('./workspace-layout-probe.cjs').checkEditor({ contents, evaluate, click, fill, until, checks });
      await evaluate("(()=>{window.__flowMessages=[];const node=document.querySelector('[data-testid=generation-status]');new MutationObserver(()=>{if(node.textContent.trim())window.__flowMessages.push(node.textContent.trim())}).observe(node,{childList:true,characterData:true,subtree:true})})()");
      if (process.env.SDSTUDIO_RUNTIME_REPORT && phase === 'create')
        await require('./runtime-ui-probe.cjs')(contents, profile);
      if (phase === 'inpaint') {
        await require('./inpaint-ui-probe.cjs')({contents,evaluate,click,fill,until,checks,requestCount:()=>requests});
      } else if (phase === 'recipe') {
        await require('./scene-recipe-probe.cjs')({evaluate,click,fill,until,checks,requests:()=>requests});
      } else if (phase === 'trash') {
        await require('./workspace-trash-ui-probe.cjs')({contents,evaluate,click,fill,until,checks,profile,requestCount:()=>requests});
      } else if (phase === 'img2img') {
        await require('./variation-ui-probe.cjs')({evaluate, click, fill, until, checks, requestCount: () => requests});
      } else if (phase === 'reference') {
        await require('./reference-ui-probe.cjs')({ contents, evaluate, click, fill, until, checks, requestCount: () => requests,
          setLock: (id) => { lock = path.join(profile, 'projects-v1', id, 'write.lock'); } });
      } else if (phase === 'queue-errors') {
        const set = await evaluate(
          "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
        );
        assert.equal(set.ok, true);
        assert.equal(await evaluate("!document.querySelector('#live-queue-details').hidden"), true);
        await evaluate(
          "document.querySelectorAll('[data-queue-scene]').forEach(c=>c.click())",
        );
        await fill('#live-interval', '0');
        await fill('#live-repeats', '2');
        const confirm = async () => {
          await until(() =>
            evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
          );
          assert.equal(
            await evaluate(
              "document.querySelector('[data-testid=send-live-queue]').disabled",
            ),
            false,
          );

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
        assert.equal(await evaluate("!document.querySelector('#live-queue-details').hidden"), true);
        await evaluate(
          "document.querySelectorAll('[data-queue-scene]').forEach((c,i)=>{if(c.checked!==(i<2))c.click()})",
        );
        await fill('#live-interval', '0');
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
          false,
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
        assert.equal(await evaluate("!document.querySelector('#live-queue-details').hidden"), true);
        await evaluate(
          "document.querySelectorAll('[data-queue-scene]').forEach(c=>c.click())",
        );
        assert.equal(await evaluate("document.querySelector('#live-interval').value"), '10');
        await fill('#live-interval', '1');
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
          false,
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
        assert.equal(await evaluate("document.querySelectorAll('[data-queue-scene]:checked').length"), 3);
        assert.equal(new Set(reserved.items.map((i) => i.seed)).size, 6);
        assert.equal(
          await evaluate(
            "!!document.querySelector('[data-testid=queue-anlas-warning]')",
          ),
          false,
        );
        checks.push(
          'selected3 scenes x2 prepare sends0; confirmation shows6 requests, fixed settings and six resolved random seeds',
        );

        await click('[data-testid=send-live-queue]');
        await until(() => evaluate("document.querySelector('[data-testid=live-queue-progress]').textContent.includes('다음 생성')"));
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
        assert.equal(await evaluate("!document.querySelector('#live-queue-details').hidden"), true);
        await until(() =>
          evaluate("!document.querySelector('#live-queue-details').hidden"),
        );
        await fill('#live-interval','0');
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
          false,
        );
        checks.push(
          'restored draft permits5-task reconfirmation despite project rename and a different viewed scene; confirmed seeds stay unchanged',
        );

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
        await fill('#live-interval', '0');
        await fill('#live-repeats', '1');
        await click('[data-testid=prepare-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );

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
      } else if (phase === 'characters') {
        assert.equal(
          (
            await evaluate(
              "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
            )
          ).ok,
          true,
        );
        await fill('[data-testid=live-prompt]', '2people, synthetic garden');
        await click('[data-testid=add-live-character]');
        await click('[data-testid=add-live-character]');
        const ids = await evaluate(
          "[...document.querySelectorAll('[data-character-id]')].map(c=>c.dataset.characterId)",
        );
        assert.equal(ids.length, 2);
        await fill(`[data-character-prompt="${ids[0]}"]`, 'person, red coat');
        await click(`[data-character-id="${ids[0]}"] .connected-character-negative summary`);
        await fill(`[data-character-negative="${ids[0]}"]`, 'hat');
        await fill(`[data-character-prompt="${ids[1]}"]`, 'person, blue coat');
        await click(`[data-character-delete="${ids[1]}"]`);
        await click('[data-testid=undo-live-character]');
        assert.equal(
          await evaluate(
            `document.querySelector('[data-character-prompt="${ids[1]}"]').value`,
          ),
          'person, blue coat',
        );
        await click(`[data-character-up="${ids[1]}"]`);
        await click(`[data-character-enabled="${ids[0]}"]`);
        checks.push(
          'character text survives deletion undo/reorder; disabling keeps the stored input',
        );
        await evaluate("(()=>{const s=document.querySelector('#live-model');s.value='nai-diffusion-3';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
        await until(()=>evaluate("!!document.querySelector('[data-testid=disable-live-characters]')"));
        assert.equal(await evaluate("document.querySelector('[data-testid=disable-live-characters]').matches(':disabled')"),false);
        await click('[data-testid=disable-live-characters]');
        assert.equal(await evaluate("[...document.querySelectorAll('[data-character-enabled]')].every(c=>!c.checked)"),true);
        assert.equal(await evaluate(`document.querySelector('[data-character-prompt="${ids[1]}"]').value`),'person, blue coat');
        await evaluate("(()=>{const s=document.querySelector('#live-model');s.value='nai-diffusion-5-full';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
        await click(`[data-character-enabled="${ids[1]}"]`);
        checks.push('V3 path offers a nearby disable-character action that preserves text; switching back to V5 restores editing');
        await click('[data-testid=add-live-character]');
        const waitingId = await evaluate("[...document.querySelectorAll('[data-character-id]')].at(-1).dataset.characterId");
        await fill('[data-testid=live-prompt]', '');
        await evaluate("(()=>{const s=document.querySelector('#live-quality');s.value='none';s.dispatchEvent(new Event('change',{bubbles:true}))})()");
        assert.ok((await evaluate("document.querySelector('[data-testid=live-characters]').textContent")).includes('작성 대기 1'));
        assert.ok(await evaluate(`!!document.querySelector('[data-character-waiting="${waitingId}"]')`));
        await click('[data-testid=prepare-generation]');
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generated-png]')?.naturalWidth===2",
          ),
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=prepare-generation]').matches(':disabled')",
          ),
        );
        const list = await evaluate('window.electron.projects.list()');
        const first = (
          await evaluate(`window.electron.projects.open('${list.value[0].id}')`)
        ).value;
        assert.equal(first.project.version, 4);
        assert.equal(first.project.images.length, 1);
        assert.equal(
          first.project.images[0].binding.id,
          'nai-v5-characters-auto-v1',
        );
        assert.deepEqual(
          first.project.images[0].draft.characters.map((c) => [
            c.id,
            c.enabled,
          ]),
          [
            [ids[1], true],
            [ids[0], false],
            [waitingId, true],
          ],
        );
        assert.equal(
          first.project.images[0].draft.characters[1].prompt,
          'person, red coat',
        );
        assert.equal(requests, 1);
        assert.equal(first.project.images[0].draft.prompt, '');
        assert.equal(first.project.images[0].draft.characters[2].prompt, '');
        checks.push('character-only generation sends empty base without quality presets, skips waiting card, and preserves the complete draft');
        const copy = await evaluate(
          `window.electron.projects.copy('${first.project.id}','${first.revision}',${JSON.stringify({ name: 'characters (이번 결과)', selectedSceneId: first.project.selectedSceneId, scenes: first.project.scenes })})`,
        );
        assert.equal(copy.ok, true);
        assert.equal(copy.value.project.version, 4);
        checks.push(
          'one click sends paired active captions only, persists original PNG/full draft as v4, and copies without a request',
        );
        await click(`[data-character-enabled="${ids[0]}"]`);
        await fill('#live-steps', '29');
        await click('[data-testid=prepare-generation]');
        await until(() =>
          evaluate(
            "!!document.querySelector('[data-testid=high-steps-confirm]')",
          ),
        );
        assert.match(
          await evaluate(
            "document.querySelector('[data-testid=high-steps-confirm]').textContent",
          ),
          /캐릭터 2명/,
        );
        await click('[data-testid=cancel-high-steps]');
        await until(() =>
          evaluate(
            "!document.querySelector('#live-steps').matches(':disabled')",
          ),
        );
        await fill('#live-steps', '23');
        assert.equal(requests, 1);
        checks.push(
          'high-step confirmation includes the active character count; cancel sends nothing',
        );
        assert.equal(await evaluate("!document.querySelector('#live-queue-details').hidden"), true);
        await evaluate(
          `document.querySelector('[data-queue-scene="${first.project.selectedSceneId}"]').click()`,
        );
        await fill('#live-interval', '0');
        await fill('#live-repeats', '2');
        await click('[data-testid=prepare-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );
        assert.match(
          await evaluate(
            "document.querySelector('[data-testid=queue-confirm]').textContent",
          ),
          /캐릭터 2명/,
        );
        assert.equal(requests, 1);
        await click('[data-testid=send-live-queue]');
        await until(async () =>
          (
            await evaluate('window.electron.generation.queueStatus()')
          ).value.queue?.items.every((i) => i.status === 'done'),
        );
        assert.equal(requests, 3);
        const final = (
          await evaluate(`window.electron.projects.open('${first.project.id}')`)
        ).value;
        assert.equal(final.project.images.length, 3);
        assert.deepEqual(
          final.project.images
            .slice(1)
            .map((i) => i.draft.characters.filter((c) => c.enabled && c.prompt.trim()).length),
          [2, 2],
        );
        checks.push(
          'two confirmed repetitions use the same reordered captions through the common serial generation/save path',
        );
        await evaluate(
          "document.querySelector('[data-testid=live-characters]').scrollIntoView({block:'start'})",
        );
        await pause();
        const win = BrowserWindow.fromWebContents(contents);
        if (process.env.SDSTUDIO_GENERATION_SCREENSHOT)
          fs.writeFileSync(
            process.env.SDSTUDIO_GENERATION_SCREENSHOT + '.desktop.png',
            (await contents.capturePage()).toPNG(),
          );
        win.setMinimumSize(360, 500);
        win.setSize(390, 844);
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
          '390px character editor and controls have no horizontal overflow',
        );
        await evaluate(
          "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='테마 전환').click()",
        );
        await pause();
        assert.equal(
          await evaluate('document.documentElement.scrollWidth<=innerWidth'),
          true,
        );
        checks.push('light-theme character cards remain readable at390px');
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
        const target = process.env.SDSTUDIO_IMG2IMG_SMOKE === '1' ? listing.value[0] : listing.value.find((p) =>
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
          'offline generation refuses prepare before token/network access while saved project PNG remains viewable',
        );
        await require('./png-metadata-ui-probe.cjs')({contents,evaluate,click,until,checks});
        assert.equal(requests,0,'offline metadata import is local and never sends');
        await require('./prompt-library-ui-probe.cjs')({ contents, evaluate, click, fill, until, checks });
        assert.equal(requests, 0, 'offline library never sends a generation request');
        const draftBeforeLegacy = await evaluate("document.querySelector('#live-prompt').value");
        await click('[data-testid=open-legacy]');
        await until(()=>evaluate("!!document.querySelector('[data-testid=open-preview]')"));
        assert.equal(await evaluate("document.querySelector('[data-testid=open-preview]').textContent"), '작업실로 돌아가기');
        if (await evaluate('!!window.curSession')) {
          assert.equal(await evaluate("[...document.querySelectorAll('button.back-sky')].some(b=>b.textContent==='이미지생성')"),true);
        }
        await click('[data-testid=open-preview]');
        await until(()=>evaluate("!!document.querySelector('#live-prompt')"));
        assert.equal(await evaluate("document.querySelector('#live-prompt').value"),draftBeforeLegacy);
        checks.push('V3 compatibility entry returns to the same workspace draft without generation');

      } else if (phase === 'reopen') {
        const library = await evaluate('window.electron.promptLibrary.read()');
        if (process.env.SDSTUDIO_LIBRARY_REOPEN === '1') { assert.equal(library.ok, true); assert.equal(library.value.entries.length, 3); checks.push('new PID reopens the persisted prompt library without a generation request'); }
        const list = await evaluate('window.electron.projects.list()');
        assert.equal(list.ok, true);
        const img2img = process.env.SDSTUDIO_IMG2IMG_SMOKE === '1';
        const restored = img2img ? list.value[0] : list.value.find((p) => p.name.includes('(이번 결과)'));
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
        assert.equal(data.value.project.images.length, (img2img || process.env.SDSTUDIO_TRASH_SMOKE === '1') ? 2 : 1);
        if (process.env.SDSTUDIO_TRASH_SMOKE === '1') {
          await until(() => evaluate("document.querySelector('.gallery-export button[aria-pressed]')?.textContent.includes('(1)')"));
          assert.equal(await evaluate("document.querySelectorAll('.gallery-mark[data-picked=true]').length"), 1);
          assert.equal(data.value.project.version,6);assert.equal(data.value.project.trashedImageIds.length,1);assert.equal(await evaluate("document.querySelectorAll('[data-image-id]').length"),1);checks.push('new PID restores v6 visibility and original bytes without resurrecting a hidden image'); }
        if (img2img) {
          assert.equal(data.value.project.version, 9);
          await until(() => evaluate("document.querySelector('[data-testid=reference-panel] img')?.naturalWidth===832"));
          assert.equal(await evaluate("document.querySelector('#variation-noise').value"), '0.1');
          await until(() => evaluate("Array.from(document.querySelectorAll('[data-testid=reference-panel] img')).filter(img=>img.naturalWidth>0).length===2"));
          checks.push('new PID restores both results, independent img2img and reference previews and noise');
        }
        if (process.env.SDSTUDIO_REFERENCE_SMOKE === '1') {
          assert.equal(data.value.project.version, 5);
          assert.equal(data.value.project.images[0].binding.id, 'nai-v5-reference-v1');
          await until(() => evaluate("document.querySelector('[data-testid=reference-panel] img')?.naturalWidth>0"));
          checks.push('new PID reopens the v5 result and the persisted reference preview without a generation request');
        }
        if (process.env.SDSTUDIO_CHARACTER_SMOKE === '1') {
          assert.equal(data.value.project.version, 4);
          assert.equal(
            data.value.project.images[0].binding.id,
            'nai-v5-characters-auto-v1',
          );
          assert.equal(
            await evaluate(
              "document.querySelectorAll('[data-character-id]').length",
            ),
            3,
          );
          assert.equal(
            await evaluate(
              "document.querySelector('[data-character-prompt]').value",
            ),
            'person, blue coat',
          );
          checks.push(
            'new PID restores the v4 character editor, order and result without a request',
          );
        }

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
        const checkGenerateColors = async (disabled) => {
          contents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
          for (const light of [true, false]) {
            if (
              (await evaluate(
                "document.querySelector('[data-testid=connected-workspace]').classList.contains('pw-light')",
              )) !== light
            )
              await evaluate(
                "[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='테마 전환').click()",
              );
            await pause();
            const colors = await evaluate(
              `(()=>{const b=document.querySelector('[data-testid=prepare-generation]');const s=getComputedStyle(b);return {background:s.backgroundColor,color:s.color,disabled:b.matches(':disabled')};})()`,
            );
            assert.deepEqual(
              colors,
              {
                background: light ? 'rgb(8, 123, 108)' : 'rgb(141, 216, 205)',
                color: light ? 'rgb(255, 255, 255)' : 'rgb(18, 53, 47)',
                disabled,
              },
              `Generate colors, light=${light}, disabled=${disabled}`,
            );
          }
        };
        await checkGenerateColors(false);
        const generate = async () => {
          await until(() =>
            evaluate(
              "!document.querySelector('[data-testid=prepare-generation]').matches(':disabled')",
            ),
          );
          await click('[data-testid=prepare-generation]');
          assert.equal(
            await evaluate(
              "!!document.querySelector('[data-testid=high-steps-confirm]')",
            ),
            false,
          );
        };
        await generate();
        await until(() =>
          evaluate(
            "document.querySelector('[data-testid=generated-png]')?.naturalWidth===2",
          ),
        );
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=prepare-generation]').matches(':disabled')",
          ),
        );
        await checkGenerateColors(false);
        checks.push(
          'dark/light Generate colors survive completion without relying on hover',
        );
        const list = await evaluate('window.electron.projects.list()');
        const id = list.value[0].id;
        const manifest = path.join(profile, 'projects-v1', id, 'project.json');
        lock = path.join(profile, 'projects-v1', id, 'write.lock');
        const first = JSON.parse(fs.readFileSync(manifest));
        assert.equal(first.images.length, 1);
        assert.equal(first.version, 3);
        assert.deepEqual(first.images[0].binding, {
          id: 'nai-v5-full-v1',
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
        assert.equal(requests, 1);
        checks.push(
          'one Generate click saves input and sends exactly one V5 request without a confirmation checkbox',
        );
        checks.push(
          'actual Electron session transport accepts unknown MIME ZIP, worker persists original alpha/metadata PNG, renderer decodes it',
        );
        assert.equal(await evaluate("document.querySelectorAll('[data-testid=gallery-save]').length"), 1);
        assert.equal(await evaluate("!!document.querySelector('[data-testid=result-download]')"), false);
        await click('[data-testid=result-use-metadata]');
        await until(() => evaluate("document.querySelector('[data-testid=metadata-dialog]')?.open && !!document.querySelector('[data-testid=apply-metadata]')"));
        await click('[aria-label="메타데이터 창 닫기"]');
        assert.equal(requests,1);
        checks.push('gallery has the sole original PNG save control; canvas imports metadata without another generation request');
        await until(() =>
          evaluate(
            "!document.querySelector('#live-steps').matches(':disabled')",
          ),
        );
        await fill('#live-steps', '29');
        await click('[data-testid=prepare-generation]');
        await until(() =>
          evaluate(
            "!!document.querySelector('[data-testid=high-steps-confirm]')",
          ),
        );
        assert.equal(requests, 1);
        assert.match(
          await evaluate(
            "document.querySelector('[data-testid=high-steps-confirm]').textContent",
          ),
          /29스텝/,
        );
        assert.equal(
          await evaluate(
            "document.querySelector('#live-steps').matches(':disabled')",
          ),
          true,
        );
        await click('[data-testid=cancel-high-steps]');
        await until(() =>
          evaluate(
            "!document.querySelector('#live-steps').matches(':disabled')",
          ),
        );
        assert.equal(requests, 1);
        checks.push(
          '29-step preparation and explicit cancel send0 additional requests and unlock settings',
        );
        await fill('#live-steps', '28');
        await generate();
        await until(() => requests === 2);
        await checkGenerateColors(true);
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
        await until(() =>
          evaluate(
            "!document.querySelector('#live-steps').matches(':disabled')",
          ),
        );
        await checkGenerateColors(false);
        checks.push(
          'dark/light Generate colors survive busy/disabled and cancellation with no additional request',
        );
        await fill('#live-steps', '29');
        await click('[data-testid=prepare-generation]');
        await until(() =>
          evaluate(
            "!!document.querySelector('[data-testid=high-steps-confirm]')",
          ),
        );
        assert.equal(requests, 2);
        await evaluate(
          "(()=>{const b=document.querySelector('[data-testid=send-high-steps]');b.click();b.click()})()",
        );
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
        assert.deepEqual(sentSteps, [23, 28, 29]);
        checks.push(
          '23/28 steps remain single-click; 29-step confirmation double-click sends exactly one approved request',
        );
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
            "document.querySelector('[data-testid=generation-status]').innerText==='완료'",
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
        assert.equal(await evaluate("!document.querySelector('#live-queue-details').hidden"), true);
        await evaluate(
          "document.querySelectorAll('[data-queue-scene]').forEach(c=>{if(!c.checked)c.click()})",
        );
        await fill('#live-interval', '0');
        await fill('#live-repeats', '1');
        await click('[data-testid=prepare-live-queue]');
        await until(() =>
          evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
        );
        assert.equal(
          await evaluate(
            "!!document.querySelector('[data-testid=queue-anlas-warning]')",
          ),
          true,
        );
        const preparedQueue = (
          await evaluate('window.electron.generation.queueStatus()')
        ).value.queue;
        assert.ok(preparedQueue.items.some((i) => i.settings.steps === 23));
        assert.ok(preparedQueue.items.some((i) => i.settings.steps === 29));
        assert.equal(requests, 3);
        await click('[data-testid=queue-confirm] button:last-of-type');
        await until(() =>
          evaluate(
            "!document.querySelector('[data-testid=prepare-generation]').matches(':disabled')",
          ),
        );
        checks.push(
          'mixed23/29-step queue displays the Anlas warning in its existing confirmation and cancel sends0',
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
        await require('./workspace-layout-probe.cjs').checkGallery({ contents, evaluate, click, until, checks, profile, sourceProjectId: preparedQueue.projectId });
        await require('./png-metadata-ui-probe.cjs')({contents,evaluate,click,until,checks});
        await require('./prompt-library-ui-probe.cjs')({ contents, evaluate, click, fill, until, checks });
        assert.equal(requests,3,'metadata and library actions send no generation request');
        assert.ok((await evaluate('window.__flowMessages')).every(message=>!/(입력을 저장|요청을 준비|PNG 원본을 저장|저장했습니다|적용했습니다|예약을 준비)/.test(message)));
        checks.push('generation feedback contains terminal outcome/errors only; local library/metadata applications do not narrate intermediate successes');
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
