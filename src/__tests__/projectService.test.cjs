const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { ProjectService } = require('../main/projects/projectService');
const { ProjectStore } = require('../main/projects/projectStore');
const { ProjectCloseCoordinator } = require('../main/projects/projectClose');
const {
  createWorkspaceState,
  snapshotWorkspaceScenes,
} = require('../renderer/preview/workspaceDraft');
const { png } = require('./fixtures/nai/png.cjs');
function fixture(t) {
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sdstudio-project-worker-'),
  );
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const state = createWorkspaceState();
  return {
    profile,
    content: {
      name: 'synthetic',
      selectedSceneId: state.selectedSceneId,
      scenes: snapshotWorkspaceScenes(state),
    },
    store: new ProjectStore(profile),
  };
}
test('metadata-only save does not read PNGs; open verifies a 120-record image project and runs off the caller thread', async (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  const bytes = png(2, 1, Buffer.alloc(2 * 1024 * 1024)),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  const folder = path.join(f.profile, 'projects-v1', id);
  fs.writeFileSync(path.join(folder, 'images', sha256 + '.png'), bytes);
  const project = {
    ...first.project,
    images: Array.from({ length: 120 }, () => ({
      id: randomUUID(),
      sceneId: f.content.selectedSceneId,
      model: 'fixture-model-not-for-api',
      sampler: 'fixture-sampler',
      noiseSchedule: 'fixture-noise',
      seed: 0,
      draft: f.content.scenes[0].draft,
      sha256,
      pngBytes: bytes.length,
    })),
  };
  fs.writeFileSync(path.join(folder, 'project.json'), JSON.stringify(project));
  const raw = fs.readFileSync(path.join(folder, 'project.json')),
    revision = createHash('sha256').update(raw).digest('hex');
  const openSync = fs.openSync;
  let pngReads = 0;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (String(file).endsWith('.png')) pngReads++;
    return openSync(file, ...args);
  });
  const start = performance.now();
  f.store.save(id, revision, { ...f.content, name: 'changed' });
  const saveMs = performance.now() - start;
  assert.equal(pngReads, 0);
  const service = new ProjectService(
    f.profile,
    path.resolve('src/main/projects/projectWorker.ts'),
  );
  t.after(() => service.close());
  let heartbeat = 0;
  const timer = setInterval(() => heartbeat++, 5);
  const openStart = performance.now();
  await service.open(id);
  const openMs = performance.now() - openStart;
  clearInterval(timer);
  assert.ok(heartbeat > 0);
  console.log(
    JSON.stringify({
      fixture: '120 records sharing one synthetic 2MiB PNG',
      logicalPNGBytes: bytes.length * 120,
      saveMs,
      workerOpenMs: openMs,
      mainHeartbeat: heartbeat,
      pngReadsDuringSave: pngReads,
    }),
  );
});
test('1000-history boundary and stale lock offer a verified new copy without mutating source or clearing its lock', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id,
    folder = path.join(f.profile, 'projects-v1', id),
    history = path.join(folder, 'history');
  for (let i = 0; i < 999; i++)
    fs.writeFileSync(
      path.join(history, i.toString(16).padStart(64, '0') + '.json'),
      'synthetic placeholder',
    );
  const next = f.store.save(id, first.revision, {
    ...f.content,
    name: 'last revision',
  });
  assert.equal(f.store.history(id).length, 1000);
  assert.throws(
    () => f.store.save(id, next.revision, { ...f.content, name: 'over limit' }),
    { code: 'PROJECT_HISTORY_LIMIT' },
  );
  const same = f.store.save(id, next.revision, {
    ...f.content,
    name: 'last revision',
  });
  assert.equal(same.revision, next.revision);
  fs.writeFileSync(
    path.join(folder, 'write.lock'),
    'synthetic interrupted writer',
  );
  const copy = f.store.copy(id, next.revision, {
    ...f.content,
    name: 'continue',
  });
  assert.notEqual(copy.project.id, id);
  assert.equal(
    fs.readFileSync(path.join(folder, 'write.lock'), 'utf8'),
    'synthetic interrupted writer',
  );
  assert.equal(f.store.open(id).revision, next.revision);
});
test('metadata save preserves missing image references but full open/copy still refuses damaged images', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  const added = f.store.addPNG(
    id,
    first.revision,
    {
      sceneId: f.content.selectedSceneId,
      model: 'fixture-model',
      sampler: 'fixture-sampler',
      noiseSchedule: 'fixture-noise',
      seed: 0,
      draft: f.content.scenes[0].draft,
    },
    png(),
  );
  fs.unlinkSync(
    path.join(
      f.profile,
      'projects-v1',
      id,
      'images',
      added.project.images[0].sha256 + '.png',
    ),
  );
  const saved = f.store.save(id, added.revision, {
    ...f.content,
    name: 'input preserved',
  });
  assert.equal(saved.project.images.length, 1);
  assert.throws(() => f.store.open(id), { code: 'PROJECT_CORRUPT' });
  assert.throws(() => f.store.copy(id, saved.revision, f.content), {
    code: 'PROJECT_CORRUPT',
  });
});
test('native close never approves before a trusted finish and cancellation allows another request', async () => {
  const events = [],
    handlers = new Map();
  let trusted = false;
  const close = new ProjectCloseCoordinator(
    () => events.push('request'),
    () => events.push('close'),
  );
  close.register({ handle: (c, f) => handlers.set(c, f) }, () => trusted);
  assert.equal(close.request(), false);
  assert.deepEqual(events, ['request']);
  assert.equal(await handlers.get('workspace-close-finish')({}), false);
  trusted = true;
  assert.equal(await handlers.get('workspace-close-cancel')({}), true);
  assert.equal(close.finish(), false);
  assert.equal(close.request(), false);
  assert.equal(await handlers.get('workspace-close-finish')({}), true);
  assert.equal(close.request(), true);
  assert.deepEqual(events, ['request', 'request', 'close']);
  close.reset();
  assert.equal(close.request(), false); // A reactivated window requires a new approval.
});

test('worker failure and queue bound return fixed failures and never automatically restart writes', async (t) => {
  const f = fixture(t),
    entry = path.join(f.profile, 'stall.cjs');
  fs.writeFileSync(entry, 'setInterval(()=>{},1000)');
  const service = new ProjectService(f.profile, entry);
  t.after(() => service.close());
  const pending = Array.from({ length: 16 }, () =>
    service.list().catch((error) => error.code),
  );
  await assert.rejects(service.list(), { code: 'PROJECT_BUSY' });
  service.close();
  assert.deepEqual(
    await Promise.all(pending),
    Array(16).fill('PROJECT_SERVICE_STOPPED'),
  );
  await assert.rejects(service.list(), { code: 'PROJECT_SERVICE_STOPPED' });
  const failing = path.join(f.profile, 'fail.cjs');
  fs.writeFileSync(failing, "throw Error('synthetic private path')");
  const broken = new ProjectService(f.profile, failing);
  t.after(() => broken.close());
  await assert.rejects(broken.list(), {
    code: 'PROJECT_SERVICE_STOPPED',
    message: 'PROJECT_SERVICE_STOPPED',
  });
  await assert.rejects(broken.list(), { code: 'PROJECT_SERVICE_STOPPED' });
});

test('synchronous Worker construction errors always reject a Promise with the stopped code', async (t) => {
  const f = fixture(t),
    service = new ProjectService(f.profile, 'invalid-bare-worker-path');
  t.after(() => service.close());
  const result = service.list();
  assert.ok(result instanceof Promise);
  await assert.rejects(result, {
    code: 'PROJECT_SERVICE_STOPPED',
    message: 'PROJECT_SERVICE_STOPPED',
  });
  await assert.rejects(service.list(), { code: 'PROJECT_SERVICE_STOPPED' });
});
test('manual storage restart does not replay writes and development hook is independent of cwd', async (t) => {
  const f = fixture(t),
    entry = path.resolve('src/main/projects/projectWorker.ts'),
    service = new ProjectService(f.profile, entry);
  t.after(() => service.close());
  const initial = await service.create(f.content);
  await service.worker.terminate();
  await new Promise(setImmediate);
  await assert.rejects(
    service.save(initial.project.id, initial.revision, {
      ...f.content,
      name: 'never sent',
    }),
    { code: 'PROJECT_SERVICE_STOPPED' },
  );
  const before = fs.readFileSync(
    path.join(f.profile, 'projects-v1', initial.project.id, 'project.json'),
  );
  const cwd = process.cwd();
  try {
    process.chdir(f.profile);
    await service.restartStorage();
  } finally {
    process.chdir(cwd);
  }
  assert.deepEqual(
    fs.readFileSync(
      path.join(f.profile, 'projects-v1', initial.project.id, 'project.json'),
    ),
    before,
  );
  assert.equal(
    (await service.open(initial.project.id)).project.name,
    'synthetic',
  );
  assert.equal(
    (
      await service.save(initial.project.id, initial.revision, {
        ...f.content,
        name: 'explicit new save',
      })
    ).project.name,
    'explicit new save',
  );
});
test('renderer unavailable close requires an explicit native decision and stale decisions cannot close a new window', async () => {
  const events = [],
    decisions = [];
  const close = new ProjectCloseCoordinator(
    () => events.push('renderer'),
    () => events.push('close'),
    (reason) => new Promise((resolve) => decisions.push({ reason, resolve })),
  );
  close.setRendererState('unresponsive');
  assert.equal(close.request(), false);
  assert.equal(close.request(), false);
  await new Promise(setImmediate);
  assert.equal(decisions.length, 1);
  assert.equal(close.finish(), false);
  decisions[0].resolve(false);
  await new Promise(setImmediate);
  assert.deepEqual(events, []);
  close.setRendererState();
  close.request();
  assert.deepEqual(events, ['renderer']);
  close.setRendererState('gone');
  close.request();
  await new Promise(setImmediate);
  assert.equal(decisions[1].reason, 'gone');
  close.reset();
  decisions[1].resolve(true);
  await new Promise(setImmediate);
  assert.deepEqual(events, ['renderer']);
  close.setRendererState('gone');
  close.request();
  await new Promise(setImmediate);
  decisions[2].resolve(true);
  await new Promise(setImmediate);
  assert.deepEqual(events, ['renderer', 'close']);
  assert.equal(close.request(), true);
});

test('renderer recovery with an invalidated close request shows retry guidance instead of silently keeping the window', async () => {
  const {
    finishProjectClose,
  } = require('../renderer/projects/finishProjectClose');
  let closed = 0;
  const messages = [];
  const close = new ProjectCloseCoordinator(
    () => {},
    () => {
      closed++;
    },
  );
  close.request();
  close.setRendererState('unresponsive');
  close.setRendererState();
  assert.equal(
    await finishProjectClose(
      async () => close.finish(),
      (message) => messages.push(message),
    ),
    false,
  );
  assert.match(messages[0], /닫기를 다시/);
  assert.equal(closed, 0);
  close.request();
  assert.equal(
    await finishProjectClose(
      async () => close.finish(),
      (message) => messages.push(message),
    ),
    true,
  );
  assert.equal(messages.length, 1);
  assert.equal(closed, 1);
});

test('main-side close guard retains an active request or unsaved PNG despite an outdated renderer finish acknowledgement', () => {
  let busy = true,
    closed = 0;
  const close = new ProjectCloseCoordinator(
    () => {},
    () => {
      closed++;
    },
    undefined,
    () => !busy,
  );
  close.request();
  assert.equal(close.finish(), false);
  assert.equal(closed, 0);
  busy = false;
  assert.equal(close.finish(), true);
  assert.equal(closed, 1);
});
