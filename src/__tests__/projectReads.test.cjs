const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { ProjectStore } = require('../main/projects/projectStore');
const { ProjectService } = require('../main/projects/projectService');
const { WorkspaceGeneration } = require('../main/nai/workspaceGeneration');
const { ProjectError } = require('../workspaceProject');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const {
  snapshotWorkspaceScenes,
} = require('../renderer/preview/workspaceDraft');
const { png } = require('./fixtures/nai/png.cjs');
const metrics = {
  syntheticOnly: true,
  actualAccountRequests: 0,
  note: 'Physical-file open counts, not a 256MiB latency benchmark.',
};
after(() => {
  if (process.env.SDSTUDIO_PROJECT_READ_REPORT)
    fs.writeFileSync(
      process.env.SDSTUDIO_PROJECT_READ_REPORT,
      JSON.stringify(metrics, null, 2),
    );
});
function fixture(t, count = 120) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-reads-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const state = createConnectedWorkspaceState('v4.5');
  state.draft.seedMode = 'fixed';
  state.draft.seed = '0';
  const core = new ProjectStore(profile);
  const first = core.create({
    name: 'synthetic reads',
    selectedSceneId: state.selectedSceneId,
    scenes: snapshotWorkspaceScenes(state),
  });
  const folder = path.join(profile, 'projects-v1', first.project.id);
  fs.mkdirSync(path.join(folder, 'images'), { recursive: true });
  const buffers = [];
  const images = Array.from({ length: count }, (_, index) => {
    const opaque = Buffer.alloc(32 * 1024, index);
    opaque.writeUInt32BE(index, 0);
    const bytes = png(2, 1, opaque);
    buffers.push(Uint8Array.from(bytes));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(path.join(folder, 'images', sha256 + '.png'), bytes);
    return {
      id: randomUUID(),
      sceneId: state.selectedSceneId,
      model: 'fixture-model-not-for-api',
      sampler: 'fixture-sampler',
      noiseSchedule: 'fixture-noise',
      seed: index,
      draft: structuredClone(state.draft),
      sha256,
      pngBytes: bytes.length,
    };
  });
  fs.writeFileSync(
    path.join(folder, 'project.json'),
    JSON.stringify({ ...first.project, images }, null, 2),
  );
  const snapshot = core.readManifest(first.project.id);
  return {
    profile,
    state,
    core,
    folder,
    images,
    buffers,
    snapshot,
    imageFile: (index) =>
      path.join(folder, 'images', images[index].sha256 + '.png'),
  };
}
function trace(t) {
  const files = [],
    original = fs.openSync;
  t.mock.method(fs, 'openSync', (file, flags, ...args) => {
    const reading =
      flags === 'r' ||
      (typeof flags === 'number' &&
        (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) ===
          fs.constants.O_RDONLY);
    if (reading && typeof file === 'string' && file.endsWith('.png'))
      files.push(path.basename(file));
    return original(file, flags, ...args);
  });
  return {
    files,
    reset() {
      files.length = 0;
    },
  };
}
test('120 distinct physical PNGs: explicit open verifies all; legacy selection reads121; optimized UUID selection reads exactly1', (t) => {
  const f = fixture(t),
    reads = trace(t),
    index = 73;
  const opened = f.core.open(f.snapshot.project.id);
  assert.equal(reads.files.length, 120);
  const legacy = f.core.readPNG(
    opened.project.id,
    opened.project.images[index].sha256,
  );
  const oldCount = reads.files.length;
  assert.equal(oldCount, 121);
  reads.reset();
  const selected = f.core.image(opened.project.id, f.images[index].id);
  assert.equal(reads.files.length, 1);
  assert.equal(reads.files[0], f.images[index].sha256 + '.png');
  assert.deepEqual(selected, f.buffers[index]);
  assert.deepEqual(selected, legacy);
  metrics.selection = {
    physicalPNGFiles: 120,
    totalPNGBytes: f.images.reduce((n, i) => n + i.pngBytes, 0),
    explicitOpenReads: 120,
    previousSelectionReads: oldCount,
    selectedImageReads: reads.files.length,
  };
});
test('fast selection still rejects missing/corrupt/size-mismatched selected PNG and unreferenced UUID/path before disclosure', (t) => {
  const f = fixture(t, 3),
    reads = trace(t),
    id = f.snapshot.project.id;
  assert.throws(() => f.core.image(id, randomUUID()), {
    code: 'PROJECT_NOT_FOUND',
  });
  assert.equal(reads.files.length, 0);
  assert.throws(() => f.core.image('../outside', f.images[1].id), {
    code: 'PROJECT_INPUT',
  });
  assert.throws(() => f.core.image(id, '../outside'), {
    code: 'PROJECT_INPUT',
  });
  fs.writeFileSync(f.imageFile(1), Buffer.from('corrupt'));
  assert.throws(() => f.core.image(id, f.images[1].id), {
    code: 'PROJECT_CORRUPT',
  });
  assert.equal(reads.files.length, 1);
  fs.writeFileSync(f.imageFile(1), f.buffers[1]);
  const data = f.core.readManifest(id).project;
  data.images[1].pngBytes++;
  fs.writeFileSync(path.join(f.folder, 'project.json'), JSON.stringify(data));
  assert.throws(() => f.core.image(id, f.images[1].id), {
    code: 'PROJECT_CORRUPT',
  });
  fs.unlinkSync(f.imageFile(1));
  assert.throws(() => f.core.image(id, f.images[1].id), {
    code: 'PROJECT_IO',
  });
});
test('an unrelated missing PNG does not block valid selection, but explicit project open/copy remain full-integrity checks', (t) => {
  const f = fixture(t, 3),
    id = f.snapshot.project.id;
  fs.unlinkSync(f.imageFile(0));
  assert.deepEqual(f.core.image(id, f.images[2].id), f.buffers[2]);
  assert.throws(() => f.core.open(id), { code: 'PROJECT_CORRUPT' });
  assert.throws(
    () =>
      f.core.copy(id, f.snapshot.revision, {
        name: 'copy',
        selectedSceneId: f.state.selectedSceneId,
        scenes: f.snapshot.project.scenes,
      }),
    { code: 'PROJECT_CORRUPT' },
  );
});
test('119 existing physical PNGs: prepare/run preflight reads no PNG; new unique result append does not rescan old files', async (t) => {
  const f = fixture(t, 119),
    id = f.snapshot.project.id;
  f.core.open(id); // Explicit initial verification remains required by the normal UI open flow.
  fs.unlinkSync(f.imageFile(0)); // Simulate an external deletion after that verification.
  let sends = 0;
  const next = Uint8Array.from(png(2, 1, Buffer.from('new synthetic result')));
  const generation = new WorkspaceGeneration({
    store: f.core,
    offline: () => false,
    sendImage: async () => {
      sends++;
      return next;
    },
  });
  const reads = trace(t);
  const plan = await generation.prepare(
    id,
    f.snapshot.revision,
    f.state.selectedSceneId,
  );
  const preparedReads = reads.files.length;
  assert.equal(preparedReads, 0);
  const result = await generation.run(plan.ticket, true);
  assert.equal(reads.files.length, 0);
  assert.equal(sends, 1);
  assert.equal(result.snapshot.project.images.length, 120);
  assert.equal(result.snapshot.project.images[0].sha256, f.images[0].sha256);
  assert.deepEqual(await generation.image(id, result.imageId), next);
  assert.equal(reads.files.length, 1);
  assert.throws(() => f.core.open(id), { code: 'PROJECT_CORRUPT' });
  metrics.generation = {
    existingPhysicalPNGFiles: 119,
    externallyMissingAfterOpen: 1,
    preparePNGReads: preparedReads,
    runOldPNGReads: 0,
    selectedNewPNGReads: 1,
    syntheticSends: sends,
    untouchedMissingReferenceRetained: true,
  };
});
test('metadata-only preflight retains revision, lock and image-count bounds with zero PNG reads', (t) => {
  const f = fixture(t),
    reads = trace(t),
    id = f.snapshot.project.id;
  assert.throws(() => f.core.generationSnapshot(id, '0'.repeat(64)), {
    code: 'PROJECT_CONFLICT',
  });
  const lock = path.join(f.folder, 'write.lock');
  fs.writeFileSync(lock, 'synthetic');
  assert.throws(() => f.core.generationSnapshot(id, f.snapshot.revision), {
    code: 'PROJECT_BUSY',
  });
  assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic');
  fs.unlinkSync(lock);
  assert.throws(() => f.core.generationSnapshot(id, f.snapshot.revision), {
    code: 'PROJECT_RESULT_LIMIT',
  });
  assert.equal(reads.files.length, 0);
});
test('ambiguous save retry verifies only its committed result and retains the pending PNG if that file is corrupted', async (t) => {
  const f = fixture(t, 3),
    id = f.snapshot.project.id;
  let sends = 0;
  const next = Uint8Array.from(png(2, 1, Buffer.from('ambiguous result')));
  const store = new Proxy(f.core, {
    get(target, key) {
      if (key === 'addPNG')
        return (...args) => {
          target.addPNG(...args);
          throw new ProjectError('PROJECT_IO');
        };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const generation = new WorkspaceGeneration({
    store,
    offline: () => false,
    sendImage: async () => {
      sends++;
      return next;
    },
  });
  const plan = await generation.prepare(
    id,
    f.snapshot.revision,
    f.state.selectedSceneId,
  );
  await assert.rejects(generation.run(plan.ticket, true), {
    code: 'RESULT_SAVE_FAILED',
  });
  const image = f.core.readManifest(id).project.images.at(-1),
    file = path.join(f.folder, 'images', image.sha256 + '.png');
  fs.writeFileSync(file, Buffer.from('corrupt'));
  const reads = trace(t);
  await assert.rejects(generation.retrySave(), {
    code: 'RESULT_SAVE_FAILED',
    pendingResult: true,
  });
  assert.equal(reads.files.length, 1);
  assert.equal(generation.status().pending, true);
  fs.writeFileSync(file, next);
  reads.reset();
  const saved = await generation.retrySave();
  assert.equal(reads.files.length, 1);
  assert.equal(saved.imageId, image.id);
  assert.equal(sends, 1);
  assert.equal(generation.hasWork(), false);
  metrics.ambiguousRetry = {
    selectedPNGReads: 1,
    syntheticSends: sends,
    pendingPreservedOnCorruption: true,
  };
});
test('real worker exposes the same internal manifest/selected-image split while explicit open still refuses an unrelated broken image', async (t) => {
  const f = fixture(t, 3),
    id = f.snapshot.project.id;
  const worker = new ProjectService(
    f.profile,
    path.resolve('src/main/projects/projectWorker.ts'),
  );
  t.after(() => worker.close());
  fs.unlinkSync(f.imageFile(0));
  assert.equal((await worker.readManifest(id)).project.images.length, 3);
  assert.deepEqual(await worker.image(id, f.images[1].id), f.buffers[1]);
  await assert.rejects(worker.open(id), { code: 'PROJECT_CORRUPT' });
});
test('fresh connected scenes already default to random; fixed seed0 belongs to explicit saved input and test fixtures', () => {
  const state = createConnectedWorkspaceState();
  assert.equal(state.draft.seedMode, 'random');
  assert.ok(state.scenes.every((s) => s.draft.seedMode === 'random'));
});

test('preflight reserves exactly 32 MiB, counting hidden results without PNG reads', (t) => {
  const f = fixture(t, 8);
  const project = structuredClone(f.snapshot.project);
  project.version = 6;
  project.trashedImageIds = project.images.map((image) => image.id);
  for (const image of project.images) image.pngBytes = 28 * 1024 * 1024;
  const writeManifest = () => {
    fs.writeFileSync(path.join(f.folder, 'project.json'), JSON.stringify(project));
    return f.core.readManifest(project.id).revision;
  };
  const reads = trace(t);
  f.core.generationSnapshot(project.id, writeManifest());
  project.images[0].pngBytes += 1;
  assert.throws(() => f.core.generationSnapshot(project.id, writeManifest()), {
    code: 'PROJECT_GENERATION_SPACE',
  });
  assert.equal(reads.files.length, 0);
});
