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
  await evaluate(
    "window.taskQueueService.dispatchEvent(new Event('ip-check-fail'))",
  );
  await until("!!document.querySelector('.confirm-window')");
  assert.ok(
    await evaluate(
      "document.querySelector('.confirm-window').getBoundingClientRect().top >= 0",
    ),
  );
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
  await fill('[aria-label="시드 방식"]', 'fixed');
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
  const legacyAfterLegacyView = await evaluate(
    'JSON.stringify(window.curSession.toJSON())',
  );
  // Theme, scenes and queue remain synthetic; no account or disk backend is involved.
  const darkBefore = await evaluate(
    "!document.querySelector('.preview-workspace').classList.contains('pw-light')",
  );
  await click('[aria-label="테마 전환"]');
  await until(
    `document.querySelector('.preview-workspace').classList.contains('pw-light') === ${darkBefore}`,
  );
  await click('[aria-label="테마 전환"]');
  await until(
    `document.querySelector('.preview-workspace').classList.contains('pw-light') !== ${darkBefore}`,
  );
  checks.push('theme toggle follows the shared application setting');
  await click('[aria-label="캐릭터 삭제"]');
  await evaluate(
    "Array.from(document.querySelectorAll('.pw-prompts button')).find(b=>b.textContent==='캐릭터 삭제 취소').click()",
  );
  await until(
    "document.querySelectorAll('.pw-character-tabs button[aria-pressed]').length===2",
  );
  checks.push('character deletion can be undone');
  const sceneOnePrompt = await evaluate(
    "document.querySelector('[data-testid=base-prompt]').value",
  );
  await click('.pw-scenes button:nth-of-type(2)');
  await fill('[data-testid="base-prompt"]', 'scene two edited independently');
  await click('.pw-scenes button:nth-of-type(1)');
  assert.equal(
    await evaluate("document.querySelector('[data-testid=base-prompt]').value"),
    sceneOnePrompt,
  );
  await fill('[aria-label="시드 방식"]', 'random');
  await click('[data-testid="reserve-scenes"]');
  assert.equal(
    await evaluate("document.querySelectorAll('.pw-queue-jobs li').length"),
    6,
  );
  await click('[data-testid="start-queue"]');
  await until(
    "!!document.querySelector('.pw-queue-jobs [data-status=running]')",
  );
  await click('[data-testid="stop-queue"]');
  await until(
    "document.querySelectorAll('.pw-queue-jobs [data-status=done]').length===1 && !document.querySelector('.pw-queue-jobs [data-status=running]')",
  );
  await new Promise((resolve) => setTimeout(resolve, 450));
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.pw-queue-jobs [data-status=pending]').length",
    ),
    5,
  );
  checks.push(
    'three scenes twice reserve six jobs and stop after the active example',
  );
  // Continue across a view switch: the queue belongs to App, not a disposable editor panel.
  await click('[data-testid="start-queue"]');
  await click('[data-testid="open-legacy"]');
  await until("!!document.querySelector('[data-testid=open-preview]')");
  await click('[data-testid="open-preview"]');
  await until(
    "document.querySelectorAll('.pw-queue-jobs [data-status=done]').length===6",
  );
  const seeds = await evaluate(
    "Array.from(document.querySelectorAll('.pw-queue-jobs small')).map(x=>x.textContent)",
  );
  assert.equal(new Set(seeds).size, 6);
  await click('.pw-queue-jobs li:first-child button');
  await until(
    "document.querySelector('.pw-result-caption').innerText.includes('정원의 여행자')",
  );
  assert.ok(
    (
      await evaluate("document.querySelector('.pw-result-caption').innerText")
    ).includes(seeds[0]),
  );
  assert.equal(
    await evaluate('JSON.stringify(window.curSession.toJSON())'),
    legacyAfterLegacyView,
  );
  checks.push(
    'resume across V3 view, six distinct recorded seeds, and open an earlier result',
  );
  await fill('[aria-label="모델 입력 형식"]', 'v5');
  for (let n = 0; n < 5; n++) {
    await click('[aria-label="캐릭터 추가"]');
    await fill('[aria-label="캐릭터 프롬프트"]', `extra character ${n}`);
  }
  await fill('[aria-label="모델 입력 형식"]', 'v4.5');
  await until(
    "document.querySelector('.pw-limit-warning')?.innerText.includes('활성 7명')",
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-testid=generate-preview]').disabled",
    ),
  );
  await click('#pw-field-3');
  await evaluate(
    "document.querySelectorAll('.pw-character-tabs button[aria-pressed]')[0].click()",
  );
  await click('#pw-field-3');
  assert.equal(
    await evaluate(
      'document.querySelector(\'[aria-label="캐릭터 추가"]\')?.disabled',
    ),
    false,
  );
  for (let n = 0; n < 5; n++) {
    await evaluate(
      "Array.from(document.querySelectorAll('.pw-character-tabs button[aria-pressed]')).at(-1).click()",
    );
    await click('[aria-label="캐릭터 삭제"]');
  }
  await evaluate(
    "document.querySelectorAll('.pw-character-tabs button[aria-pressed]')[0].click()",
  );
  await click('#pw-field-3');
  checks.push(
    'model limit warns immediately and add follows active rather than stored count',
  );
  // A queue failure uses the same global alert area on the new screen.
  await fill('[aria-label="예제 응답"]', 'connection');
  await click('[data-testid="reserve-scenes"]');
  await click('[data-testid="start-queue"]');
  await until(
    "document.querySelector('.alert-window [role=alert]')?.innerText.includes('입력은 그대로')",
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.pw-queue-jobs [data-status=failed]').length",
    ),
    1,
  );
  await click('.alert-window button');
  await fill('[aria-label="예제 응답"]', 'success');
  await click('[data-testid="reserve-scenes"]');
  await click('[data-testid="start-queue"]');
  await until(
    "document.querySelectorAll('.pw-queue-jobs [data-status=done]').length===6",
  );
  checks.push('queue failure stops and displays a shared global alert');
  await evaluate(`document.querySelector('.pw-review-options').open=false`);
  if (process.env.SDSTUDIO_SMOKE_SCREENSHOT)
    fs.writeFileSync(
      process.env.SDSTUDIO_SMOKE_SCREENSHOT,
      (await contents.capturePage()).toPNG(),
    );
  if (process.env.SDSTUDIO_SMOKE_LIGHT_SCREENSHOT) {
    await click('[aria-label="테마 전환"]');
    await until(
      "document.querySelector('.preview-workspace').classList.contains('pw-light')",
    );
    fs.writeFileSync(
      process.env.SDSTUDIO_SMOKE_LIGHT_SCREENSHOT,
      (await contents.capturePage()).toPNG(),
    );
    await click('[aria-label="테마 전환"]');
  }
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
  await fill('[aria-label="시드 방식"]', 'fixed');
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
  await evaluate(
    "document.querySelector('.pw-scene-queue').scrollIntoView({block:'start'})",
  );
  await click('[data-testid="reserve-scenes"]');
  await click('[data-testid="start-queue"]');
  await until(
    "!!document.querySelector('.pw-queue-jobs [data-status=running]')",
  );
  await click('[data-testid="stop-queue"]');
  await until(
    "document.querySelectorAll('.pw-queue-jobs [data-status=done]').length===1 && !document.querySelector('.pw-queue-jobs [data-status=running]')",
  );
  assert.ok(
    await evaluate(
      "document.querySelector('.preview-workspace').scrollWidth <= document.querySelector('.preview-workspace').clientWidth + 1",
    ),
  );
  assert.ok(
    await evaluate(
      "(() => {const r=document.querySelector('[data-testid=reserve-scenes]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;})()",
    ),
  );
  checks.push(
    '390px scene queue can reserve, start and stop without horizontal overflow',
  );
  if (process.env.SDSTUDIO_SMOKE_QUEUE_SCREENSHOT)
    fs.writeFileSync(
      process.env.SDSTUDIO_SMOKE_QUEUE_SCREENSHOT,
      (await contents.capturePage()).toPNG(),
    );
  return {
    checks,
    desktop: desktopSize.join('x'),
    narrow: (await evaluate('[innerWidth,innerHeight]')).join('x'),
    simulatedErrors: true,
  };
};
