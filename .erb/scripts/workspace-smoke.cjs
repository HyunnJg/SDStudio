const assert = require('node:assert/strict');
const fs = require('node:fs');
const { BrowserWindow } = require('electron');

module.exports = async function exerciseWorkspace(contents) {
  const checks = [];
  const desktopSize = await contents.executeJavaScript(
    '[innerWidth, innerHeight]',
  );
  const evaluate = (code) => contents.executeJavaScript(code);
  const until = async (code) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Workspace assertion timed out: ${code}`);
  };
  const click = async (selector) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  };
  const fill = async (selector, value) => {
    await evaluate(`(() => {
      const control=document.querySelector(${JSON.stringify(selector)});
      const proto=control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(control, ${JSON.stringify(value)});
      control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles:true }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  };
  await until(`!!document.querySelector('[data-testid="preview-workspace"]')`);
  await evaluate("window.taskQueueService.dispatchEvent(new Event('ip-check-fail'))");
  await until("!!document.querySelector('.confirm-window')");
  assert.ok(await evaluate("document.querySelector('.confirm-window').getBoundingClientRect().top >= 0"));
  await click('.confirm-window button');
  await until("!document.querySelector('.confirm-window')");
  checks.push('global service dialog remains visible in the new workspace');
  const legacy = await evaluate('JSON.stringify(window.curSession.toJSON())');
  await fill('[aria-label="모델 입력 형식"]', 'v5');
  await until(
    'document.querySelector(".pw-character-heading").innerText.includes("22")',
  );
  await fill('[aria-label="모델 입력 형식"]', 'v4.5');
  checks.push('model family switches without clearing the draft');
  await fill(
    '[data-testid="base-prompt"]',
    'two travelers, a quiet garden, afternoon light',
  );
  await fill('[aria-label="시드"]', '0');
  await click('[aria-label="배치 방식"] button:last-child');
  await click('[aria-label="위치 4행 2열"]');
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="위치 4행 2열"]').getAttribute('aria-pressed')`,
    ),
    'true',
  );
  await click('[aria-label="캐릭터 추가"]');
  await fill('[aria-label="캐릭터 프롬프트"]', 'person, green coat');
  await click('[aria-label="캐릭터 앞으로"]');
  await click('[aria-label="캐릭터 삭제"]');
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.pw-character-tabs button[aria-pressed]').length`,
    ),
    2,
  );
  checks.push('character add/reorder/delete and manual grid');
  await click('[data-testid="generate-preview"]');
  await until(
    `document.querySelector('.pw-history-strip button') && !document.querySelector('[role="alert"]')`,
  );
  await until(
    `document.querySelector('.pw-canvas > img').complete && document.querySelector('.pw-canvas > img').naturalWidth === 832`,
  );
  checks.push('visible SVG example and seed zero');
  await evaluate(`document.querySelector('.pw-review-options').open=true`);
  await fill('[aria-label="예제 응답"]', 'prompt-length');
  await click('[data-testid="generate-preview"]');
  await until(
    `document.querySelector('[role="alert"]')?.innerText.includes('입력 한도')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-testid="base-prompt"]').value`,
    ),
    'two travelers, a quiet garden, afternoon light',
  );
  checks.push('length error preserves input');
  await fill('[aria-label="예제 응답"]', 'connection');
  await click('[data-testid="generate-preview"]');
  await until(
    `document.querySelector('[role="alert"]')?.innerText.includes('입력은 그대로')`,
  );
  checks.push('connection error display');
  await fill('[aria-label="예제 응답"]', 'success');
  await fill('[data-testid="base-prompt"]', 'left | right');
  await click('[data-testid="generate-preview"]');
  await until(
    `document.querySelector('[role="alert"]')?.innerText.includes('| 문법')`,
  );
  await fill(
    '[data-testid="base-prompt"]',
    'two travelers, a quiet garden, afternoon light',
  );
  await click('[data-testid="generate-preview"]');
  await until(
    `document.querySelectorAll('.pw-history-strip button').length === 2 && !document.querySelector('[role="alert"]')`,
  );
  assert.equal(
    await evaluate('JSON.stringify(window.curSession.toJSON())'),
    legacy,
  );
  checks.push('legacy session unchanged by modern draft');
  await click('[data-testid="open-legacy"]');
  await until(
    `!document.querySelector('[data-testid="preview-workspace"]') && !!document.querySelector('[data-testid="open-preview"]')`,
  );
  await click('[data-testid="open-preview"]');
  await until(`!!document.querySelector('[data-testid="preview-workspace"]')`);
  assert.equal(
    await evaluate(
      `document.querySelector('[data-testid="base-prompt"]').value`,
    ),
    'two travelers, a quiet garden, afternoon light',
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('.pw-history-strip button').length`,
    ),
    2,
  );
  checks.push('V3 view round trip preserves draft and results');
  await evaluate(`document.querySelector('.pw-review-options').open=false`);
  if (process.env.SDSTUDIO_SMOKE_SCREENSHOT)
    fs.writeFileSync(
      process.env.SDSTUDIO_SMOKE_SCREENSHOT,
      (await contents.capturePage()).toPNG(),
    );
  const window = BrowserWindow.fromWebContents(contents);
  window.setSize(390, 844);
  await until('innerWidth === 390');
  assert.equal(
    await evaluate(
      `document.querySelector('.preview-workspace').scrollWidth <= document.querySelector('.preview-workspace').clientWidth + 1`,
    ),
    true,
  );
  await evaluate(
    `document.querySelector('[aria-label="시드"]').scrollIntoView({block:'center'})`,
  );
  assert.equal(
    await evaluate(
      `(() => { const r=document.querySelector('[aria-label="시드"]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})()`,
    ),
    true,
  );
  await fill('[aria-label="시드"]', '7');
  await click('[data-testid="generate-preview"]');
  await until(
    `document.querySelector('.pw-result-caption').innerText.includes('시드 7')`,
  );
  await evaluate(
    `document.querySelector('.pw-canvas-column').scrollIntoView({block:'start'})`,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    await evaluate(
      `(() => {const r=document.querySelector('[data-testid="generate-preview"]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})()`,
    ),
    true,
  );
  checks.push('390px layout has no horizontal overflow and reachable controls');
  if (process.env.SDSTUDIO_SMOKE_NARROW_SCREENSHOT)
    fs.writeFileSync(
      process.env.SDSTUDIO_SMOKE_NARROW_SCREENSHOT,
      (await contents.capturePage()).toPNG(),
    );
  return {
    checks,
    desktop: desktopSize.join('x'),
    narrow: (await evaluate('[innerWidth,innerHeight]')).join('x'),
    simulatedErrors: true,
  };
};
