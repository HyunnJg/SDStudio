const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { ProjectStore } = require('../main/projects/projectStore');
const { WorkspaceGeneration } = require('../main/nai/workspaceGeneration');
const { bindBasicGeneration } = require('../main/nai/workspaceBinding');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const {
  validateWorkspaceProject,
  ProjectError,
} = require('../workspaceProject');
const { png } = require('./fixtures/nai/png.cjs');
const character = (id, prompt, negativePrompt = '', enabled = true) => ({
  id,
  prompt,
  negativePrompt,
  enabled,
  cell: { row: 1, column: 3 },
});
function scene() {
  const s = createConnectedWorkspaceState().scenes[0];
  s.draft.seedMode = 'fixed';
  s.draft.seed = '12345';
  s.draft.prompt = '2people, garden';
  s.draft.characters = [
    character('a', 'person, red coat, source#hug', 'hat'),
    character('off', '<unresolved.piece> | preserved', '', false),
    character('b', 'person, blue coat, target#hug'),
  ];
  return s;
}
function fixture(t, fail = false) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'v5-characters-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const core = new ProjectStore(profile),
    s = scene(),
    first = core.create({
      name: 'synthetic',
      selectedSceneId: s.id,
      scenes: [s],
    });
  const bodies = [],
    bytes = Uint8Array.from(png());
  const service = new WorkspaceGeneration({
    offline: () => false,
    store: new Proxy(core, {
      get(target, key) {
        if (key === 'addPNG')
          return (...args) => {
            if (fail) {
              fail = false;
              throw new ProjectError('PROJECT_IO');
            }
            return target.addPNG(...args);
          };
        const v = target[key];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }),
    sendImage: async (body) => {
      bodies.push(Buffer.from(body));
      return bytes;
    },
  });
  return {
    core,
    s,
    first,
    service,
    bodies,
    bytes,
    prepare: () => service.prepare(first.project.id, first.revision, s.id),
  };
}
test('V5 automatic characters keep positive/negative pairing, order and action tags without mutating or adding global presets to character text', () => {
  const s = scene(),
    before = structuredClone(s),
    bound = bindBasicGeneration(s);
  assert.equal(bound.bindingId, 'nai-v5-characters-auto-v1');
  assert.equal(bound.characterCount, 2);
  assert.equal(bound.request.parameters.use_coords, false);
  assert.equal(bound.request.parameters.v4_prompt.use_coords, false);
  assert.equal(bound.request.parameters.v4_prompt.use_order, true);
  assert.deepEqual(bound.request.parameters.v4_prompt.caption.char_captions, [
    {
      char_caption: s.draft.characters[0].prompt,
      centers: [{ x: 0.5, y: 0.5 }],
    },
    {
      char_caption: s.draft.characters[2].prompt,
      centers: [{ x: 0.5, y: 0.5 }],
    },
  ]);
  assert.deepEqual(
    bound.request.parameters.v4_negative_prompt.caption.char_captions.map(
      (c) => c.char_caption,
    ),
    ['hat', ''],
  );
  assert.equal(bound.request.parameters.v4_negative_prompt.legacy_uc, false);
  assert.equal(bound.input.draft.characters.length, 3);
  assert.deepEqual(s, before);
  s.draft.characters[0].prompt = 'changed after binding';
  assert.deepEqual(bound.input.draft, before.draft);
});
test('no active characters retain the previous V5 body and binding exactly', () => {
  const s = scene();
  s.draft.characters.forEach((c) => {
    c.enabled = false;
  });
  const previous = bindBasicGeneration({
    ...s,
    draft: { ...s.draft, characters: [] },
  });
  const bound = bindBasicGeneration(s);
  assert.deepEqual(bound.request, previous.request);
  assert.equal(bound.bindingId, 'nai-v5-full-v1');
});
test('22 active characters are supported; 23, V4.5 and manual placement are rejected without modifying drafts', () => {
  const s = scene();
  s.draft.characters = Array.from({ length: 22 }, (_, i) =>
    character(`c${i}`, `person${i}`),
  );
  assert.equal(bindBasicGeneration(s).characterCount, 22);
  for (const patch of [
    { characters: [...s.draft.characters, character('extra', 'person')] },
    { placement: 'manual' },
    { family: 'v4.5' },
  ])
    assert.throws(
      () => bindBasicGeneration({ ...s, draft: { ...s.draft, ...patch } }),
      /UNSUPPORTED_DRAFT/,
    );
  const before = structuredClone(s);
  bindBasicGeneration(s);
  assert.deepEqual(s, before);
});
test('unresolved inline syntax in a transmitted character condition is refused', () => {
  const s = scene();
  for (const patch of [
    { prompt: 'a | b' },
    { negativePrompt: '<group.piece>' },
    { prompt: '<group.piece>' },
    { negativePrompt: 'a | b' },
  ]) {
    const c = { ...s.draft.characters[0], ...patch };
    assert.throws(
      () =>
        bindBasicGeneration({ ...s, draft: { ...s.draft, characters: [c] } }),
      /UNSUPPORTED_DRAFT/,
    );
  }
});

test('empty and negative-only cards stay in the stored draft while the previous plain V5 request stays identical', () => {
  const s = scene();
  const previous = bindBasicGeneration({
    ...s,
    draft: { ...s.draft, characters: [] },
  });
  s.draft.characters = [
    character('empty', ''),
    character('spaces', '  '),
    character('negative-only', '', 'hat'),
  ];
  const before = structuredClone(s);
  const bound = bindBasicGeneration(s);
  assert.deepEqual(bound.request, previous.request);
  assert.equal(bound.characterCount, 0);
  assert.equal(bound.bindingId, 'nai-v5-full-v1');
  assert.deepEqual(bound.input.draft, before.draft);
  assert.deepEqual(s, before);
});

test('V5 character-only input permits an empty base without inventing count tags or altering presets', () => {
  for (const qualityTags of ['none', 'standard']) {
    const s = scene();
    s.draft.prompt = '';
    s.draft.qualityTags = qualityTags;
    s.draft.characters.splice(
      1,
      0,
      character('waiting', '', 'preserved negative'),
    );
    const bound = bindBasicGeneration(s);
    const quality = require('../workspaceGenerationSettings').V5_QUALITY_TAGS[
      qualityTags
    ];
    assert.equal(bound.request.input, quality);
    assert.equal(
      bound.request.parameters.v4_prompt.caption.base_caption,
      quality,
    );
    assert.equal(bound.characterCount, 2);
    assert.deepEqual(
      bound.request.parameters.v4_prompt.caption.char_captions.map(
        (c) => c.char_caption,
      ),
      ['person, red coat, source#hug', 'person, blue coat, target#hug'],
    );
    assert.deepEqual(
      bound.request.parameters.v4_negative_prompt.caption.char_captions.map(
        (c) => c.char_caption,
      ),
      ['hat', ''],
    );
    assert.equal(bound.input.draft.prompt, '');
    assert.equal(bound.input.draft.characters.length, 4);
  }
});

test('a blank base with no enabled positive character is refused; disabled text and negative-only cards do not qualify', () => {
  const s = scene();
  for (const characters of [
    [],
    [character('empty', '')],
    [character('off', 'person', '', false)],
    [character('negative-only', '', 'hat')],
  ]) {
    assert.throws(
      () =>
        bindBasicGeneration({
          ...s,
          draft: { ...s.draft, prompt: '  ', characters },
        }),
      /INVALID_INPUT/,
    );
  }
  const legacy = createConnectedWorkspaceState('v4.5').scenes[0];
  legacy.draft.characters = [character('waiting', '')];
  assert.equal(bindBasicGeneration(legacy).characterCount, 0);
  legacy.draft.prompt = '';
  assert.throws(() => bindBasicGeneration(legacy), /INVALID_INPUT/);
});

test('waiting cards do not consume the22 character limit and malformed enabled cards are not silently skipped', () => {
  const s = scene();
  s.draft.characters = Array.from({ length: 22 }, (_, i) =>
    character(`c${i}`, `person${i}`),
  );
  s.draft.characters.push(
    ...Array.from({ length: 10 }, (_, i) => character(`waiting${i}`, '')),
  );
  assert.equal(bindBasicGeneration(s).characterCount, 22);
  for (const patch of [{ prompt: undefined }, { negativePrompt: undefined }]) {
    s.draft.characters[22] = { ...s.draft.characters[22], ...patch };
    assert.throws(() => bindBasicGeneration(s), /UNSUPPORTED_DRAFT/);
    s.draft.characters[22] = character('waiting0', '');
  }
});

test('character-only single generation preserves waiting cards and saves the original request hash without extra transmissions', async (t) => {
  const f = fixture(t);
  f.s.draft.prompt = '';
  f.s.draft.qualityTags = 'none';
  f.s.draft.characters.push(character('waiting', '', 'hat'));
  const saved = f.core.save(f.first.project.id, f.first.revision, {
    name: 'synthetic',
    selectedSceneId: f.s.id,
    scenes: [f.s],
  });
  const p = await f.service.prepare(saved.project.id, saved.revision, f.s.id);
  assert.equal(p.characters, 2);
  assert.equal(f.bodies.length, 0);
  const r = await f.service.run(p.ticket, true);
  assert.equal(f.bodies.length, 1);
  assert.equal(JSON.parse(f.bodies[0]).input, '');
  const image = r.snapshot.project.images[0];
  assert.deepEqual(image.draft, f.s.draft);
  assert.equal(
    image.binding.requestHash,
    crypto.createHash('sha256').update(f.bodies[0]).digest('hex'),
  );
  assert.equal(r.snapshot.project.version, 4);
});

test('character-only repeated queue uses the same effective captions and leaves waiting cards in every saved result', async (t) => {
  const f = fixture(t);
  f.s.draft.prompt = '';
  f.s.draft.characters.push(character('waiting', ''));
  const saved = f.core.save(f.first.project.id, f.first.revision, {
    name: 'synthetic',
    selectedSceneId: f.s.id,
    scenes: [f.s],
  });
  const p = await f.service.prepareQueue(
    saved.project.id,
    saved.revision,
    [f.s.id],
    2,
  );
  assert.equal(p.total, 2);
  assert.equal(f.bodies.length, 0);
  await f.service.runQueue(p.ticket, true);
  assert.equal(f.bodies.length, 2);
  for (const bytes of f.bodies) {
    const body = JSON.parse(bytes);
    assert.equal(body.parameters.v4_prompt.caption.char_captions.length, 2);
    assert.equal(
      body.parameters.v4_negative_prompt.caption.char_captions.length,
      2,
    );
  }
  assert.ok(
    f.core
      .open(saved.project.id)
      .project.images.every((image) => image.draft.characters.length === 4),
  );
});
test('character generation reserves without sending and stores v4 metadata/raw draft/hash and byte-identical PNG once', async (t) => {
  const f = fixture(t),
    p = await f.prepare();
  assert.equal(p.characters, 2);
  assert.equal(f.bodies.length, 0);
  const r = await f.service.run(p.ticket, true),
    image = r.snapshot.project.images[0];
  assert.equal(r.snapshot.project.version, 4);
  assert.deepEqual(image.draft, f.s.draft);
  assert.deepEqual(image.binding, {
    id: 'nai-v5-characters-auto-v1',
    requestHash: crypto.createHash('sha256').update(f.bodies[0]).digest('hex'),
  });
  assert.deepEqual(
    await f.service.image(f.first.project.id, image.id),
    f.bytes,
  );
  assert.deepEqual(f.core.open(f.first.project.id).project.images[0], image);
  await assert.rejects(f.service.run(p.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  assert.equal(f.bodies.length, 1);
});
test('v4 copies preserve results; immutable v3 history recovers independently; downgraded and unknown versions are refused', async (t) => {
  const f = fixture(t),
    r = await f.service.run((await f.prepare()).ticket, true);
  const copy = f.core.copy(f.first.project.id, r.snapshot.revision, {
    name: 'copy',
    selectedSceneId: f.s.id,
    scenes: r.snapshot.project.scenes,
  });
  assert.equal(copy.project.version, 4);
  assert.deepEqual(copy.project.images, r.snapshot.project.images);
  const recovered = f.core.recover(f.first.project.id, f.first.revision);
  assert.equal(recovered.project.version, 3);
  assert.equal(recovered.project.images.length, 0);
  assert.equal(f.core.open(f.first.project.id).project.version, 4);
  assert.throws(
    () => validateWorkspaceProject({ ...r.snapshot.project, version: 3 }),
    { code: 'PROJECT_CORRUPT' },
  );
  assert.throws(
    () => validateWorkspaceProject({ ...r.snapshot.project, version: 999 }),
    { code: 'PROJECT_VERSION' },
  );
});
test('character queue and plain V5 queue share execution, confirm different character counts and preserve exact per-item input', async (t) => {
  const f = fixture(t),
    plain = structuredClone(f.s);
  plain.id = 'plain';
  plain.draft.characters = [];
  const saved = f.core.save(f.first.project.id, f.first.revision, {
    name: 'mixed',
    selectedSceneId: f.s.id,
    scenes: [f.s, plain],
  });
  const p = await f.service.prepareQueue(
    saved.project.id,
    saved.revision,
    [f.s.id, plain.id],
    2,
  );
  assert.equal(p.total, 4);
  assert.equal(p.settings.length, 2);
  assert.equal(f.bodies.length, 0);
  assert.deepEqual(
    p.items.map((i) => i.settings.characters ?? 0),
    [2, 0, 2, 0],
  );
  const result = await f.service.runQueue(p.ticket, true);
  assert.ok(result.queue.items.every((i) => i.status === 'done'));
  assert.deepEqual(
    f.bodies.map(
      (b) => JSON.parse(b).parameters.v4_prompt.caption.char_captions.length,
    ),
    [2, 0, 2, 0],
  );
  assert.deepEqual(
    result.latest.snapshot.project.images.map((i) => i.binding.id),
    [
      'nai-v5-characters-auto-v1',
      'nai-v5-full-v1',
      'nai-v5-characters-auto-v1',
      'nai-v5-full-v1',
    ],
  );
});
test('character save failure keeps a pending PNG and save-only recovery never sends again', async (t) => {
  const f = fixture(t, true),
    p = await f.prepare();
  await assert.rejects(f.service.run(p.ticket, true), {
    code: 'RESULT_SAVE_FAILED',
    pendingResult: true,
  });
  assert.equal(f.bodies.length, 1);
  const r = await f.service.retrySave();
  assert.equal(r.snapshot.project.version, 4);
  assert.equal(f.bodies.length, 1);
  assert.equal(f.service.status().pending, false);
  assert.equal(r.snapshot.project.images[0].draft.characters.length, 3);
});
test('changing a queued character prompt stops before another request; restoring input resumes only unsent tasks', async (t) => {
  const f = fixture(t),
    p = await f.service.prepareQueue(
      f.first.project.id,
      f.first.revision,
      [f.s.id],
      2,
    );
  const originalSend = f.service.options.sendImage;
  let edited;
  f.service.options.sendImage = async (...args) => {
    const bytes = await originalSend(...args);
    const current = f.core.readManifest(f.first.project.id);
    const scenes = structuredClone(current.project.scenes);
    scenes[0].draft.characters[0].prompt += ', changed';
    edited = f.core.save(current.project.id, current.revision, {
      name: current.project.name,
      selectedSceneId: f.s.id,
      scenes,
    });
    return bytes;
  };
  // The changed input is preserved while the first result appends to the latest revision.
  const stopped = await f.service.runQueue(p.ticket, true);
  assert.equal(f.bodies.length, 1);
  assert.equal(stopped.queue.items[1].status, 'pending');
  assert.equal(stopped.queue.items[1].error.code, 'QUEUE_INPUT_CHANGED');
  const now = f.core.readManifest(f.first.project.id);
  const restored = f.core.save(now.project.id, now.revision, {
    name: now.project.name,
    selectedSceneId: f.s.id,
    scenes: [f.s],
  });
  f.service.options.sendImage = originalSend;
  const next = await f.service.prepareRemaining(
    p.queueId,
    restored.project.id,
    restored.revision,
  );
  assert.equal(next.total, 1);
  await f.service.runQueue(next.ticket, true);
  assert.equal(f.bodies.length, 2);
});
