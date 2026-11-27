const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const JSZip = require('jszip');
const { fixture } = require('../../src/__tests__/fixtures/nai/metadataPNG.cjs');

module.exports = async ({
  contents,
  evaluate,
  click,
  fill,
  until,
  checks,
  profile,
}) => {
  const root = path.join(profile, 'SDStudio');
  const name = 'Writer';
  const sessionFile = path.join(root, 'projects', name + '.json');
  const output = path.join(root, 'outs', name, 'default');
  const digest = (file) =>
    createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const zips = [];
  for (const seed of [3, 4]) {
    const zip = new JSZip();
    zip.file(
      'image.png',
      fixture(
        {
          Comment: {
            prompt: 'garden',
            uc: 'fog',
            seed,
            scale: 5,
            steps: 28,
            sampler: 'k_euler_ancestral',
            noise_schedule: 'karras',
          },
        },
        { width: 64, height: 64 },
      ).bytes,
    );
    zips.push(await zip.generateAsync({ type: 'base64' }));
  }
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'TOKEN.txt'), 'synthetic-writer-only', {
    flag: 'wx',
  });
  // Substitute only the two remote endpoints. The legacy queue still writes both files itself.
  await evaluate(`(() => {
    const original = window.fetch.bind(window), responses = ${JSON.stringify(zips)};
    window.fetch = (url, options) => {
      if (url === 'https://api.novelai.net/user/data') return Promise.resolve(Response.json({subscription:{trainingStepsLeft:{fixedTrainingStepsLeft:0,purchasedTrainingSteps:0}}}));
      if (url === 'https://image.novelai.net/ai/generate-image') {
        if (!responses.length) throw Error('extra generation');
        return Promise.resolve(new Response(Uint8Array.from(atob(responses.shift()), c => c.charCodeAt(0))));
      }
      return original(url,options);
    };
  })()`);
  const button = (label) =>
    until(() =>
      evaluate(`(() => {
    const b=[...document.querySelectorAll('button:enabled')].find(el => el.textContent.trim() === ${JSON.stringify(label)} && el.getClientRects().length);
    if (b) b.click();
    return !!b;
  })()`),
    );
  const ready = (selector) =>
    until(() =>
      evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),
    );
  await click('[data-testid=open-legacy]');
  await ready('button.icon-button.nback-sky.mx-1');
  await click('button.icon-button.nback-sky.mx-1');
  await ready('.confirm-window input');
  await fill('.confirm-window input', name);
  await button('확인');
  await ready('.clickable .image-cell');
  await fill('input[type=number][max="99"]', '2');
  await button('모두 예약추가');
  await until(() => evaluate("document.body.innerText.includes('2개 남음')"));
  await click('button.round-button.back-green.h-8.px-2');
  if (await evaluate("!!document.querySelector('.confirm-window')"))
    await button('확인');
  const deadline = Date.now() + 45000;
  while (
    !fs.existsSync(output) ||
    fs.readdirSync(output).filter((n) => n.endsWith('.png')).length !== 2
  ) {
    if (Date.now() > deadline)
      throw Error('V3 queue did not save two PNGs before the deadline');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  checks.push(
    'legacy queue wrote two distinct PNG files in the scene output directory',
  );
  await click('.clickable .image-cell');
  await until(() =>
    evaluate(
      "document.querySelectorAll('.image-cell img.image-anime').length === 2",
    ),
  );
  await click('.image-cell img.image-anime');
  await button('즐겨찾기 지정');
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
  await button('즐겨찾기 지정');
  await button('인페인팅 씬 생성');
  await button('마스크 편집');
  await until(() =>
    evaluate(
      "document.querySelector('.workspace-mask-editor fieldset')?.disabled === false",
    ),
  );
  const point = await evaluate(`(async()=>{
    const canvas=document.querySelector('.workspace-mask-editor canvas');
    canvas.scrollIntoView({block:'center',behavior:'instant'});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const b=canvas.getBoundingClientRect();
    return {x:b.x+b.width/2,y:b.y+b.height/2};
  })()`);
  if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
  for (const type of ['mousePressed', 'mouseReleased'])
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: 'left',
      clickCount: 1,
    });
  await button('마스크 적용');
  await until(() =>
    evaluate("!document.querySelector('.workspace-mask-editor')"),
  );
  await button('저장');
  let session;
  const saveDeadline = Date.now() + 25000;
  while (true) {
    session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (
      session.scenes.default.mains.length === 2 &&
      Object.values(session.inpaints)[0]?.preset.mask
    )
      break;
    assert.ok(
      Date.now() < saveDeadline,
      'V3 autosave did not persist both favorites and mask',
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const { image, mask } = Object.values(session.inpaints)[0].preset;
  const files = [
    ...session.scenes.default.mains.map((f) => path.join(output, f)),
    ...[image, mask].map((f) => path.join(root, 'vibes', name, f)),
  ];
  const hashes = files.map(digest);
  const savedSession = digest(sessionFile);
  assert.notEqual(hashes[0], hashes[1]);
  assert.ok(hashes.slice(0, 2).includes(hashes[2]));
  checks.push(
    'V3 favorites and painted mask persisted through the legacy editor',
  );
  await click('[data-testid=open-preview]');
  await ready('.connected-menu summary');
  async function selectSource() {
    if (!(await evaluate("document.querySelector('.connected-menu').open")))
      await click('.connected-menu summary');
    await click('[data-testid=open-legacy-import]');
    await until(() =>
      evaluate(
        "[...document.querySelectorAll('dialog[open] select option')].some(o => o.value === 'Writer')",
      ),
    );
    await evaluate(
      "(()=>{const s=document.querySelector('dialog[open] select');s.value='Writer';s.dispatchEvent(new Event('change',{bubbles:true}))})()",
    );
    await until(() =>
      evaluate(
        "document.querySelector('[data-testid=legacy-copy-masks]')?.matches(':enabled')",
      ),
    );
  }
  await selectSource();
  await evaluate(
    "(()=>{const s=document.querySelector('[data-testid=legacy-scene-select]');s.value='default';s.dispatchEvent(new Event('change',{bubbles:true}))})()",
  );
  await click('[data-testid=legacy-copy-scene]');
  await until(() =>
    evaluate("document.querySelectorAll('[data-picked=true]').length===2"),
  );
  const filename = session.scenes.default.mains[0];
  await evaluate(
    `[...document.querySelectorAll('[data-image-id]')].find(b => b.textContent.includes(${JSON.stringify(filename)})).click()`,
  );
  await until(() =>
    evaluate(
      `document.querySelector('[data-testid=generated-seed]')?.textContent.includes(${JSON.stringify(filename)})`,
    ),
  );
  await require('./legacy-pick-ui-probe.cjs')({
    evaluate,
    click,
    until,
    checks,
    folder: output,
    filename,
    prompt: 'garden',
  });
  await selectSource();
  await click('[data-testid=legacy-copy-masks]');
  await button('마스크 다시 편집');
  await until(() =>
    evaluate(
      "document.querySelector('.workspace-mask-editor fieldset')?.disabled === false",
    ),
  );
  const pixels = await evaluate(
    `(()=>{const c=document.querySelector('.workspace-mask-editor canvas'),ctx=c.getContext('2d');return [c.width,c.height,ctx.getImageData(c.width>>1,c.height>>1,1,1).data[3],ctx.getImageData(0,0,1,1).data[3]]})()`,
  );
  assert.deepEqual(pixels, [64, 64, 255, 0]);
  const projects = await evaluate(
    '(async()=>{const l=await window.electron.projects.list();return Promise.all(l.value.map(async p=>(await window.electron.projects.open(p.id)).value.project))})()',
  );
  const copied = projects.find((p) => p.images.length === 2);
  assert.deepEqual(
    copied.images.map((i) => [i.filename, i.sha256]).sort(),
    session.scenes.default.mains.map((f, i) => [f, hashes[i]]).sort(),
  );
  const draft = projects.find((p) => p.scenes[0].draft.inpaintMask).scenes[0]
    .draft;
  assert.deepEqual(
    [draft.inpaintSource.sourceHash, draft.inpaintMask.sourceHash],
    hashes.slice(2),
  );
  assert.deepEqual(files.map(digest), hashes);
  assert.equal(digest(sessionFile), savedSession);
  checks.push(
    'new workspace reopened both picks and the 64px painted mask with matching source and mask hashes',
  );
};
