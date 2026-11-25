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
  const b = bindBasicGeneration(scene, () => 12345, bytes);
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
  assert.throws(() => bindBasicGeneration(scene, () => 1, f.original), { message: 'UNSUPPORTED_DRAFT' });
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

test('invalid or mixed variation, mismatched shape and unsupported family cannot silently generate', async t => {
  const f = await variationFixture(t);
  const bind = (patch) => bindBasicGeneration({...f.scene, draft: {...f.scene.draft, ...patch}}, () => 0, f.original);
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
