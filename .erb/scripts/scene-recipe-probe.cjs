const assert = require('node:assert/strict');

module.exports = async ({ evaluate, click, fill, until, checks, requests }) => {
  const select = async (selector, value) =>
    evaluate(`(() => {
    const s = document.querySelector(${JSON.stringify(selector)}); s.value = ${JSON.stringify(value)};
    s.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  assert.ok(
    (
      await evaluate(
        "window.electron.naiAuth.setToken('synthetic-never-a-real-token',false)",
      )
    ).ok,
  );
  await select('#live-model', 'nai-diffusion-furry-3');
  await select('#live-size', 'custom');
  await fill('.connected-model-settings fieldset input', '640');
  await fill(
    '.connected-model-settings fieldset label:nth-of-type(2) input',
    '896',
  );
  await click('.connected-model-settings fieldset button');
  await click('.workspace-pieces summary');
  await evaluate(`(() => {
    const input = document.querySelector('.workspace-pieces input');
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify({name:'art',pieces:[{name:'coat',prompt:'red coat\\n \\nblue coat\\n',multi:true}]})],'pieces.json'));
    input.files = dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=apply-piece-import]')"),
  );
  assert.match(
    await evaluate(
      "document.querySelector('[data-testid=apply-piece-import]').textContent",
    ),
    /빈 줄 2개 제외/,
  );
  await click('[data-testid=apply-piece-import]');
  await click('.workspace-pieces details summary');
  await fill('[aria-label="조각 이름"]', 'art.weather');
  await click('.workspace-pieces details input[type=checkbox]');
  await fill('[aria-label="조각 내용"]', '{rain|snow}\n \n');
  assert.match(
    await evaluate(
      "document.querySelector('.workspace-pieces details').textContent",
    ),
    /빈 줄 2개 제외/,
  );
  await click('[data-testid=save-scene-piece]');
  await until(() =>
    evaluate(
      "document.querySelector('.workspace-pieces select').value==='art.weather'",
    ),
  );
  assert.equal(
    await evaluate(
      'document.querySelector(\'[aria-label="조각 내용"]\').value',
    ),
    '{rain|snow}',
  );
  await select('#live-seed-mode', 'fixed');
  await fill('#live-seed', '7');
  await fill('#live-prompt', '<art.coat>, <art.weather>');
  await click('[data-testid=scene-recipe] summary');
  await fill('[data-testid=scene-recipe] input', 'Recipe');
  const legacy = JSON.stringify([
    {
      name: 'Legacy',
      styleId: '',
      characterIds: [],
      situations: [{ name: 'old', setting: 'garden', emotion: 'smile' }],
    },
  ]);
  await evaluate(
    `localStorage.setItem('sdstudio.scene-recipes.v1', ${JSON.stringify(legacy)})`,
  );
  await click('[data-testid=save-recipe]');
  assert.equal(
    await evaluate("localStorage.getItem('sdstudio.scene-recipes.v1')"),
    legacy,
  );
  await select('[data-testid=scene-recipe] select', 'Legacy');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=scene-recipe] input').value==='Legacy'",
    ),
  );
  await select('[data-testid=scene-recipe] select', ' ');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=scene-recipe] input').value===''",
    ),
  );
  await select('[data-testid=scene-recipe] select', 'Recipe');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=scene-recipe] input').value==='Recipe'",
    ),
  );
  checks.push('named recipe reloads from profile storage');
  await fill('#live-interval', '0');
  await fill('#live-repeats', '2');
  await click('[data-testid=prepare-recipe]');
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
  );
  assert.ok(
    await evaluate(
      "document.querySelector('[data-testid=queue-confirm]').textContent.includes('같은 선택')",
    ),
  );
  assert.equal(requests(), 0);
  checks.push(
    'recipe created a persisted scene and prepared two jobs without sending',
  );
  await click('[data-testid=send-live-queue]');
  await until(
    async () =>
      requests() === 2 &&
      (await evaluate(
        "document.querySelector('[data-testid=generation-status]').textContent.includes('완료')",
      )),
  );
  checks.push(
    'two V3 custom-size requests used the imported multi-line piece and resolved choice; both originals saved',
  );

  await select('#live-model', 'nai-diffusion-5-full');
  await click('[data-testid=add-live-character]');
  await fill(
    '[data-character-prompt]',
    'silver hair\n\nnavy coat\n\nfolded arms',
  );
  const png = require('../../src/__tests__/fixtures/nai/png.cjs').png();
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(${JSON.stringify(Array.from(png))})],'synthetic.png',{type:'image/png'}));
    const picker = document.querySelector('[data-testid=metadata-file]');
    picker.files=transfer.files; picker.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=image-use-variation]')"),
  );
  await click('[data-testid=image-use-variation]');
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=reference-panel] img')"),
  );
  const panel = '[data-testid=scene-recipe]';
  await select(panel + ' select', ' ');
  await fill(panel + ' input', 'Named cuts');
  await click('[data-testid=add-recipe-cut]');
  await click('[data-testid=capture-cut]');
  assert.equal(
    await evaluate(
      "document.querySelector('[data-testid=scene-recipe] textarea').value",
    ),
    'folded arms',
  );
  await fill(panel + ' textarea', 'at the desk, reading a letter');
  await fill(panel + ' input[inputmode=decimal]', '0.90');
  await click('[data-testid=save-recipe]');
  await select(panel + ' select', ' ');
  await select(panel + ' select', 'Named cuts');
  assert.equal(
    await evaluate(
      "document.querySelector('[data-testid=scene-recipe] textarea').value",
    ),
    'at the desk, reading a letter',
  );
  await click('[data-testid=prepare-recipe]');
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=queue-confirm] li')"),
  );
  assert.ok(
    await evaluate(
      "Array.from(document.querySelectorAll('[data-testid=queue-confirm] li')).every(n=>n.textContent.includes('I2I 강도 0.9'))",
    ),
  );
  assert.equal(requests(), 2);
  checks.push(
    'legacy recipe stays readable; named cut, paragraph replacement and I2I strength reload into queue confirmation without a send',
  );
  await click('[data-testid=queue-confirm] button:last-of-type');
  await select(panel + ' select', ' ');
  await fill('#live-repeats', '1');
  await click('[data-testid=open-vibe-editor]');
  const assistant = '[data-testid=recipe-assistant]';
  await fill(assistant + ' textarea', '표정 세 컷, 각 두 장');
  await click(assistant + ' fieldset button');
  await click('.vibe-api-settings summary');
  const keys = '[data-testid=provider-key-settings]';
  const provider = '.vibe-api-settings .vibe-model-fields select';
  await select(provider, 'vertex');
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.vibe-api-settings .vibe-model-fields select')[1].value",
    ),
    'gemini-3.5-flash',
  );
  await select(provider, 'openrouter');
  assert.match(
    await evaluate(
      "document.querySelector('[data-testid=provider-key-settings]').textContent",
    ),
    /Privacy 설정에서 무료 모델과 유료 모델/,
  );
  await select(provider, 'gemini');
  await until(() =>
    evaluate(
      "!document.querySelector('[data-testid=provider-key-settings]').disabled",
    ),
  );
  await fill(keys + ' input[type=password]', 'pst-synthetic-test-only');
  await click(keys + ' button');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=provider-key-settings] [role=status]').textContent.includes('NovelAI')",
    ),
  );
  await fill(keys + ' input[type=password]', 'synthetic-gemini-key');
  await click(keys + ' button');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=provider-key-settings]').textContent.includes('키 보관 중') && document.querySelector('#gemini-billing-notice').checkVisibility()",
    ),
  );
  await click('[data-testid=nai-auth-dialog] header button');
  assert.equal(
    await evaluate(
      "document.querySelector('[data-testid=recipe-assistant] textarea').value",
    ),
    '표정 세 컷, 각 두 장',
  );
  await click('[data-testid=request-vibe]');
  await until(() =>
    evaluate(
      "document.querySelectorAll('[data-testid=recipe-assistant] li').length === 3",
    ),
  );
  assert.equal(
    await evaluate("document.querySelector('#live-repeats').value"),
    '1',
  );
  await click('[data-testid=apply-vibe]');
  assert.equal(
    await evaluate("document.querySelector('#live-repeats').value"),
    '2',
  );
  await fill(
    panel + ' > fieldset > fieldset:last-of-type textarea',
    'relieved, soft smile',
  );
  await click('[data-testid=prepare-recipe]');
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=queue-confirm]')"),
  );
  assert.match(
    await evaluate(
      "document.querySelector('[data-testid=prepare-recipe]').textContent",
    ),
    /6장/,
  );
  assert.equal(requests(), 2);
  checks.push(
    'Gemini key entry, three proposed cuts, explicit apply, editable character text and six-image queue review without extra generation',
  );
  await click('[data-testid=queue-confirm] button:last-of-type');
  await select(panel + ' select', 'Named cuts');
  await click('[data-testid=delete-recipe]');
  await click('[aria-label="조합 삭제 확인"] button:last-child');
  const stored = await evaluate(
    "JSON.parse(localStorage.getItem('sdstudio.scene-recipes.v2')).map(row => row.name)",
  );
  assert.ok(!stored.includes('Named cuts') && stored.includes('Legacy'));
  const count = await evaluate("document.querySelector('#live-scene').length");
  await click('[data-testid=manage-scene]');
  await click('[data-testid=remove-scene]');
  await click('[data-testid=remove-scene-confirm]');
  assert.equal(
    await evaluate("document.querySelector('#live-scene').length"),
    count - 1,
  );
  checks.push(
    'removed one saved recipe and one workspace scene with confirmation',
  );

  const bridge = 'dialog[aria-label="V3 자료 가져오기"]';
  await click('.connected-menu summary');
  for (const [type, scene, name] of [
    ['scene', 'Test', 'favorite.png'],
    ['inpaint', 'Retouch', 'output.png'],
  ]) {
    await click('[data-testid=open-legacy-import]');
    await until(() =>
      evaluate(
        "!!document.querySelector('dialog[aria-label=\"V3 자료 가져오기\"] select option[value=Bridge]') || Array.from(document.querySelectorAll('dialog[aria-label=\"V3 자료 가져오기\"] select option')).some(o=>o.value==='Bridge')",
      ),
    );
    await select(bridge + ' select', 'Bridge');
    await until(() =>
      evaluate(
        '!!document.querySelector(\'dialog[aria-label="V3 자료 가져오기"] fieldset\')',
      ),
    );
    if (type === 'scene') {
      await select(bridge + ' fieldset select', 'Sky');
      await click(bridge + ' fieldset button');
      await until(() =>
        evaluate(
          "document.querySelector('dialog[aria-label=\"V3 자료 가져오기\"] [role=status]').textContent.includes('1개 추가')",
        ),
      );
      await click(bridge + ' fieldset button');
      assert.match(
        await evaluate(
          'document.querySelector(\'dialog[aria-label="V3 자료 가져오기"] [role=status]\').textContent',
        ),
        /같은 이름 1개 유지/,
      );
    }
    await select(
      bridge + ' fieldset:last-of-type select',
      JSON.stringify([type, scene, name]),
    );
    await click(bridge + ' fieldset:last-of-type button');
    await until(() =>
      evaluate("!!document.querySelector('[data-testid=image-choice]')"),
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.workspace-image-filename').textContent",
      ),
      name,
    );
    await click('[data-testid=image-choice] header button');
  }
  checks.push(
    'V3 session pieces merge once; favorite and inpaint PNGs both reached the workspace image picker',
  );
  await click('[data-testid=project-save]');
  await until(() =>
    evaluate(
      "!document.querySelector('[data-testid=project-dirty]').textContent.includes('미저장')",
    ),
  );
  const projects = await evaluate('window.electron.projects.list()');
  const manifest = require('node:path').join(
    process.env.SDSTUDIO_USER_DATA_DIR,
    'projects-v1',
    projects.value[0].id,
    'project.json',
  );
  const saved = JSON.parse(require('node:fs').readFileSync(manifest));
  assert.equal(saved.images.length, 2);
  assert.equal(saved.scenes.length, count - 1);
  checks.push('saved remaining scenes and both original results after removal');
};
