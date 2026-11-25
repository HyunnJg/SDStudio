// Test only: synthetic local File/drag events; no path/PNG upload IPC or generation requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { BrowserWindow } = require('electron');
const {
  fixture,
  metadata,
} = require('../../src/__tests__/fixtures/nai/metadataPNG.cjs');
module.exports = async ({ contents, evaluate, click, until, checks }) => {
  assert.equal(await evaluate("!!document.querySelector('[data-testid=open-metadata]').closest('.connected-input')"), true);
  const storedBefore = (
    await evaluate('window.electron.projects.list()')
  ).value.map((p) => [p.id, p.revision]);
  const before = await evaluate(
    "[document.querySelector('#live-prompt').value,document.querySelector('#live-negative').value,document.querySelector('#live-seed-mode').value,document.querySelector('#live-seed').value,document.querySelector('#live-steps').value,document.querySelector('#live-guidance').value]",
  );
  const open = async (file, drop = false) => {
    const bytes = Array.from(file.bytes);
    await evaluate(
      `(()=>{const file=new File([new Uint8Array(${JSON.stringify(bytes)})],'synthetic-metadata.png',{type:'image/png'});const data=new DataTransfer();data.items.add(file);${drop ? "document.querySelector('[data-testid=connected-workspace]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:data}));" : "const input=document.querySelector('[data-testid=metadata-file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));"}})()`,
    );
    await until(() =>
      evaluate("document.querySelector('[data-testid=metadata-dialog]')?.open"),
    );
  };
  const unsafe = metadata();
  const unsafeComment = JSON.parse(unsafe.Comment);
  unsafeComment.v4_prompt.caption.base_caption =
    '<img src=x onerror="window.__metadataInjected=true">';
  unsafe.Comment = JSON.stringify(unsafeComment);
  await open(fixture(unsafe));
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=apply-metadata]')"),
  );
  assert.equal(
    await evaluate(
      "!!document.querySelector('[data-testid=metadata-dialog] img[onerror]') || !!window.__metadataInjected",
    ),
    false,
  );
  assert.ok(
    (
      await evaluate(
        "document.querySelector('[data-testid=metadata-dialog]').textContent",
      )
    ).includes('rescale'),
  );
  await click('[aria-label="메타데이터 창 닫기"]');
  assert.equal(
    await evaluate("document.querySelector('#live-prompt').value"),
    before[0],
  );
  checks.push(
    'file chooser opens itemized metadata preview; cancel preserves all current editor text',
  );
  await open(fixture(), true);
  await until(() =>
    evaluate("!!document.querySelector('[data-testid=apply-metadata]')"),
  );
  for (const field of ['prompt', 'negativePrompt', 'characters', 'settings'])
    await click(`[data-import-field=${field}]`);
  await click('[data-testid=apply-metadata]');
  await until(() =>
    evaluate("!document.querySelector('[data-testid=metadata-dialog]').open"),
  );
  assert.deepEqual(
    await evaluate(
      "[document.querySelector('#live-prompt').value,document.querySelector('#live-negative').value,document.querySelector('#live-seed-mode').value,document.querySelector('#live-seed').value,document.querySelector('#live-steps').value,document.querySelector('#live-guidance').value]",
    ),
    [before[0], before[1], 'fixed', '0', before[4], before[5]],
  );
  checks.push(
    'drag/drop seed-only import preserves prompt/characters/settings and accepts fixed seed0 without saving or sending',
  );
  for (const selected of ['prompt', 'negativePrompt', 'settings']) {
    await evaluate(`(()=>{
      for (const [id,value] of [['live-quality','standard'],['live-uc-preset','heavy']]) {
        const input=document.getElementById(id);input.value=value;
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }
    })()`);
    const previous = await evaluate(
      "[document.querySelector('#live-prompt').value,document.querySelector('#live-negative').value,document.querySelector('#live-steps').value,document.querySelector('#live-guidance').value]",
    );
    await open(fixture());
    await until(() =>
      evaluate("!!document.querySelector('[data-testid=apply-metadata]')"),
    );
    assert.ok(
      (
        await evaluate(
          "document.querySelector('[data-testid=metadata-dialog]').textContent",
        )
      ).includes('최종 태그가 포함된 원문'),
    );
    for (const field of [
      'prompt',
      'negativePrompt',
      'characters',
      'settings',
      'seed',
    ])
      if (field !== selected) await click(`[data-import-field=${field}]`);
    await click('[data-testid=apply-metadata]');
    await until(() =>
      evaluate("!document.querySelector('[data-testid=metadata-dialog]').open"),
    );
    assert.deepEqual(
      await evaluate(
        "[document.querySelector('#live-quality').value,document.querySelector('#live-uc-preset').value]",
      ),
      [
        selected === 'prompt' ? 'none' : 'standard',
        selected === 'negativePrompt' ? 'none' : 'heavy',
      ],
    );
    const current = await evaluate(
      "[document.querySelector('#live-prompt').value,document.querySelector('#live-negative').value,document.querySelector('#live-steps').value,document.querySelector('#live-guidance').value]",
    );
    if (selected === 'settings')
      assert.deepEqual(current.slice(0, 2), previous.slice(0, 2));
    else assert.deepEqual(current.slice(2), previous.slice(2));
    checks.push(
      `${selected}-only import preserves unrelated presets and inputs, with an explicit preview notice`,
    );
  }
  await open(fixture(metadata(), { format: 'alpha' }), true);
  await until(() =>
    evaluate(
      "!!document.querySelector('[data-testid=apply-metadata]') || !!document.querySelector('[data-testid=metadata-dialog] [role=alert]')",
    ),
  );
  assert.equal(
    await evaluate("!!document.querySelector('[data-testid=apply-metadata]')"),
    true,
    await evaluate(
      "document.querySelector('[data-testid=metadata-dialog]').textContent",
    ),
  );
  assert.ok(
    (
      await evaluate(
        "document.querySelector('[data-testid=metadata-dialog]').textContent",
      )
    ).includes('알파 채널'),
  );
  const window = BrowserWindow.fromWebContents(contents);
  window.setMinimumSize(360, 500);
  window.setSize(390, 844);
  await until(() => evaluate('innerWidth===390'));
  assert.equal(
    await evaluate(
      "(()=>{const d=document.querySelector('[data-testid=metadata-dialog]');return d.scrollWidth<=d.clientWidth && d.getBoundingClientRect().right<=innerWidth})()",
    ),
    true,
  );
  if (process.env.SDSTUDIO_METADATA_SCREENSHOT)
    fs.writeFileSync(
      process.env.SDSTUDIO_METADATA_SCREENSHOT,
      (await contents.capturePage()).toPNG(),
    );
  await click('[data-testid=apply-metadata]');
  await until(() =>
    evaluate("document.querySelectorAll('[data-character-id]').length===2"),
  );
  assert.equal(
    await evaluate("document.querySelector('#live-prompt').value"),
    '가상의 정원, two people',
  );
  assert.equal(
    await evaluate("document.querySelector('#live-steps').value"),
    '28',
  );
  assert.equal(
    await evaluate("document.querySelector('#live-guidance').value"),
    '5.5',
  );
  assert.equal(
    await evaluate("document.querySelector('#live-quality').value"),
    'none',
  );
  assert.equal(
    await evaluate("document.querySelector('#live-uc-preset').value"),
    'none',
  );
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('[data-character-prompt]')].map(i=>i.value)",
    ),
    ['blue coat', 'red coat'],
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-character-negative]')[1].value",
    ),
    'hat',
  );
  checks.push(
    'real Chromium alpha LSB/gzip metadata imports ordered character texts/negative pairing;390px dialog fits; unsupported rescale stays an explicit notice',
  );
  await open({ ...fixture(), bytes: Buffer.from('not a PNG') });
  await until(() =>
    evaluate(
      "!!document.querySelector('[data-testid=metadata-dialog] [role=alert]')",
    ),
  );
  assert.equal(
    await evaluate("!!document.querySelector('[data-testid=apply-metadata]')"),
    false,
  );
  assert.equal(
    await evaluate("document.querySelector('#live-prompt').value"),
    '가상의 정원, two people',
  );
  await click('[aria-label="메타데이터 창 닫기"]');
  checks.push(
    'invalid file exposes fixed local error without changing imported/current input',
  );
  await click('[data-testid=project-new]');
  await until(() =>
    evaluate("document.querySelector('[data-testid=project-confirm]')?.open"),
  );
  await click('[data-testid=project-confirm-discard]');
  await until(() =>
    evaluate("document.querySelectorAll('[data-character-id]').length===0"),
  );
  // Reopening the same file and dismissing immediately must not resurrect the dialog on late completion.
  await evaluate(
    '(()=>{const original=window.createImageBitmap;window.__restoreMetadataBitmap=()=>{window.createImageBitmap=original};window.createImageBitmap=(...args)=>new Promise(resolve=>setTimeout(()=>resolve(original(...args)),150));})()',
  );
  await open(fixture(metadata(), { format: 'alpha' }));
  await click('[aria-label="메타데이터 창 닫기"]');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    await evaluate(
      "document.querySelector('[data-testid=metadata-dialog]').open",
    ),
    false,
  );
  assert.equal(
    await evaluate("document.querySelectorAll('[data-character-id]').length"),
    0,
  );
  await evaluate('window.__restoreMetadataBitmap()');
  assert.deepEqual(
    (await evaluate('window.electron.projects.list()')).value.map((p) => [
      p.id,
      p.revision,
    ]),
    storedBefore,
  );
  checks.push(
    'closing a read in progress discards late metadata and leaves the replacement project unchanged',
  );
  window.setSize(1400, 900);
  await until(() => evaluate('innerWidth===1400'));
};
