const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const {
  readPNGMetadata,
  inspectPNG,
  readAlphaMetadata,
  PNG_IMPORT_LIMITS,
  decompressMetadata,
} = require('../renderer/metadata/pngMetadata');
const {
  planMetadataImport,
  applyMetadataImport,
  availableImportFields,
} = require('../renderer/metadata/metadataImport');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const { bindBasicGeneration } = require('../main/nai/workspaceBinding');
const { V5_CHARACTER_LIMIT } = require('../workspaceGenerationSettings');
const { default: crc } = require('../pngCRC');
const { fixture, metadata, chunk } = require('./fixtures/nai/metadataPNG.cjs');
const signal = () => new AbortController().signal;
const read = (file, control = signal()) =>
  readPNGMetadata(file.bytes, control, async () => file.pixels);
test('tEXt preserves Korean and exact captions, does not alter PNG or decode alpha when text is available', async () => {
  const f = fixture(),
    before = Buffer.from(f.bytes);
  let decodes = 0;
  const m = await readPNGMetadata(f.bytes, signal(), async () => {
    decodes++;
    return f.pixels;
  });
  assert.equal(m.source, 'text');
  assert.equal(m.comment.seed, 0);
  assert.equal(m.comment.prompt, '가상의 정원, two people');
  assert.equal(decodes, 0);
  assert.deepEqual(f.bytes, before);
});
for (const format of ['ztxt', 'itxt', 'itxt-plain'])
  test(`${format} yields the same bounded metadata`, async () => {
    const m = await read(fixture(metadata(), { format }));
    assert.deepEqual(m.comment, JSON.parse(metadata().Comment));
  });
test('alpha LSB column-major/MSB-first gzip metadata is decoded; text takes precedence over a different alpha copy', async () => {
  const f = fixture(metadata(), { format: 'alpha' }),
    before = Uint8ClampedArray.from(f.pixels.data);
  const m = await read(f);
  assert.equal(m.source, 'alpha');
  assert.equal(m.comment.seed, 0);
  assert.deepEqual(f.pixels.data, before);
  const changed = {
    ...metadata(),
    Comment: JSON.stringify({ ...JSON.parse(metadata().Comment), seed: 123 }),
  };
  assert.equal(
    (await read(fixture(metadata(), { alpha: changed }))).comment.seed,
    0,
  );
});
test('invalid or absent regular Comment falls back to alpha; missing metadata has a fixed error', async () => {
  const f = fixture({ Comment: 'not json' }, { alpha: metadata() });
  assert.equal((await read(f)).source, 'alpha');
  await assert.rejects(read(fixture({}, { format: 'none' })), {
    code: 'PNG_MISSING',
  });
});
test('damaged CRC, trailing bytes, truncated/oversized chunks and duplicate Comment fail before unsafe reads', async () => {
  const f = fixture();
  const bad = Buffer.from(f.bytes);
  bad[35] ^= 1;
  await assert.rejects(read({ ...f, bytes: bad }), { code: 'PNG_INPUT' });
  await assert.rejects(
    read({ ...f, bytes: Buffer.concat([f.bytes, Buffer.from([0])]) }),
    { code: 'PNG_INPUT' },
  );
  await assert.rejects(read({ ...f, bytes: f.bytes.subarray(0, -4) }), {
    code: 'PNG_INPUT',
  });
  const long = Buffer.from(f.bytes);
  long.writeUInt32BE(0xffffffff, 8);
  await assert.rejects(read({ ...f, bytes: long }), { code: 'PNG_INPUT' });
  const duplicate = Buffer.concat([
    f.bytes.subarray(0, -12),
    chunk('tEXt', Buffer.from('Comment\0{}')),
    f.bytes.subarray(-12),
  ]);
  await assert.rejects(read({ ...f, bytes: duplicate }), {
    code: 'PNG_METADATA',
  });
});
test('pixel/byte limits are checked before native pixel decoding', async () => {
  const f = fixture(),
    huge = Buffer.from(f.bytes);
  huge.writeUInt32BE(PNG_IMPORT_LIMITS.pixels + 1, 16);
  huge.writeUInt32BE(crc(huge.subarray(12, 29)), 29);
  await assert.rejects(read({ ...f, bytes: huge }), { code: 'PNG_LIMIT' });
  assert.throws(() => inspectPNG(new Uint8Array(PNG_IMPORT_LIMITS.bytes + 1)), {
    code: 'PNG_LIMIT',
  });
});
test('compressed metadata output, declaration length and invalid compression are bounded', async () => {
  const bomb = fixture(
    { Comment: 'x'.repeat(PNG_IMPORT_LIMITS.metadata + 1) },
    { format: 'ztxt' },
  );
  await assert.rejects(read(bomb), { code: 'PNG_LIMIT' });
  const f = fixture(metadata(), { format: 'alpha', bitLength: 0xfffffff8 });
  await assert.rejects(read(f), { code: 'PNG_LIMIT' });
  await assert.rejects(
    read(fixture(metadata(), { format: 'alpha', bitLength: 3 })),
    { code: 'PNG_METADATA' },
  );
  await assert.rejects(
    read(
      fixture(metadata(), {
        format: 'alpha',
        alphaBytes: Buffer.from('bad gzip'),
      }),
    ),
    { code: 'PNG_METADATA' },
  );
});
test('aborting before or during decoding discards results', async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(read(fixture(), c.signal), { code: 'CANCELLED' });
  let release;
  const d = new AbortController(),
    f = fixture(metadata(), { format: 'alpha' });
  const pending = readPNGMetadata(
    f.bytes,
    d.signal,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  d.abort();
  release(f.pixels);
  await assert.rejects(pending, { code: 'CANCELLED' });
});
test('a giant gzip output is rejected without returning partial metadata', async () => {
  await assert.rejects(
    decompressMetadata(
      zlib.gzipSync(Buffer.alloc(2 * PNG_IMPORT_LIMITS.metadata, 65)),
      'gzip',
      signal(),
    ),
    { code: 'PNG_LIMIT' },
  );
});
test('selected fields alone replace the draft, keep seed0, make fresh character UUIDs and leave source intact', async () => {
  const d = createConnectedWorkspaceState().draft,
    m = await read(fixture()),
    plan = planMetadataImport(m, d),
    before = structuredClone(d);
  assert.deepEqual(availableImportFields(plan), [
    'prompt',
    'negativePrompt',
    'characters',
    'settings',
    'seed',
  ]);
  const prompts = applyMetadataImport(d, plan, ['prompt']);
  assert.equal(prompts.prompt, m.comment.prompt);
  assert.deepEqual(prompts.characters, d.characters);
  assert.equal(prompts.seedMode, d.seedMode);
  assert.deepEqual(d, before);
  let id = 0;
  const all = applyMetadataImport(
    d,
    plan,
    availableImportFields(plan),
    () => `local-${++id}`,
  );
  assert.equal(all.family, 'v5');
  assert.equal(all.seedMode, 'fixed');
  assert.equal(all.seed, '0');
  assert.equal(all.steps, '28');
  assert.equal(all.guidance, '5.5');
  assert.equal(all.placement, 'auto');
  assert.equal(all.qualityTags, 'none');
  assert.equal(all.ucPreset, 'none');
  assert.deepEqual(
    all.characters.map((c) => [c.id, c.prompt, c.negativePrompt]),
    [
      ['local-1', 'blue coat', ''],
      ['local-2', 'red coat', 'hat'],
    ],
  );
  assert.ok(plan.notices.some((n) => n.includes('좌표')));
  assert.ok(plan.notices.some((n) => n.includes('rescale')));
});
test('mismatched or too many character captions cannot silently replace existing characters', async () => {
  const d = createConnectedWorkspaceState().draft,
    m = await read(fixture());
  m.comment.v4_negative_prompt.caption.char_captions = [
    { char_caption: 'hat' },
  ];
  let plan = planMetadataImport(m, d);
  assert.equal(plan.characters, undefined);
  assert.deepEqual(
    applyMetadataImport(d, plan, ['characters']).characters,
    d.characters,
  );
  m.comment.v4_prompt.caption.char_captions = Array.from(
    { length: 23 },
    () => ({ char_caption: 'a' }),
  );
  plan = planMetadataImport(m, d);
  assert.equal(plan.characters, undefined);
});
test('unsupported sizes/settings and image references are described; model does not change on import', async () => {
  const d = createConnectedWorkspaceState().draft,
    m = await read(fixture());
  Object.assign(m.comment, {
    width: 1025,
    height: 1025,
    steps: 999,
    scale: 999,
    strength: 0.5,
    model: 'unsupported-model',
    seed: -1,
  });
  const plan = planMetadataImport(m, d);
  assert.deepEqual(plan.settings, {});
  assert.equal(plan.seed, undefined);
  const next = applyMetadataImport(d, plan, ['settings', 'seed']);
  assert.deepEqual(next, d);
  assert.ok(plan.notices.some((n) => n.includes('Image2Image')));
  assert.ok(plan.notices.some((n) => n.includes('모델')));
});
test('empty character list explicitly clears only when selected; malformed strings are unavailable', async () => {
  const d = createConnectedWorkspaceState().draft,
    m = await read(fixture());
  m.comment.v4_prompt.caption.char_captions = [];
  m.comment.v4_negative_prompt.caption.char_captions = [];
  m.comment.prompt = 'x\0y';
  m.comment.v4_prompt.caption.base_caption = 'x\0y';
  const plan = planMetadataImport(m, d);
  assert.equal(plan.prompt, undefined);
  assert.deepEqual(plan.characters, []);
  assert.deepEqual(applyMetadataImport(d, plan, ['characters']).characters, []);
});

for (const format of ['text', 'alpha'])
  for (const fields of [
    ['prompt'],
    ['negativePrompt'],
    ['prompt', 'negativePrompt'],
  ])
    test(`${format}: ${fields.join('+')} import rebinds final captions without duplicate quality/UC text`, async () => {
      const scene = createConnectedWorkspaceState().scenes[0];
      scene.draft.prompt = '1girl, park';
      scene.draft.negativePrompt = 'blur';
      const original = bindBasicGeneration(scene, () => 12345).request;
      const m = await read(
        fixture(
          {
            Comment: JSON.stringify({
              ...original.parameters,
              model: original.model,
            }),
          },
          { format },
        ),
      );
      const plan = planMetadataImport(m, scene.draft);
      const before = structuredClone(scene.draft);
      const next = applyMetadataImport(scene.draft, plan, fields);
      const rebound = bindBasicGeneration(
        { ...scene, draft: next },
        () => 12345,
      ).request;
      assert.equal(rebound.input, original.input);
      assert.equal(
        rebound.parameters.v4_prompt.caption.base_caption,
        original.input,
      );
      assert.equal(
        rebound.parameters.negative_prompt,
        original.parameters.negative_prompt,
      );
      assert.equal(
        rebound.parameters.v4_negative_prompt.caption.base_caption,
        original.parameters.v4_negative_prompt.caption.base_caption,
      );
      assert.equal(
        next.qualityTags,
        fields.includes('prompt') ? 'none' : before.qualityTags,
      );
      assert.equal(
        next.ucPreset,
        fields.includes('negativePrompt') ? 'none' : before.ucPreset,
      );
      assert.deepEqual(applyMetadataImport(next, plan, fields), next);
      assert.deepEqual(scene.draft, before);
    });

test('settings-only import preserves both preset choices and unselected captions', async () => {
  const draft = createConnectedWorkspaceState().draft;
  const plan = planMetadataImport(await read(fixture()), draft);
  const next = applyMetadataImport(draft, plan, ['settings']);
  assert.equal(next.steps, '28');
  assert.equal(next.guidance, '5.5');
  for (const field of [
    'prompt',
    'negativePrompt',
    'qualityTags',
    'ucPreset',
    'seedMode',
  ])
    assert.equal(next[field], draft[field]);
});

test('empty imported captions disable corresponding presets; unavailable captions leave them intact', async () => {
  const draft = createConnectedWorkspaceState().draft;
  const m = await read(
    fixture({ Comment: JSON.stringify({ prompt: '', uc: '' }) }),
  );
  const next = applyMetadataImport(draft, planMetadataImport(m, draft), [
    'prompt',
    'negativePrompt',
  ]);
  assert.deepEqual(
    [next.prompt, next.negativePrompt, next.qualityTags, next.ucPreset],
    ['', '', 'none', 'none'],
  );
  const absent = planMetadataImport({ ...m, comment: {} }, draft);
  assert.deepEqual(
    applyMetadataImport(draft, absent, ['prompt', 'negativePrompt']),
    draft,
  );
});

for (const count of [7, V5_CHARACTER_LIMIT])
  test(`${count} character captions import without truncation using the shared V5 limit`, async () => {
    const draft = createConnectedWorkspaceState().draft;
    const m = await read(fixture());
    m.comment.v4_prompt.caption.char_captions = Array.from(
      { length: count },
      (_, i) => ({ char_caption: `character-${i}` }),
    );
    m.comment.v4_negative_prompt.caption.char_captions = Array.from(
      { length: count },
      (_, i) => ({ char_caption: `negative-${i}` }),
    );
    let id = 0;
    const next = applyMetadataImport(
      draft,
      planMetadataImport(m, draft),
      ['characters'],
      () => `character-${++id}`,
    );
    assert.equal(next.characters.length, count);
    assert.deepEqual(
      next.characters.map((c) => [c.prompt, c.negativePrompt]),
      Array.from({ length: count }, (_, i) => [
        `character-${i}`,
        `negative-${i}`,
      ]),
    );
    assert.equal(next.qualityTags, draft.qualityTags);
    assert.equal(next.ucPreset, draft.ucPreset);
  });

test('metadata dialog explains and applies prompt-only, negative-only and settings-only preset behavior', async () => {
  const React = require('react');
  const { act, create } = require('react-test-renderer');
  const Dialog = require('../renderer/componenets/PNGMetadataImport').default;
  for (const selected of ['prompt', 'negativePrompt', 'settings']) {
    const f = fixture();
    const draft = createConnectedWorkspaceState().draft;
    let applied, renderer;
    try {
      await act(async () => {
        renderer = create(
          React.createElement(Dialog, {
            file: {
              size: f.bytes.length,
              arrayBuffer: async () => Uint8Array.from(f.bytes).buffer,
            },
            draft,
            locked: false,
            onClose() {},
            onApply(value) {
              applied = value;
            },
          }),
          {
            createNodeMock: (element) =>
              element.type === 'dialog' ? { showModal() {}, close() {} } : null,
          },
        );
        await new Promise((resolve) => setImmediate(resolve));
      });
      const preview = JSON.stringify(renderer.toJSON());
      assert.ok(preview.includes('자동 추가를 끕니다'));
      assert.equal(renderer.root.findAllByType('pre').length, 0);
      assert.equal(renderer.root.findAllByType('code').length, 0);
      act(() => {
        for (const field of availableImportFields(
          planMetadataImport(
            {
              comment: JSON.parse(metadata().Comment),
              source: 'text',
              width: 96,
              height: 64,
            },
            draft,
          ),
        )) {
          if (field !== selected)
            renderer.root
              .findByProps({ 'data-import-field': field })
              .props.onChange({ target: { checked: false } });
        }
      });
      act(() =>
        renderer.root
          .findByProps({ 'data-testid': 'apply-metadata' })
          .props.onClick(),
      );
      assert.deepEqual(
        [applied.qualityTags, applied.ucPreset],
        [
          selected === 'prompt' ? 'none' : draft.qualityTags,
          selected === 'negativePrompt' ? 'none' : draft.ucPreset,
        ],
      );
    } finally {
      if (renderer) act(() => renderer.unmount());
    }
  }
});

test('legacy drafts without preset fields keep automatic tags off and do not promote the project version on caption import', async () => {
  const { requiredProjectVersion } = require('../workspaceProject');
  const state = createConnectedWorkspaceState('v4.5');
  const { draft } = state;
  assert.equal(Object.hasOwn(draft, 'qualityTags'), false);
  assert.equal(Object.hasOwn(draft, 'ucPreset'), false);
  const plan = planMetadataImport(await read(fixture()), draft);
  const next = applyMetadataImport(draft, plan, ['prompt', 'negativePrompt']);
  const original = bindBasicGeneration(state.scenes[0], () => 12345).input;
  const rebound = bindBasicGeneration(
    { ...state.scenes[0], draft: next },
    () => 12345,
  ).request;
  assert.equal(rebound.input, plan.prompt);
  assert.equal(rebound.parameters.negative_prompt, plan.negativePrompt);
  assert.equal(Object.hasOwn(next, 'qualityTags'), false);
  assert.equal(Object.hasOwn(next, 'ucPreset'), false);
  const content = {
    name: 'legacy',
    selectedSceneId: state.selectedSceneId,
    scenes: [{ ...state.scenes[0], draft: next }],
  };
  assert.equal(requiredProjectVersion(content), 1);
  assert.equal(
    requiredProjectVersion(content, [
      {
        ...original,
        draft: next,
        binding: { id: 'nai-v45-basic512-v1', requestHash: 'a'.repeat(64) },
      },
    ]),
    2,
  );
});

test('real JPEG comments and ordinary JPEG/WebP remain usable with or without generation metadata', async () => {
  const sharp = require('sharp');
  const { default: readImageMetadata } = require('../renderer/metadata/imageMetadata');
  const image = sharp({create:{width:16,height:16,channels:3,background:'#214474'}});
  const jpeg = await image.clone().jpeg().toBuffer(), webp = await image.clone().webp().toBuffer();
  for (const bytes of [jpeg,webp]) {
    await assert.rejects(readImageMetadata(bytes,signal()), {code:'PNG_MISSING'});
    const stop = new AbortController(); stop.abort();
    await assert.rejects(readImageMetadata(bytes,stop.signal), {code:'CANCELLED'});
  }
  const text = Buffer.from(JSON.stringify({Comment: JSON.stringify({prompt:'정원',seed:0})}));
  const marker = Buffer.from([255,254,0,0]); marker.writeUInt16BE(text.length+2,2);
  const tagged = Buffer.concat([jpeg.subarray(0,2),marker,text,jpeg.subarray(2)]);
  assert.deepEqual((await readImageMetadata(tagged,signal())).comment,{prompt:'정원',seed:0});
  const short = tagged.subarray(0,9);
  await assert.rejects(readImageMetadata(short,signal()),{code:'PNG_INPUT'});
});
