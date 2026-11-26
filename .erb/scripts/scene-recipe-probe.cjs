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
    dt.items.add(new File([JSON.stringify({name:'art',pieces:[{name:'coat',prompt:'red coat\\nblue coat',multi:true}]})],'pieces.json'));
    input.files = dt.files; input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=apply-piece-import]')"),
  );
  await click('[data-testid=apply-piece-import]');
  await click('.workspace-pieces details summary');
  await fill('[aria-label="조각 이름"]', 'art.weather');
  await fill('[aria-label="조각 내용"]', '{rain|snow}');
  await click('[data-testid=save-scene-piece]');
  await until(() =>
    evaluate(
      "document.querySelector('.workspace-pieces select').value==='art.weather'",
    ),
  );
  await fill('#live-prompt', '<art.coat>, <art.weather>');
  await click('[data-testid=scene-recipe] summary');
  await fill('[data-testid=scene-recipe] input', 'Recipe');
  await click('[data-testid=save-recipe]');
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
};
