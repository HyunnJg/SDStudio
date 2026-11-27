const assert = require('node:assert/strict');
const { png } = require('../../src/__tests__/fixtures/nai/png.cjs');

module.exports = async ({
  contents,
  evaluate,
  click,
  fill,
  until,
  checks,
  requestCount,
}) => {
  await evaluate(
    "window.__legacyChunks=[];new MutationObserver(rows=>rows.forEach(r=>r.addedNodes.forEach(n=>{if(n.tagName==='SCRIPT' && n.src)window.__legacyChunks.push(n.src)}))).observe(document.head,{childList:true})",
  );
  await click('[data-testid=open-legacy]');
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=open-preview]')"),
  );
  assert.ok(await evaluate('window.__legacyChunks.length > 0'));
  await click('[data-testid=open-preview]');
  await until(() => evaluate("!!document.querySelector('#live-model')"));
  checks.push(
    'compatibility editor loads on first entry and returns to the workspace',
  );
  assert.ok(
    (
      await evaluate(
        "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
      )
    ).ok,
  );
  await evaluate(
    "(()=>{const s=document.querySelector('#live-model');s.value='nai-diffusion-3';s.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await fill('#live-prompt', 'synthetic garden');
  await evaluate(
    `(()=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(${JSON.stringify([...png()])})],'source.png',{type:'image/png'}));const el=document.querySelector('[data-testid=metadata-file]');el.files=d.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await click('[data-testid=image-use-inpaint]');
  const canvas = '.workspace-mask-editor canvas';
  await until(() =>
    evaluate(
      "document.querySelector('.mask-stage img')?.naturalWidth > 0 && !document.querySelector('.workspace-mask-editor fieldset').disabled",
    ),
  );
  async function button(label) {
    await until(() =>
      evaluate(`(() => {
        const target = [...document.querySelectorAll('button:enabled')]
          .find(b => b.textContent.trim() === ${JSON.stringify(label)});
        if (!target) return false;
        target.click();
        return true;
      })()`),
    );
  }
  async function dot() {
    const at = await evaluate(
      `(async () => {
        const surface = document.querySelector('${canvas}');
        surface.scrollIntoView({block:'center', behavior:'instant'});
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const bounds = surface.getBoundingClientRect();
        const x = bounds.x + bounds.width / 2;
        const y = bounds.y + bounds.height / 2;
        return {x, y, target:document.elementFromPoint(x,y)?.tagName};
      })()`,
    );
    assert.equal(at.target, 'CANVAS', JSON.stringify(at));
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: at.x, y: at.y,
    });
    for (const type of ['mousePressed', 'mouseReleased'])
      await contents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type,
        x: at.x,
        y: at.y,
        button: 'left',
        clickCount: 1,
      });
  }
  const alpha = () =>
    evaluate(
      `(()=>{const c=document.querySelector('${canvas}');return c.getContext('2d').getImageData(c.width>>1,c.height>>1,1,1).data[3]})()`,
    );
  await button('마스크 적용');
  await until(() =>
    evaluate(
      "document.querySelector('.workspace-mask-editor [role=status]').textContent.includes('칠하세요')",
    ),
  );
  await dot();
  await until(async () => (await alpha()) === 255);
  await button('지우개');
  await until(() => evaluate(
    "document.querySelector('.mask-tools button[aria-pressed=true]')?.textContent === '지우개'",
  ));
  await dot();
  await until(async () => (await alpha()) === 0);
  await button('되돌리기');
  assert.equal(await alpha(), 255);
  await button('마스크 적용');
  await until(() =>
    evaluate("!document.querySelector('.workspace-mask-editor')"),
  );
  await button('마스크 다시 편집');
  await until(() =>
    evaluate(
      "document.querySelector('.workspace-mask-editor fieldset')?.disabled===false",
    ),
  );
  assert.equal(await alpha(), 255);
  await evaluate(
    "document.querySelector('.workspace-mask-editor header button').click()",
  );
  assert.equal(requestCount(), 0);
  await click('[data-testid=prepare-generation]');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=generated-png]')?.naturalWidth===2",
    ),
  );
  assert.equal(requestCount(), 1);
  if (contents.debugger.isAttached()) contents.debugger.detach();
  await until(()=>evaluate("!document.querySelector('[data-testid=project-save]').disabled"));
  await click('[data-testid=project-save]');
  await until(()=>evaluate("!document.querySelector('[data-testid=project-dirty]').textContent.includes('미저장')"));
  checks.push(
    'empty mask blocked, brush, eraser, undo, saved mask reopened and one V3 infill result saved',
  );
  await click('.connected-menu summary');
  async function selectSource() {
  await click('[data-testid=open-legacy-import]');
  await until(() => evaluate("[...document.querySelectorAll('dialog[open] select option')].some(o=>o.value==='MaskCopy')"));
  await evaluate(`(()=>{const select=document.querySelector('dialog[open] select');select.value='MaskCopy';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await until(()=>evaluate("document.querySelector('[data-testid=legacy-copy-masks]')?.matches(':enabled')"));
  }
  await selectSource();
  await button('프리셋을 라이브러리에서 검토');
  await until(()=>evaluate("document.querySelector('[data-testid=library-import-all]')?.matches(':enabled')"));
  await click('[data-testid=library-import-all]');
  await until(()=>evaluate("document.querySelector('[data-testid=library-status]')?.textContent.includes('1개 저장')"));
  await click('[data-testid=library-import-all]');
  await until(()=>evaluate("document.querySelector('[data-testid=library-status]')?.textContent.includes('1개 건너뜀')"));
  checks.push('session presets save together and a repeated import skips identical contents');
  await click('[data-testid=library-close]');
  await selectSource();
  await click('[data-testid=legacy-copy-masks]');
  await until(()=>evaluate("[...document.querySelectorAll('[role=alert]')].some(n=>n.textContent.includes('「Missing」'))"));
  checks.push('a missing mask identifies its scene before the user retries with a subset');
  await selectSource();
  await evaluate("document.querySelector('[data-testid=legacy-copy-masks]').closest('fieldset').querySelector('input[type=checkbox]').click()");
  await click('[data-testid=legacy-copy-masks]');
  await until(()=>evaluate("document.querySelector('#live-prompt')?.value==='copied sky'"));
  await button('마스크 다시 편집');
  await until(()=>evaluate("document.querySelector('.workspace-mask-editor fieldset')?.disabled===false"));
  assert.equal(await alpha(),255);
  await evaluate("document.querySelector('.workspace-mask-editor header button').click()");
  assert.equal(requestCount(),1);
  checks.push('saved V3 mask opens in a new editable project without another generation request');
  await selectSource();
  await evaluate(`(()=>{const s=document.querySelector('[data-testid=legacy-scene-select]');s.value='Garden';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await fill('[data-testid=legacy-scene-page]', '3');
  await until(() => evaluate("!document.querySelector('[data-testid=legacy-with-picks]').checked"));
  await click('[data-testid=legacy-with-picks]');
  await click('[data-testid=legacy-copy-scene]');
  await until(() => evaluate("document.querySelector('#live-prompt')?.value==='slot0-4, slot1-4, slot2-0'"));
  assert.match(await evaluate("document.querySelector('[data-testid=legacy-copy-notice]').innerText"), /부정 프롬프트/);
  assert.equal(await evaluate("document.querySelector('#live-scene').options.length"),5);
  await until(() => evaluate("!!document.querySelector('[data-picked=true]')"));
  await evaluate("[...document.querySelectorAll('[data-image-id]')].find(b=>b.textContent.includes('picked.png')).click()");
  await until(() => evaluate("document.querySelector('[data-testid=generated-seed]')?.textContent.includes('Garden · picked.png')"));
  assert.equal(requestCount(),1);
  checks.push('125 combinations open at 121–125, with explicit selection of source PNGs and the preset notice');
  await require('./legacy-pick-ui-probe.cjs')({evaluate,click,until,checks});
  assert.equal(requestCount(),1);
};
