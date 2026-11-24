const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { ProjectStore } = require('../main/projects/projectStore');
const { ProjectService } = require('../main/projects/projectService');
const { ProjectError } = require('../workspaceProject');
const { WorkspaceGeneration } = require('../main/nai/workspaceGeneration');
const { bindBasicGeneration } = require('../main/nai/workspaceBinding');
const { registerGeneration } = require('../main/nai/generationIpc');
const {
  firstGenerationObserver,
} = require('../main/nai/generationDiagnostics');
const { NaiError } = require('../main/nai/errors');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const {
  snapshotWorkspaceScenes,
} = require('../renderer/preview/workspaceDraft');
const { png } = require('./fixtures/nai/png.cjs');
function fixture(t, options = {}) {
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'workspace-generation-'),
  );
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const state = createConnectedWorkspaceState('v4.5');
  state.draft.seedMode = 'fixed';
  state.draft.seed = '0';
  state.draft.prompt = 'a quiet lake, watercolor landscape';
  state.draft.negativePrompt = 'blurry';
  const core = new ProjectStore(profile);
  const first = core.create({
    name: 'synthetic',
    selectedSceneId: state.selectedSceneId,
    scenes: snapshotWorkspaceScenes(state),
  });
  let sends = 0,
    online = true,
    body;
  const bytes = Uint8Array.from(png());
  const service = new WorkspaceGeneration({
    store: options.store?.(core) ?? core,
    offline: () => !online,
    sendImage: async (b, signal) => {
      sends++;
      body = JSON.parse(Buffer.from(b).toString());
      return options.send ? options.send(b, signal) : bytes;
    },
  });
  return {
    profile,
    core,
    service,
    first,
    state,
    bytes,
    prepare: () =>
      service.prepare(first.project.id, first.revision, state.selectedSceneId),
    offline: () => {
      online = false;
    },
    get sends() {
      return sends;
    },
    get body() {
      return body;
    },
  };
}
test('basic binding matches the successful research candidate exactly, keeps seed 0 and never mutates the scene', (t) => {
  const f = fixture(t),
    scene = f.first.project.scenes[0],
    before = structuredClone(scene);
  assert.deepEqual(
    bindBasicGeneration(scene).request,
    require('../../.erb/fixtures/nai-live-candidate.json').request,
  );
  assert.deepEqual(scene, before);
  const random = structuredClone(scene);
  random.draft.seedMode = 'random';
  assert.equal(bindBasicGeneration(random, () => 12345).input.seed, 12345);
});
test('unverified character/legacy settings and inline/wildcard/empty prompt are refused before transmission', (t) => {
  const f = fixture(t),
    scene = f.first.project.scenes[0];
  for (const patch of [
    { resolution: 'portrait' },
    { steps: '29' },
    { guidance: '6' },
    { prompt: '' },
    { prompt: 'a | b' },
    { negativePrompt: '<group.piece>' },
    { characters: [{ enabled: true }] },
  ])
    assert.throws(() =>
      bindBasicGeneration({ ...scene, draft: { ...scene.draft, ...patch } }),
    );
  assert.throws(() =>
    bindBasicGeneration({
      ...scene,
      draft: { ...scene.draft, seed: '4294967296' },
    }),
  );
  assert.equal(f.sends, 0);
});
test('offline refuses before filesystem access; preparation and unconfirmed run send no request', async (t) => {
  const f = fixture(t),
    plan = await f.prepare();
  await assert.rejects(f.service.run(plan.ticket, false), {
    code: 'CONFIRMATION_EXPIRED',
  });
  assert.equal(f.sends, 0);
  f.offline();
  await assert.rejects(f.service.prepare('invalid', 'invalid', 'invalid'), {
    code: 'OFFLINE',
  });
  await assert.rejects(f.service.run(plan.ticket, true), { code: 'OFFLINE' });
  assert.equal(f.sends, 0);
});
test('single-use confirmation persists original PNG, request/draft/model/seed and can reopen it without a network call', async (t) => {
  const f = fixture(t),
    plan = await f.prepare();
  const result = await f.service.run(plan.ticket, true);
  assert.equal(f.sends, 1);
  assert.equal(result.snapshot.project.images.length, 1);
  const image = result.snapshot.project.images[0];
  assert.equal(image.id, result.imageId);
  assert.equal(image.seed, 0);
  assert.equal(image.model, 'nai-diffusion-4-5-full');
  assert.equal(image.noiseSchedule, 'karras');
  assert.deepEqual(
    await f.service.image(f.first.project.id, image.id),
    f.bytes,
  );
  assert.deepEqual(
    new ProjectStore(f.profile).open(f.first.project.id),
    result.snapshot,
  );
  await assert.rejects(f.service.run(plan.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  await assert.rejects(f.service.image(f.first.project.id, randomUUID()), {
    code: 'PROJECT_NOT_FOUND',
  });
  assert.equal(f.sends, 1);
  assert.equal(f.service.hasWork(), false);
});
test('replaced confirmation and changed saved revision cannot send stale settings', async (t) => {
  const f = fixture(t),
    first = await f.prepare(),
    second = await f.prepare();
  await assert.rejects(f.service.run(first.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  f.core.save(f.first.project.id, f.first.revision, {
    name: 'changed',
    selectedSceneId: f.state.selectedSceneId,
    scenes: f.first.project.scenes,
  });
  await assert.rejects(f.service.run(second.ticket, true), {
    code: 'PROJECT_CONFLICT',
  });
  assert.equal(f.sends, 0);
});
test('cancel preserves server-processing uncertainty, does not retry and allows no parallel generation', async (t) => {
  const f = fixture(t, {
    send: (_b, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new NaiError('CANCELLED', true)),
          { once: true },
        ),
      ),
  });
  const plan = await f.prepare(),
    task = f.service.run(plan.ticket, true);
  await new Promise(setImmediate);
  await assert.rejects(f.prepare(), { code: 'GENERATION_BUSY' });
  f.service.cancel();
  await assert.rejects(task, { code: 'CANCELLED', mayHaveReachedServer: true });
  await assert.rejects(f.service.run(plan.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  assert.equal(f.sends, 1);
  assert.equal(f.service.hasWork(), false);
});
test('storage failure retains exactly one response and explicit save-only recovery makes no second API request', async (t) => {
  let fail = true;
  const f = fixture(t, {
    store: (core) =>
      new Proxy(core, {
        get(target, key) {
          if (key === 'addPNG')
            return (...args) => {
              if (fail) throw new ProjectError('PROJECT_BUSY');
              return target.addPNG(...args);
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
  });
  const plan = await f.prepare();
  await assert.rejects(f.service.run(plan.ticket, true), {
    code: 'RESULT_SAVE_FAILED',
    mayHaveReachedServer: true,
    pendingResult: true,
    projectCode: 'PROJECT_BUSY',
  });
  assert.deepEqual(f.service.status(), { active: false, pending: true });
  await assert.rejects(f.prepare(), { code: 'GENERATION_BUSY' });
  fail = false;
  const result = await f.service.retrySave();
  assert.equal(f.sends, 1);
  assert.equal(result.snapshot.project.images.length, 1);
  assert.deepEqual(
    await f.service.image(f.first.project.id, result.imageId),
    f.bytes,
  );
});
test('ambiguous committed addPNG is found by its stable result UUID and never duplicated on save-only retry', async (t) => {
  const f = fixture(t, {
    store: (core) =>
      new Proxy(core, {
        get(target, key) {
          if (key === 'addPNG')
            return (...args) => {
              target.addPNG(...args);
              throw new ProjectError('PROJECT_IO');
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }),
  });
  await assert.rejects(f.service.run((await f.prepare()).ticket, true), {
    code: 'RESULT_SAVE_FAILED',
  });
  const recovered = await f.service.retrySave();
  assert.equal(recovered.snapshot.project.images.length, 1);
  assert.equal(f.sends, 1);
});
test('preflight refuses leftover lock and history bound without spending a request; no lock is deleted', async (t) => {
  const f = fixture(t),
    lock = path.join(
      f.profile,
      'projects-v1',
      f.first.project.id,
      'write.lock',
    );
  fs.writeFileSync(lock, 'synthetic');
  await assert.rejects(f.prepare(), { code: 'PROJECT_BUSY' });
  assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic');
  assert.equal(f.sends, 0);
});
test('all generation IPCs check trust first and return no token, raw error, internal reason, or filesystem path', async (t) => {
  const f = fixture(t),
    handlers = new Map();
  registerGeneration(
    { handle: (name, action) => handlers.set(name, action) },
    f.service,
    (e) => e === 'trusted',
  );
  assert.equal(handlers.size, 13);
  for (const action of handlers.values())
    assert.deepEqual(await action('untrusted', '../private', 'raw-secret'), {
      ok: false,
      code: 'UNTRUSTED_SENDER',
      mayHaveReachedServer: false,
    });
  const reply = await handlers.get('workspace-generation-image')(
    'trusted',
    '../private',
    'wrong',
  );
  assert.deepEqual(reply, {
    ok: false,
    code: 'PROJECT_INPUT',
    mayHaveReachedServer: false,
  });
});
test('the real worker writes and reads generation PNG with metadata/alpha unchanged and rejects renderer-independent path traversal', async (t) => {
  const f = fixture(t),
    worker = new ProjectService(
      f.profile,
      path.resolve('src/main/projects/projectWorker.ts'),
    );
  t.after(() => worker.close());
  const service = new WorkspaceGeneration({
    store: worker,
    offline: () => false,
    sendImage: async () => f.bytes,
  });
  const plan = await service.prepare(
    f.first.project.id,
    f.first.revision,
    f.state.selectedSceneId,
  );
  const saved = await service.run(plan.ticket, true);
  assert.deepEqual(
    await service.image(f.first.project.id, saved.imageId),
    f.bytes,
  );
  assert.equal(saved.snapshot.project.images[0].seed, 0);
  await assert.rejects(worker.readPNG('../escape', 'a'.repeat(64)), {
    code: 'PROJECT_INPUT',
  });
});
test('first MIME observation is private, bounded, sanitized and never overwritten', async (t) => {
  const f = fixture(t),
    observe = firstGenerationObserver(f.profile);
  observe({
    mediaTypeState: 'present',
    mediaType: 'binary/octet-stream; secret=omitted',
    httpStatus: 200,
  });
  const file = path.join(f.profile, 'nai-diagnostics/first-response.v1.json');
  // Async writeFile creates the file before writing its JSON bytes.
  for (
    let i = 0;
    i < 50 && (!fs.existsSync(file) || fs.statSync(file).size === 0);
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  const saved = fs.readFileSync(file, 'utf8');
  assert.deepEqual(JSON.parse(saved), {
    version: 1,
    httpStatus: 200,
    mediaTypeState: 'present',
    mediaType: 'binary/octet-stream',
  });
  // Windows ACLs are not represented by the POSIX permission bits returned here.
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  observe({ mediaTypeState: 'absent', httpStatus: 500 });
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
});

test('a stranded lock after response can be preserved while inputs and just this PNG are saved to a new project, without another request', async (t) => {
  const f = fixture(t),
    plan = await f.prepare();
  const lock = path.join(
    f.profile,
    'projects-v1',
    f.first.project.id,
    'write.lock',
  );
  fs.writeFileSync(lock, 'synthetic');
  // Claim passed before response in real flow; inject lock during send for this controlled case.
  fs.unlinkSync(lock);
  const original = f.service.options.sendImage;
  f.service.options.sendImage = async (...args) => {
    const bytes = await original(...args);
    fs.writeFileSync(lock, 'synthetic');
    return bytes;
  };
  await assert.rejects(f.service.run(plan.ticket, true), {
    code: 'RESULT_SAVE_FAILED',
    projectCode: 'PROJECT_BUSY',
  });
  const saved = await f.service.retrySave(true);
  assert.notEqual(saved.snapshot.project.id, f.first.project.id);
  assert.equal(saved.snapshot.project.images.length, 1);
  assert.equal(f.core.open(f.first.project.id).project.images.length, 0);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic');
  assert.equal(f.sends, 1);
});

test('history at its bound is refused by generation preflight before sending', async (t) => {
  const f = fixture(t),
    history = path.join(
      f.profile,
      'projects-v1',
      f.first.project.id,
      'history',
    );
  fs.mkdirSync(history, { recursive: true });
  for (let i = 0; i < 1000; i++)
    fs.writeFileSync(
      path.join(history, i.toString(16).padStart(64, '0') + '.json'),
      '{}',
    );
  await assert.rejects(f.prepare(), { code: 'PROJECT_LIMIT' });
  assert.equal(f.sends, 0);
});

test('generation alone upgrades v1 to v2 with binding/versioned body hash; copy preserves it and prior v1 input can recover independently', async (t) => {
  const f = fixture(t);
  assert.equal(f.first.project.version, 1);
  const generated = await f.service.run((await f.prepare()).ticket, true);
  assert.equal(generated.snapshot.project.version, 2);
  const binding = generated.snapshot.project.images[0].binding;
  assert.deepEqual(binding, {
    id: 'nai-v45-basic512-v1',
    requestHash: require('node:crypto')
      .createHash('sha256')
      .update(JSON.stringify(f.body))
      .digest('hex'),
  });
  const copied = f.core.copy(f.first.project.id, generated.snapshot.revision, {
    name: 'copy',
    selectedSceneId: f.state.selectedSceneId,
    scenes: f.first.project.scenes,
  });
  assert.equal(copied.project.version, 2);
  assert.deepEqual(copied.project.images[0].binding, binding);
  const recovered = f.core.recover(f.first.project.id, f.first.revision);
  assert.equal(recovered.project.version, 1);
  assert.equal(recovered.project.images.length, 0);
  assert.equal(f.core.open(f.first.project.id).project.version, 2);
  assert.equal(f.sends, 1);
});

test('binding metadata is accepted only in v2 with exact allowlisted shape; unknown versions and credential-like extra keys remain refused', async (t) => {
  const { validateWorkspaceProject } = require('../workspaceProject');
  const f = fixture(t),
    result = await f.service.run((await f.prepare()).ticket, true);
  const image = result.snapshot.project.images[0];
  assert.throws(
    () => validateWorkspaceProject({ ...result.snapshot.project, version: 1 }),
    { code: 'PROJECT_CORRUPT' },
  );
  assert.throws(
    () => validateWorkspaceProject({ ...result.snapshot.project, version: 4 }),
    { code: 'PROJECT_VERSION' },
  );
  assert.throws(
    () =>
      validateWorkspaceProject({
        ...result.snapshot.project,
        images: [
          { ...image, binding: { ...image.binding, token: 'synthetic' } },
        ],
      }),
    { code: 'PROJECT_CORRUPT' },
  );
  assert.throws(
    () =>
      validateWorkspaceProject({
        ...result.snapshot.project,
        images: [
          { ...image, binding: { ...image.binding, requestHash: '../path' } },
        ],
      }),
    { code: 'PROJECT_CORRUPT' },
  );
});
