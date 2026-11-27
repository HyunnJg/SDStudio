const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { createHash } = require('node:crypto');
const { ProjectStore } = require('../main/projects/projectStore');
const { ProjectService } = require('../main/projects/projectService');
const { WorkspaceGeneration } = require('../main/nai/workspaceGeneration');
const { bindBasicGeneration } = require('../main/nai/workspaceBinding');
const { validateWorkspaceProject, validateReference } = require('../workspaceProject');
const { referenceDescription } = require('../workspaceReference');
const { createConnectedWorkspaceState } = require('../renderer/generation/connectedDraft');
const { snapshotWorkspaceScenes } = require('../renderer/preview/workspaceDraft');
const { png } = require('./fixtures/nai/png.cjs');
const { inspectLegacyPresets, hasLegacyPromptSyntax } = require('../promptLibrary');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-reference-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const store = new ProjectStore(profile), state = createConnectedWorkspaceState();
  let current = store.create({ name: 'Synthetic reference', selectedSceneId: state.selectedSceneId, scenes: snapshotWorkspaceScenes(state) });
  const original = Uint8Array.from(png());
  const asset = await store.importReference(current.project.id, current.revision, original);
  const reference = { ...asset, role: 'character', strength: 1, preferSameOutfit: false };
  const content = { name: current.project.name, selectedSceneId: current.project.selectedSceneId, scenes: structuredClone(current.project.scenes) };
  content.scenes[0].draft.reference = reference;
  const previous = current;
  current = store.save(current.project.id, current.revision, content);
  const bodies = [];
  let offline = false;
  const service = new WorkspaceGeneration({ store, offline: () => offline, sendImage: async (body) => { bodies.push(Uint8Array.from(body)); return original; } });
  return { profile, store, previous, current, content, reference, original, bodies, service, offline: () => offline = true,
    prepare: () => service.prepare(current.project.id, current.revision, content.scenes[0].id),
    file: (sha) => path.join(profile, 'projects-v1', current.project.id, 'references', `${sha}.png`) };
}
test('reference import preserves original bytes and creates a bounded PNG-text-free current V5 bucket derivative without a request', async (t) => {
  const f = await fixture(t);
  assert.equal(f.current.project.version, 5);
  assert.deepEqual(Uint8Array.from(fs.readFileSync(f.file(f.reference.sourceHash))), f.original);
  const upload = f.store.referenceImage(f.current.project.id, f.content.scenes[0].id);
  assert.equal(hash(upload), f.reference.uploadHash);
  assert.ok(upload.byteLength <= 2 * 1024 * 1024);
  assert.equal(Buffer.from(upload).includes(Buffer.from('Comment')), false);
  assert.equal(Buffer.from(upload).readUInt32BE(16), f.reference.width);
  assert.equal(f.bodies.length, 0);
  const old = structuredClone(f.current.project); old.version = 4;
  assert.throws(() => validateWorkspaceProject(old), { code: 'PROJECT_CORRUPT' });
});
for (const [role, same, expected] of [
  ['character', false, 'character'], ['character', true, 'character_mainoutfit'],
  ['style', false, 'style'], ['outfit', false, 'costume'],
  ['character-style', false, 'character&style_anyoutfit'], ['character-style', true, 'character&style'],
]) test(`V5 reference wire: ${role}, preferSameOutfit=${same}`, async (t) => {
  const f = await fixture(t), scene = structuredClone(f.content.scenes[0]);
  scene.draft.reference = { ...f.reference, role, preferSameOutfit: same, strength: 3.5 };
  const bytes = f.store.referenceBytes(f.current.project.id, scene.draft.reference);
  const b = bindBasicGeneration(scene, () => 12345, {reference:bytes});
  assert.equal(referenceDescription(scene.draft.reference), expected);
  assert.equal(b.bindingId, 'nai-v5-reference-v1');
  assert.deepEqual(b.request.parameters.director_reference_descriptions, [{ caption: { base_caption: expected, char_captions: [] }, legacy_uc: false }]);
  assert.deepEqual(b.request.parameters.director_reference_strength_values, [3.5]);
  assert.deepEqual(b.request.parameters.director_reference_secondary_strength_values, [0]);
  assert.deepEqual(b.request.parameters.director_reference_information_extracted, [1]);
  assert.equal(hash(Buffer.from(b.request.parameters.director_reference_images[0], 'base64')), f.reference.uploadHash);
});
test('unreferenced V5 bodies keep their previous binding and contain no reference arrays', async (t) => {
  const f = await fixture(t), scene = structuredClone(f.content.scenes[0]); delete scene.draft.reference;
  const b = bindBasicGeneration(scene, () => 10);
  assert.equal(b.bindingId, 'nai-v5-full-v1');
  assert.equal(Object.keys(b.request.parameters).some((key) => key.startsWith('director_reference')), false);
});
test('malformed reference options and V4.5 reference never fall back to an unreferenced request', async (t) => {
  const f = await fixture(t);
  for (const extra of [{ strength: 5.1 }, { strength: NaN }, { strength: -0.1 }, { role: 'vibe' }, { role: 'outfit', preferSameOutfit: true }, { path: 'private' }])
    assert.throws(() => validateReference({ ...f.reference, ...extra }));
  const scene = structuredClone(f.content.scenes[0]); scene.draft.family = 'v4.5';
  assert.throws(() => bindBasicGeneration(scene, () => 1, {reference:f.original}), { message: 'UNSUPPORTED_DRAFT' });
});
test('invalid/oversized source and missing reference UUID are rejected locally', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.store.importReference(f.current.project.id, f.current.revision, Uint8Array.from([1, 2, 3])));
  await assert.rejects(f.store.importReference(f.current.project.id, f.current.revision, new Uint8Array(32 * 1024 * 1024 + 1)));
  assert.throws(() => f.store.referenceImage(f.current.project.id, 'unknown'), { code: 'PROJECT_NOT_FOUND' });
  assert.equal(f.bodies.length, 0);
});
test('single prepare binds bytes/hash/options; tampered upload after approval is caught before send', async (t) => {
  const f = await fixture(t), plan = await f.prepare();
  assert.equal(plan.reference.uploadHash, f.reference.uploadHash);
  assert.equal(f.bodies.length, 0);
  fs.writeFileSync(f.file(f.reference.uploadHash), png());
  await assert.rejects(f.service.run(plan.ticket, true), { code: 'PROJECT_CORRUPT' });
  await assert.rejects(f.service.run(plan.ticket, true), { code: 'CONFIRMATION_EXPIRED' });
  assert.equal(f.bodies.length, 0);
});
test('source corruption blocks open and generation even if the upload derivative exists', async (t) => {
  const f = await fixture(t); fs.unlinkSync(f.file(f.reference.sourceHash));
  assert.throws(() => f.store.open(f.current.project.id));
  await assert.rejects(f.prepare(), { code: 'PROJECT_CORRUPT' }); assert.equal(f.bodies.length, 0);
});
test('single generation records original reference draft and body hash; offline reopen/copy/recover preserve both assets', async (t) => {
  const f = await fixture(t), result = await f.service.run((await f.prepare()).ticket, true);
  const image = result.snapshot.project.images.at(-1);
  assert.equal(image.binding.id, 'nai-v5-reference-v1');
  assert.equal(image.binding.requestHash, hash(f.bodies[0]));
  assert.deepEqual(image.draft.reference, f.reference);
  f.offline(); assert.ok(await f.service.referenceImage(f.current.project.id, f.content.scenes[0].id));
  const copy = f.store.copy(f.current.project.id, result.snapshot.revision, f.content);
  assert.deepEqual(f.store.referenceBytes(copy.project.id, f.reference), f.store.referenceBytes(f.current.project.id, f.reference));
  const inputOnly = f.store.create(f.content, f.current.project.id); assert.equal(inputOnly.project.images.length, 0);
  assert.ok(f.store.referenceImage(inputOnly.project.id, f.content.scenes[0].id));
  const recovery = f.store.recover(f.current.project.id, f.current.revision); assert.equal(recovery.project.version, 5);
  const before = f.store.recover(f.current.project.id, f.previous.revision); assert.equal(before.project.version, f.previous.project.version);
  assert.equal(before.project.scenes[0].draft.reference, undefined);
});
test('queue uses the common sender and stops changed reference input; no implicit rebind/resend', async (t) => {
  const f = await fixture(t), id = f.current.project.id;
  const plan = await f.service.prepareQueue(id, f.current.revision, [f.content.scenes[0].id], 3);
  assert.equal(plan.total, 3); assert.equal(plan.settings[0].reference.role, 'character');
  f.content.scenes[0].draft.reference.strength = 2;
  f.store.save(id, f.current.revision, f.content);
  const stopped = await f.service.runQueue(plan.ticket, true);
  assert.equal(stopped.queue.items[0].status, 'pending');
  assert.equal(stopped.queue.items[0].error.code, 'QUEUE_INPUT_CHANGED');
  assert.equal(f.bodies.length, 0);
});
test('queue completes three approved reference requests serially and stores all PNG results', async (t) => {
  const f = await fixture(t), plan = await f.service.prepareQueue(f.current.project.id, f.current.revision, [f.content.scenes[0].id], 3);
  const result = await f.service.runQueue(plan.ticket, true);
  assert.equal(result.queue.items.filter((i) => i.status === 'done').length, 3);
  assert.equal(f.bodies.length, 3);
  for (const body of f.bodies) assert.equal(hash(Buffer.from(JSON.parse(Buffer.from(body)).parameters.director_reference_images[0], 'base64')), f.reference.uploadHash);
});
test('save-only recovery to a new project copies references and never calls sender twice', async (t) => {
  const f = await fixture(t); let fail = true, sends = 0;
  const proxy = new Proxy(f.store, { get(target, key) {
    if (key === 'addPNG') return (...args) => { if (fail) throw new Error('synthetic disk failure'); return target.addPNG(...args); };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  const service = new WorkspaceGeneration({ store: proxy, offline: () => false, sendImage: async () => { sends++; return f.original; } });
  const plan = await service.prepare(f.current.project.id, f.current.revision, f.content.scenes[0].id);
  await assert.rejects(service.run(plan.ticket, true), { code: 'RESULT_SAVE_FAILED' });
  fail = false;
  const result = await service.retrySave(true);
  assert.notEqual(result.snapshot.project.id, f.current.project.id);
  assert.equal(sends, 1); assert.equal(service.status().pending, false);
  assert.ok(f.store.referenceImage(result.snapshot.project.id, f.content.scenes[0].id));
});
test('worker performs reference preparation and returns resolved bytes rather than an uncloneable promise', async (t) => {
  const f = await fixture(t), service = new ProjectService(f.profile, path.resolve(__dirname, '../main/projects/projectWorker.ts'));
  t.after(() => service.close());
  const asset = await service.importReference(f.current.project.id, f.current.revision, f.original);
  assert.equal(asset.sourceHash, hash(f.original));
  assert.equal(hash(await service.referenceImage(f.current.project.id, f.content.scenes[0].id)), f.reference.uploadHash);
});
test('legacy import keeps valid candidates, reports excluded count, preserves text and marks unsupported V3 syntax', () => {
  const valid = { name: 'Synthetic', frontPrompt: '1girl, <hair>, {red|blue}', backPrompt: '', uc: '' };
  const result = inspectLegacyPresets({ presets: { SDImageGen: [valid, { ...valid, name: '' }, { ...valid, frontPrompt: 'x'.repeat(65537) }, { ...valid, uc: '\0' }] } });
  assert.equal(result.candidates.length, 1); assert.equal(result.skipped, 3);
  assert.equal(result.candidates[0].prompt, valid.frontPrompt); assert.equal(hasLegacyPromptSyntax(result.candidates[0]), true);
  assert.equal(hasLegacyPromptSyntax({ ...result.candidates[0], prompt: '{{red hair}}' }), false);
});

test('V5 reference metadata reports missing image assets and preserves the explicitly selected local reference', () => {
  const { planMetadataImport, applyMetadataImport } = require('../renderer/metadata/metadataImport');
  const draft = createConnectedWorkspaceState().draft;
  draft.reference = { id: 'synthetic-marker' };
  const plan = planMetadataImport({ source: 'text', comment: { prompt: 'synthetic', director_reference_strengths: [1] } }, draft);
  assert.ok(plan.notices.some((n) => n.includes('참조 이미지') && n.includes('현재 씬의 참조 선택은 유지')));
  assert.deepEqual(applyMetadataImport(draft, plan, ['prompt']).reference, draft.reference);
});

async function variationFixture(t) {
  const f = await fixture(t);
  const id = f.current.project.id;
  const scene = f.content.scenes[0];
  const asset = await f.store.importReference(id, f.current.revision, f.original, 'img2img');
  delete scene.draft.reference;
  scene.draft.img2img = { ...asset, strength: 0.45, noise: 0.1 };
  const saved = f.store.save(id, f.current.revision, f.content);
  return { ...f, id, scene, asset, saved };
}

test('V5 variation binds only the target-size derivative, preserves source and appends an independently recoverable v7 result', async t => {
  const f = await variationFixture(t);
  assert.equal(f.saved.project.version, 7);
  assert.throws(() => validateWorkspaceProject({ ...f.saved.project, version: 6, trashedImageIds: [] }), {code: 'PROJECT_CORRUPT'});
  const plan = await f.service.prepare(f.id, f.saved.revision, f.scene.id);
  assert.deepEqual(plan.img2img, { strength: 0.45, noise: 0.1 });
  assert.equal(plan.reference, undefined);
  assert.equal(f.bodies.length, 0);
  const { snapshot, imageId } = await f.service.run(plan.ticket, true);
  const body = JSON.parse(Buffer.from(f.bodies[0]));
  assert.equal(body.action, 'img2img');
  assert.equal(body.parameters.strength, 0.45);
  assert.equal(body.parameters.noise, 0.1);
  assert.equal(body.parameters.extra_noise_seed, plan.seed);
  assert.equal(body.parameters.director_reference_images, undefined);
  const encoded = Buffer.from(body.parameters.image, 'base64');
  assert.equal(hash(encoded), f.asset.uploadHash);
  assert.equal(encoded.readUInt32BE(16), 832);
  assert.equal(encoded.readUInt32BE(20), 1216);
  assert.deepEqual(fs.readFileSync(f.file(f.asset.sourceHash)), Buffer.from(f.original));
  const image = snapshot.project.images[0];
  const inconsistent = structuredClone(snapshot.project);
  inconsistent.images[0].binding.id = 'nai-v5-full-v1';
  assert.throws(() => validateWorkspaceProject(inconsistent), {code:'PROJECT_CORRUPT'});
  assert.deepEqual(image.binding, {id:'nai-v5-img2img-v1', requestHash:hash(f.bodies[0])});
  assert.deepEqual(image.draft.img2img, f.scene.draft.img2img);
  const hidden = f.store.setImageDeleted(f.id, snapshot.revision, imageId, true);
  assert.equal(hidden.project.version, 7);
  const copy = f.store.copy(f.id, hidden.revision, f.content);
  assert.deepEqual(copy.project.trashedImageIds, [imageId]);
  assert.equal(hash(f.store.referenceImage(copy.project.id, f.scene.id)), f.asset.uploadHash);
  const recovery = f.store.recover(f.id, snapshot.revision);
  assert.equal(recovery.project.images[0].id, imageId);
  assert.equal(hash(f.store.image(recovery.project.id, imageId)), hash(f.original));
  const next = f.store.create(f.content, f.id);
  assert.equal(next.project.images.length, 0);
  assert.equal(hash(f.store.referenceImage(next.project.id, f.scene.id)), f.asset.uploadHash);
});

test('queued character cuts keep the selected identity, reference and noise while overriding only the cut strength', async (t) => {
  const { buildRecipeScenes } = require('../renderer/generation/sceneRecipe');
  const { randomUUID } = require('node:crypto');
  const f = await variationFixture(t);
  const fixed = 'silver hair\r\n\r\nnavy coat';
  const actor = {
    id: 'actor',
    enabled: true,
    prompt: fixed + '\r\n\r\nold pose\r\n',
    negativePrompt: 'hat',
    cell: { row: 2, column: 2 },
  };
  f.scene.draft.characters = [
    { ...actor, id: 'other', prompt: 'other actor' },
    actor,
  ];
  f.scene.draft.reference = f.reference;
  const row = {
    name: 'table',
    setting: '',
    emotion: 'reading a map, seated',
    cutMode: 'replace',
  };
  const recipe = {
    name: 'shots',
    styleId: '',
    characterIds: [],
    cutActorId: 'actor',
    situations: [
      { ...row, img2imgStrength: '0' },
      { ...row, name: 'skip', included: false },
      { ...row, name: 'wave', emotion: 'waving', img2imgStrength: '0.90' },
      { ...row, name: 'inherit', emotion: 'listening' },
    ],
  };
  const original = structuredClone(f.scene);
  const scenes = buildRecipeScenes(recipe, f.scene, [], 3, randomUUID);
  assert.deepEqual(f.scene, original);
  const saved = f.store.save(f.id, f.saved.revision, {
    ...f.content,
    scenes: [...f.content.scenes, ...scenes],
  });
  const plan = await f.service.prepareQueue(
    f.id,
    saved.revision,
    scenes.map((s) => s.id),
    1,
    0,
  );
  assert.equal(f.bodies.length, 0);
  const result = await f.service.runQueue(plan.ticket, true);
  assert.deepEqual(
    result.queue.items.map((i) => i.status),
    ['done', 'done', 'done'],
  );
  const expectedCuts = [row.emotion, 'waving', 'listening'];
  f.bodies.forEach((bytes, i) => {
    const request = JSON.parse(Buffer.from(bytes));
    assert.equal(request.parameters.strength, [0, 0.9, 0.45][i]);
    assert.equal(request.parameters.noise, 0.1);
    assert.equal(request.parameters.director_reference_images.length, 1);
    assert.equal(
      request.parameters.v4_prompt.caption.base_caption,
      scenes[i].draft.prompt +
        ', ' +
        require('../workspaceGenerationSettings').V5_QUALITY_TAGS.standard,
    );
    assert.deepEqual(
      request.parameters.v4_prompt.caption.char_captions.map(
        (c) => c.char_caption,
      ),
      ['other actor', fixed + '\r\n\r\n' + expectedCuts[i]],
    );
    assert.equal(
      request.parameters.v4_negative_prompt.caption.char_captions[1]
        .char_caption,
      'hat',
    );
  });
});

test('variation queue uses the same approved body/seed; changed strength or broken asset stops before send', async t => {
  const f = await variationFixture(t);
  const plan = await f.service.prepareQueue(f.id, f.saved.revision, [f.scene.id], 2);
  assert.deepEqual(plan.settings[0].img2img, {strength: 0.45, noise: 0.1});
  const result = await f.service.runQueue(plan.ticket, true);
  assert.deepEqual(result.queue.items.map(i => i.status), ['done', 'done']);
  for (const bytes of f.bodies) {
    const request = JSON.parse(Buffer.from(bytes));
    assert.equal(request.action, 'img2img');
    assert.equal(request.parameters.seed, request.parameters.extra_noise_seed);
    assert.equal(hash(Buffer.from(request.parameters.image, 'base64')), f.asset.uploadHash);
  }
  const current = f.store.open(f.id);
  const changedPlan = await f.service.prepareQueue(f.id, current.revision, [f.scene.id], 1);
  f.scene.draft.img2img.strength = 0;
  const changed = f.store.save(f.id, current.revision, f.content);
  const stopped = await f.service.runQueue(changedPlan.ticket, true);
  assert.equal(stopped.queue.items[0].error.code, 'QUEUE_INPUT_CHANGED');
  const single = await f.service.prepare(f.id, changed.revision, f.scene.id);
  fs.unlinkSync(f.file(f.asset.uploadHash));
  await assert.rejects(f.service.run(single.ticket, true), { code: 'PROJECT_CORRUPT' });
  assert.equal(f.bodies.length, 2);
});

test('missing reference bytes, invalid variation, mismatched shape and unsupported family cannot silently generate', async t => {
  const f = await variationFixture(t);
  const bind = (patch) => bindBasicGeneration({...f.scene, draft: {...f.scene.draft, ...patch}}, () => 0, {img2img:f.original});
  for (const patch of [{reference:f.reference}, {resolution:'square'}, {family:'v4.5'}, {img2img:{...f.scene.draft.img2img, noise:1.01}}, {img2img:{...f.scene.draft.img2img, strength:NaN}}]) {
    assert.throws(() => bind(patch));
  }
  assert.throws(() => bindBasicGeneration(f.scene, () => 0));
  const zero = bind({img2img:{...f.scene.draft.img2img, strength:0, noise:0}});
  assert.equal(zero.request.parameters.strength, 0);
  assert.equal(zero.request.parameters.extra_noise_seed, 0);
  const plain = bind({img2img:undefined});
  assert.equal(plain.request.action, 'generate');
  assert.equal(plain.request.parameters.image, undefined);
});

test('remaining project budget counts hidden results and counts shared source/derivative content once', async t => {
  const f = await variationFixture(t);
  const { remainingProjectBytes, PROJECT_LIMITS } = require('../workspaceProject');
  const project = f.saved.project;
  const mock = { id: 'example', draft: f.scene.draft, pngBytes: 2 * 1024 * 1024 };
  const remaining = remainingProjectBytes({...project, images:[mock], trashedImageIds:[mock.id]});
  assert.equal(remaining, PROJECT_LIMITS.totalPNGBytes - f.asset.sourceBytes - f.asset.uploadBytes - mock.pngBytes);
});

for (const format of ['webp', 'jpeg', 'png']) {
  test(
    format +
      ' original survives save, copy and reopen; stored upload and approved body match',
    async (t) => {
      const sharp = require('sharp');
      const {
        default: readImageMetadata,
      } = require('../renderer/metadata/imageMetadata');
      const f = await fixture(t),
        id = f.current.project.id,
        scene = f.content.scenes[0];
      const metadata = {
        prompt: 'synthetic imported prompt',
        seed: 0,
        steps: 23,
      };
      const raw = require('node:crypto').randomBytes(832 * 1216 * 3);
      let source = sharp(raw, {
        raw: { width: 832, height: 1216, channels: 3 },
      });
      if (format !== 'png')
        source = source.withExif({
          IFD0: { ImageDescription: JSON.stringify(metadata) },
        });
      let original = await source[format]().toBuffer();
      if (format === 'png') {
        const { chunk } = require('./fixtures/nai/metadataPNG.cjs');
        const comment = chunk(
          'tEXt',
          Buffer.from('Comment\0' + JSON.stringify(metadata)),
        );
        original = Buffer.concat([
          original.subarray(0, -12),
          comment,
          original.subarray(-12),
        ]);
        assert.ok(original.length > 2 * 1024 * 1024);
      }
      const parsed = await readImageMetadata(
        original,
        new AbortController().signal,
      );
      assert.deepEqual(parsed.comment, metadata);
      assert.deepEqual([parsed.width, parsed.height], [832, 1216]);
      const asset = await f.store.importReference(
        id,
        f.current.revision,
        original,
        'img2img',
      );
      assert.equal(asset.sourceHash, hash(original));
      delete scene.draft.reference;
      scene.draft.img2img = { ...asset, strength: 0.5, noise: 0 };
      const saved = f.store.save(id, f.current.revision, f.content);
      assert.equal(saved.project.version, 8);
      const copy = f.store.copy(id, saved.revision, f.content);
      const folder = path.join(
        f.profile,
        'projects-v1',
        copy.project.id,
        'references',
      );
      assert.deepEqual(
        fs.readFileSync(path.join(folder, asset.sourceHash + '.' + format)),
        original,
      );
      assert.equal(
        hash(f.store.referenceImage(copy.project.id, scene.id)),
        asset.uploadHash,
      );
      const hidden = f.store.open(copy.project.id);
      assert.equal(hidden.project.version, 8);
      if (format === 'png') {
        assert.ok(asset.uploadBytes > 2 * 1024 * 1024);
        const plan = await f.service.prepareQueue(
          id,
          saved.revision,
          [scene.id],
          3,
          0,
        );
        const done = await f.service.runQueue(plan.ticket, true);
        assert.ok(done.queue.items.every((i) => i.status === 'done'));
        assert.ok(f.bodies.reduce((n, b) => n + b.length, 0) > 8 * 1024 * 1024);
        for (const body of f.bodies)
          assert.equal(
            hash(
              Buffer.from(
                JSON.parse(Buffer.from(body)).parameters.image,
                'base64',
              ),
            ),
            asset.uploadHash,
          );
        const latest = f.store.readManifest(id);
        assert.equal(
          f.store.setImageDeleted(
            id,
            latest.revision,
            latest.project.images[0].id,
            true,
          ).project.version,
          8,
        );
      }
    },
  );
}

test('combined V5 variation and reference persist independently and keep their own bytes in a queued request', async t => {
  const f = await variationFixture(t);
  f.scene.draft.reference = f.reference;
  const saved = f.store.save(f.id, f.saved.revision, f.content);
  assert.equal(saved.project.version, 9);
  assert.throws(() => validateWorkspaceProject({...saved.project, version:8}), {code:'PROJECT_CORRUPT'});
  const plan = await f.service.prepareQueue(f.id, saved.revision, [f.scene.id], 1);
  assert.deepEqual(plan.settings[0].img2img, {strength:0.45, noise:0.1});
  assert.equal(plan.settings[0].reference.uploadHash, f.reference.uploadHash);
  await f.service.runQueue(plan.ticket, true);
  assert.equal(f.bodies.length, 1);
  const {action, parameters} = JSON.parse(Buffer.from(f.bodies[0]));
  assert.equal(action,'img2img');
  assert.notEqual(f.asset.uploadHash, f.reference.uploadHash);
  assert.equal(hash(Buffer.from(parameters.image,'base64')), f.asset.uploadHash);
  assert.deepEqual(parameters.director_reference_images, [Buffer.from(f.store.referenceImage(f.id,f.scene.id,'reference')).toString('base64')]);
  const current = f.store.open(f.id);
  assert.deepEqual(current.project.images[0].binding,{id:'nai-v5-img2img-reference-v1',requestHash:hash(f.bodies[0])});
  const copy = f.store.copy(f.id,current.revision,f.content);
  for (const purpose of ['reference','img2img']) {
    assert.equal(hash(f.store.referenceImage(copy.project.id,f.scene.id,purpose)),f.scene.draft[purpose].uploadHash);
  }
  const single = await f.service.prepare(f.id,current.revision,f.scene.id);
  fs.unlinkSync(f.file(f.reference.uploadHash));
  await assert.rejects(f.service.run(single.ticket,true),{code:'PROJECT_CORRUPT'});
  assert.equal(f.bodies.length,1);
});

test('combined images over the serialized 8 MiB limit cannot obtain a single or queue ticket', async t => {
  const f = await variationFixture(t);
  f.scene.draft.reference = f.reference;
  const saved = f.store.save(f.id,f.saved.revision,f.content);
  // Isolate the wire-size check from PNG encoding and disk quotas.
  f.store.referenceBytes = () => Buffer.alloc(4 * 1024 * 1024);
  await assert.rejects(f.service.prepare(f.id,saved.revision,f.scene.id), {code:'GENERATION_BODY_LIMIT'});
  await assert.rejects(f.service.prepareQueue(f.id,saved.revision,[f.scene.id],1), {code:'GENERATION_BODY_LIMIT'});
  assert.equal(f.bodies.length,0);
});

test('V3 infill keeps the edited mask aligned with its source through generation, queue, reopening and copying', async (t) => {
  const sharp = require('sharp');
  const f = await fixture(t);
  const id = f.current.project.id;
  const scene = f.content.scenes[0];
  Object.assign(scene.draft, {
    family: 'v4.5',
    model: 'nai-diffusion-3',
    resolution: '128x64',
    prompt: 'background',
  });
  delete scene.draft.reference;
  let saved = f.store.save(id, f.current.revision, f.content);
  const save = () => {
    saved = f.store.save(id, saved.revision, f.content);
  };
  const source = await f.service.importReference(
    id,
    saved.revision,
    f.original,
    'inpaintSource',
  );
  scene.draft.inpaintSource = source.asset;
  save();
  assert.equal(saved.project.version, 11);
  await assert.rejects(f.service.prepare(id, saved.revision, scene.id), {
    code: 'UNSUPPORTED_DRAFT',
  });
  const pixels = Buffer.alloc(128 * 64);
  const pngMask = () =>
    sharp(pixels, { raw: { width: 128, height: 64, channels: 1 } })
      .png()
      .toBuffer();
  await assert.rejects(
    f.service.importReference(
      id,
      saved.revision,
      await pngMask(),
      'inpaintMask',
    ),
    { code: 'PROJECT_INPUT' },
  );
  pixels.fill(255, 0, 32);
  await assert.rejects(
    f.service.importReference(id, saved.revision, f.original, 'inpaintMask'),
    { code: 'PROJECT_INPUT' },
  );
  const mask = await f.service.importReference(
    id,
    saved.revision,
    await pngMask(),
    'inpaintMask',
  );
  scene.draft.inpaintMask = mask.asset;
  save();
  scene.draft.resolution = 'square';
  save();
  await assert.rejects(f.service.prepare(id, saved.revision, scene.id), { code: 'INPAINT_SIZE_MISMATCH' });
  await assert.rejects(f.service.prepareQueue(id, saved.revision, [scene.id], 1), { code: 'INPAINT_SIZE_MISMATCH' });
  scene.draft.resolution = '128x64';
  save();
  assert.throws(
    () => validateWorkspaceProject({ ...saved.project, version: 10 }),
    { code: 'PROJECT_CORRUPT' },
  );
  const wire = await f.service.prepare(id, saved.revision, scene.id);
  assert.equal(wire.model, 'nai-diffusion-3-inpainting');
  assert.equal(f.bodies.length, 0);
  const result = await f.service.run(wire.ticket, true);
  assert.equal(
    result.snapshot.project.images[0].binding.id,
    'nai-v3-inpaint-v1',
  );
  const plan = await f.service.prepareQueue(
    id,
    result.snapshot.revision,
    [scene.id],
    1,
    0,
  );
  const queued = await f.service.runQueue(plan.ticket, true);
  assert.equal(queued.queue.items[0].status, 'done');
  for (const bytes of f.bodies) {
    const body = JSON.parse(Buffer.from(bytes));
    assert.equal(body.action, 'infill');
    assert.equal(body.parameters.add_original_image, true);
    assert.equal(
      hash(Buffer.from(body.parameters.image, 'base64')),
      source.asset.uploadHash,
    );
    assert.equal(
      hash(Buffer.from(body.parameters.mask, 'base64')),
      mask.asset.uploadHash,
    );
    assert.deepEqual(
      await sharp(Buffer.from(body.parameters.mask, 'base64'))
        .greyscale()
        .raw()
        .toBuffer(),
      pixels,
    );
  }
  const copy = f.store.create(f.content, id);
  assert.deepEqual(
    f.store.referenceImage(copy.project.id, scene.id, 'inpaintMask'),
    mask.preview,
  );
  assert.equal(f.store.open(id).project.images.length, 2);
});

test('legacy mask copy publishes a verified project and leaves versioned and early V3 input untouched', async (t) => {
  const sharp = require('sharp');
  const f = await fixture(t);
  const root = path.join(f.profile, 'SDStudio');
  const projects = path.join(root, 'projects');
  fs.mkdirSync(projects, { recursive: true });
  const pixels = Buffer.alloc(64 * 64, 0);
  pixels.fill(255, 64, 128);
  const mask = await sharp(pixels, {raw:{width:64,height:64,channels:1}}).png().toBuffer();
  const source = await sharp({create:{width:64,height:64,channels:3,background:'#227744'}}).png().toBuffer();
  const folder = path.join(root, 'vibes', 'Modern');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'base.png'), source);
  fs.writeFileSync(path.join(folder, 'mask.png'), mask);
  const row = {workflowType:'SDInpaint',preset:{prompt:'sky',uc:'fog',seed:0,steps:20,promptGuidance:4,image:'base.png',mask:'mask.png'}};
  const file = path.join(projects, 'Modern.json');
  const data = JSON.stringify({version:1,inpaints:{Sky:row, Clouds:row, Variation:{workflowType:'SDI2I'}}});
  fs.writeFileSync(file,data);
  const worker = new ProjectService(f.profile, require.resolve('../main/projects/projectWorker.ts'));
  t.after(() => worker.close());
  const copy = await worker.copyLegacyMasks(root,'Modern');
  assert.deepEqual(f.store.open(copy.project.id),copy);
  assert.deepEqual(copy.project.scenes.map(s=>s.name),['Sky','Clouds']);
  assert.equal(copy.project.selectedSceneId,copy.project.scenes[0].id);
  for(const {draft} of copy.project.scenes){
    assert.equal(draft.prompt,'sky');
    assert.equal(draft.negativePrompt,'fog');
    assert.equal(draft.seedMode,'fixed');
    assert.equal(draft.seed,'0');
    assert.equal(draft.steps,'20');
    assert.equal(draft.guidance,'4');
    assert.equal(draft.inpaintSource.sourceHash,hash(source));
    assert.equal(draft.inpaintMask.sourceHash,hash(mask));
    assert.deepEqual(await sharp(f.store.referenceBytes(copy.project.id,draft.inpaintMask)).greyscale().raw().toBuffer(), pixels);
  }
  assert.equal(fs.readFileSync(file,'utf8'),data);
  assert.equal(hash(fs.readFileSync(path.join(folder,'base.png'))),hash(source));
  assert.equal(hash(fs.readFileSync(path.join(folder,'mask.png'))),hash(mask));
  const legacy = JSON.stringify({inpaints:{Retouch:{middlePrompt:'ocean',image:source.toString('base64'),mask:mask.toString('base64')}}});
  fs.writeFileSync(path.join(projects,'Old.json'),legacy);
  const early = await worker.copyLegacyMasks(root,'Old');
  assert.equal(early.project.scenes[0].draft.prompt,'ocean');
  assert.equal(early.project.scenes[0].draft.seedMode,'random');
  assert.equal(fs.readFileSync(path.join(projects,'Old.json'),'utf8'),legacy);
  const before = f.store.list();
  const invalid = { ...row, preset: {...row.preset,mask:'missing.png'} };
  fs.writeFileSync(file, JSON.stringify({version:1,inpaints:{Sky:row,Broken:invalid}}));
  assert.deepEqual(await worker.copyLegacyMasks(root,'Modern'), {failedScene:'Broken'});
  await assert.rejects(worker.copyLegacyMasks(root,'../Modern'));
  assert.deepEqual(f.store.list(),before);
  await assert.rejects(worker.copyLegacyMasks(root,'Modern',['Removed']),{code:'PROJECT_CONFLICT'});
  const subset = await worker.copyLegacyMasks(root,'Modern',['Sky']);
  assert.deepEqual(subset.project.scenes.map(scene=>scene.name),['Sky']);
  assert.deepEqual(f.store.open(subset.project.id), subset);
  assert.equal(fs.readdirSync(path.join(f.profile,'projects-v1')).some(n=>n.startsWith('.import-')),false);
});

test('V3 ordinary scene copies active combinations and original picked PNGs without inventing generation settings', async (t) => {
  const f = await fixture(t);
  const root = path.join(f.profile, 'SDStudio'),
    projects = path.join(root, 'projects');
  const outs = path.join(root, 'outs', 'Book', 'Sky');
  fs.mkdirSync(projects, { recursive: true });
  fs.mkdirSync(outs, { recursive: true });
  const bytes = png(),
    file = path.join(projects, 'Book.json');
  fs.writeFileSync(path.join(outs, 'a.png'), bytes);
  const scene = {
    name: 'Sky',
    resolution: 'custom',
    resolutionWidth: 640,
    resolutionHeight: 896,
    slots: [
      [{ prompt: 'a' }, { prompt: 'unused', enabled: false }, { prompt: 'b' }],
      [{ prompt: 'c' }, { prompt: '<Lib.rain>' }],
    ],
    mains: ['a.png', 'a.png'],
  };
  const session = {
    version: 1,
    scenes: { sky: scene },
    library: { Lib: { pieces: [{ name: 'rain', prompt: 'rain' }] } },
  };
  const original = JSON.stringify(session);
  fs.writeFileSync(file, original);
  const worker = new ProjectService(
    f.profile,
    require.resolve('../main/projects/projectWorker.ts'),
  );
  t.after(() => worker.close());
  const copy = await worker.copyLegacyScene(root, 'Book', 'sky', true);
  const { id, scenes, images } = copy.project;
  assert.equal(copy.project.version, 12);
  assert.deepEqual(
    scenes.map((s) => s.draft.prompt),
    ['a, c', 'a, <Lib.rain>', 'b, c', 'b, <Lib.rain>'],
  );
  assert.equal(scenes[0].draft.pieces, undefined);
  assert.equal(scenes[1].draft.pieces[0].key, 'Lib.rain');
  assert.equal(scenes[0].draft.resolution, '640x896');
  assert.equal(images.length, 1);
  assert.ok(!scenes.some((s) => s.id === images[0].sceneId));
  assert.equal(images[0].origin, 'v3-pick');
  assert.equal(images[0].seed, undefined);
  assert.equal(images[0].draft, undefined);
  assert.equal(images[0].filename, 'a.png');
  assert.deepEqual(f.store.resultPicks(id), [images[0].id]);
  assert.deepEqual(f.store.open(id), copy);
  assert.deepEqual(
    Buffer.from(f.store.image(id, images[0].id)),
    Buffer.from(bytes),
  );
  const duplicate = f.store.copy(id, copy.revision, {
    name: 'Copy',
    scenes,
    selectedSceneId: scenes[0].id,
  });
  assert.deepEqual(f.store.resultPicks(duplicate.project.id), [images[0].id]);
  assert.throws(() =>
    validateWorkspaceProject({ ...copy.project, version: 11 }),
  );
  assert.throws(() =>
    validateWorkspaceProject({
      ...copy.project,
      images: [{ ...images[0], seed: 0 }],
    }),
  );
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  const count = f.store.list().length;
  fs.writeFileSync(
    file,
    JSON.stringify({
      ...session,
      scenes: { sky: { ...scene, mains: ['a.png', 'missing.png'] } },
    }),
  );
  await assert.rejects(worker.copyLegacyScene(root, 'Book', 'sky', true), {
    code: 'PROJECT_LEGACY_PICK',
  });
  assert.equal(f.store.list().length, count);
  const slotsOnly = await worker.copyLegacyScene(root, 'Book', 'sky', false);
  assert.equal(slotsOnly.project.images.length, 0);
  assert.equal(slotsOnly.project.version, 10);
  await assert.rejects(worker.copyLegacyScene(root, 'Book', 'gone', true), {
    code: 'PROJECT_CONFLICT',
  });
  fs.writeFileSync(
    file,
    JSON.stringify({
      scenes: {
        sky: {
          name: 'Sky',
          landscape: false,
          main: 'a.png',
          slots: [[{ prompt: 'old' }]],
        },
      },
    }),
  );
  const old = await worker.copyLegacyScene(root, 'Book', 'sky', true);
  assert.equal(old.project.scenes[0].draft.resolution, 'portrait');
  assert.equal(old.project.images[0].filename, 'a.png');
  for (const [slots, code] of [
    [[[]], 'PROJECT_LEGACY_SCENE'],
    [[Array(61).fill({ prompt: 'x' })], 'PROJECT_LIMIT'],
    [[[{ prompt: '<missing.piece>' }]], 'PROJECT_LEGACY_PIECE'],
  ]) {
    fs.writeFileSync(
      file,
      JSON.stringify({ scenes: { sky: { ...scene, slots } } }),
    );
    await assert.rejects(worker.copyLegacyScene(root, 'Book', 'sky', false), {
      code,
    });
  }
  const slots = Array.from({ length: 3 }, (_, s) =>
    Array.from({ length: 5 }, (_, n) => ({ prompt: `${s}-${n}` })),
  );
  fs.writeFileSync(
    file,
    JSON.stringify({ scenes: { sky: { ...scene, slots } } }),
  );
  const allPrompts = [];
  for (const number of [1, 2, 3]) {
    const page = await worker.copyLegacyScene(
      root,
      'Book',
      'sky',
      number === 1,
      { number, total: 125 },
    );
    assert.deepEqual(f.store.open(page.project.id), page);
    assert.equal(page.project.images.length, number === 1 ? 1 : 0);
    assert.match(
      page.project.name,
      new RegExp(`${(number - 1) * 60 + 1}–${Math.min(number * 60, 125)}$`),
    );
    allPrompts.push(...page.project.scenes.map((s) => s.draft.prompt));
  }
  const expected = slots[0].flatMap((a) =>
    slots[1].flatMap((b) =>
      slots[2].map((c) => [a.prompt, b.prompt, c.prompt].join(', ')),
    ),
  );
  assert.deepEqual(allPrompts, expected);
  for (const number of [0, -1, 1.5, 4, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      worker.copyLegacyScene(root, 'Book', 'sky', false, {
        number,
        total: 125,
      }),
      { code: 'PROJECT_INPUT' },
    );
  }
  await assert.rejects(
    worker.copyLegacyScene(root, 'Book', 'sky', false, {
      number: 1,
      total: 124,
    }),
    { code: 'PROJECT_CONFLICT' },
  );
  // The first-newline rule is the original V3 toPARR behavior for multi-line slots.
  fs.writeFileSync(file, JSON.stringify({scenes:{sky:{...scene,slots:[[{prompt:'a\nb\nc'}]]}}}));
  const multiline = await worker.copyLegacyScene(root,'Book','sky',false);
  assert.equal(multiline.project.scenes[0].draft.prompt, 'a, b\nc');

});
