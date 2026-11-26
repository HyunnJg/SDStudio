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
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
  }
  async function dot() {
    const at = await evaluate(
      `(()=>{const c=document.querySelector('${canvas}');c.scrollIntoView({block:'center'});const b=c.getBoundingClientRect();const x=b.x+b.width/2,y=b.y+b.height/2;return {x,y,width:b.width,height:b.height,target:document.elementFromPoint(x,y)?.tagName}})()`,
    );
    assert.equal(at.target, 'CANVAS', JSON.stringify(at));
    if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
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
};
