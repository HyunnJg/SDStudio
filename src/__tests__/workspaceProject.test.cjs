const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { createHash } = require('node:crypto');
const { ProjectStore } = require('../main/projects/projectStore');
const { registerProjects } = require('../main/projects/projectIpc');
const {
  createWorkspaceState,
  snapshotWorkspaceScenes,
} = require('../renderer/preview/workspaceDraft');
const { validateProjectContent } = require('../workspaceProject');
const { png } = require('./fixtures/nai/png.cjs');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-project-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const store = new ProjectStore(profile);
  const state = createWorkspaceState();
  state.draft.prompt = 'unfinished editor | text';
  state.draft.seedMode = 'fixed';
  state.draft.seed = '0';
  const content = {
    name: '합성 프로젝트',
    selectedSceneId: state.selectedSceneId,
    scenes: snapshotWorkspaceScenes(state),
  };
  const file = (id) => path.join(profile, 'projects-v1', id, 'project.json');
  return { profile, store, content, file };
}
const code = (value) => ({ code: value });
const imageInput = (content) => ({
  sceneId: content.selectedSceneId,
  model: 'fixture-model-not-for-api',
  sampler: 'fixture-sampler',
  noiseSchedule: 'fixture-noise-schedule',
  seed: 0,
  draft: content.scenes[0].draft,
});

test('empty list creates no folder; three scenes preserve unfinished input, ordering, seed 0 and grid cells across reopening', (t) => {
  const f = fixture(t);
  assert.deepEqual(f.store.list(), []);
  assert.deepEqual(fs.readdirSync(f.profile), []);
  const created = f.store.create(f.content);
  f.content.scenes[0].draft.prompt = 'later mutation';
  const reopened = new ProjectStore(f.profile).open(created.project.id);
  assert.deepEqual(reopened, created);
  assert.equal(reopened.project.scenes[0].draft.seed, '0');
  assert.equal(reopened.project.scenes.length, 3);
  assert.equal(
    reopened.project.scenes[0].draft.prompt,
    'unfinished editor | text',
  );
  assert.deepEqual(f.store.list(), [
    {
      id: created.project.id,
      name: created.project.name,
      revision: created.revision,
    },
  ]);
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(f.file(created.project.id)).mode & 0o777, 0o600);
});
test('same-version saves preserve immutable history and stale revisions cannot overwrite newer edits', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  const changed = { ...f.content, name: 'changed' };
  const second = f.store.save(id, first.revision, changed);
  assert.notEqual(second.revision, first.revision);
  assert.deepEqual(f.store.history(id), [first.revision]);
  assert.throws(
    () => f.store.save(id, first.revision, f.content),
    code('PROJECT_CONFLICT'),
  );
  assert.deepEqual(f.store.open(id), second);
  const history = path.join(
    f.profile,
    'projects-v1',
    id,
    'history',
    first.revision + '.json',
  );
  assert.equal(digest(fs.readFileSync(history)), first.revision);
});
test('rename failure leaves current bytes and history recoverable and releases the writer lock', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  const before = fs.readFileSync(f.file(id));
  const rename = t.mock.method(fs, 'renameSync', () => {
    throw Error('synthetic private OS path');
  });
  assert.throws(
    () => f.store.save(id, first.revision, { ...f.content, name: 'fail' }),
    { code: 'PROJECT_IO', message: 'PROJECT_IO' },
  );
  rename.mock.restore();
  assert.deepEqual(fs.readFileSync(f.file(id)), before);
  assert.deepEqual(f.store.history(id), [first.revision]);
  assert.equal(
    fs.existsSync(path.join(path.dirname(f.file(id)), 'write.lock')),
    false,
  );
  assert.equal(
    fs
      .readdirSync(path.dirname(f.file(id)))
      .some((x) => x.startsWith('.next-')),
    false,
  );
  assert.equal(f.store.save(id, first.revision, f.content).project.id, id);
});
test('corrupt or future-version manifests survive open/save and explicit history recovery creates a new independent project', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  f.store.save(id, first.revision, { ...f.content, name: 'second' });
  for (const bytes of [
    Buffer.from('{broken'),
    Buffer.from(
      JSON.stringify({ ...first.project, version: 99, extra: 'future data' }),
    ),
  ]) {
    fs.writeFileSync(f.file(id), bytes);
    const expected =
      bytes[0] === 123 && bytes.toString().includes('version')
        ? 'PROJECT_VERSION'
        : 'PROJECT_CORRUPT';
    assert.throws(() => f.store.open(id), code(expected));
    assert.throws(
      () => f.store.save(id, first.revision, f.content),
      code(expected),
    );
    const recovered = f.store.recover(id, first.revision);
    assert.notEqual(recovered.project.id, id);
    assert.equal(recovered.project.name, first.project.name);
    assert.deepEqual(fs.readFileSync(f.file(id)), bytes);
  }
});
test('PNG metadata/alpha bytes, explicit model and resolved seed are preserved through add/read/save/recovery', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id,
    original = png();
  const result = f.store.addPNG(
    id,
    first.revision,
    imageInput(f.content),
    original,
  );
  const image = result.project.images[0];
  assert.equal(image.seed, 0);
  assert.equal(image.model, 'fixture-model-not-for-api');
  assert.deepEqual(Buffer.from(f.store.readPNG(id, image.sha256)), original);
  original.fill(0);
  assert.equal(digest(f.store.readPNG(id, image.sha256)), image.sha256);
  const after = f.store.save(id, result.revision, {
    ...f.content,
    name: 'renamed',
  });
  assert.deepEqual(after.project.images, result.project.images);
  const copied = f.store.copy(id, after.revision, {
    ...f.content,
    name: 'PNG copy',
  });
  assert.notEqual(copied.project.id, id);
  assert.deepEqual(
    Buffer.from(f.store.readPNG(copied.project.id, image.sha256)),
    png(),
  );
  const recovered = f.store.recover(id, result.revision);
  assert.deepEqual(
    Buffer.from(f.store.readPNG(recovered.project.id, image.sha256)),
    png(),
  );
  assert.equal(recovered.project.images[0].draft.characters.length, 2);
});
test('corrupt/missing PNG and fake PNG cannot become a valid project or successful recovery', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  assert.throws(
    () =>
      f.store.addPNG(
        id,
        first.revision,
        imageInput(f.content),
        Buffer.from('fake PNG'),
      ),
    code('PROJECT_CORRUPT'),
  );
  assert.equal(f.store.open(id).project.images.length, 0);
  const next = f.store.addPNG(id, first.revision, imageInput(f.content), png());
  const image = next.project.images[0],
    file = path.join(path.dirname(f.file(id)), 'images', image.sha256 + '.png');
  fs.writeFileSync(file, Buffer.from('corrupted'));
  assert.throws(() => f.store.open(id), code('PROJECT_CORRUPT'));
  fs.unlinkSync(file);
  assert.throws(() => f.store.open(id), code('PROJECT_CORRUPT'));
});
test('strict schema rejects credential/unknown fields, duplicate IDs, traversal, invalid cells and oversized JSON without changing current data', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  const before = fs.readFileSync(f.file(id));
  for (const change of [
    (p) => (p.token = 'synthetic-secret'),
    (p) => (p.scenes[0].draft.token = 'synthetic-secret'),
    (p) => (p.scenes[1].id = p.scenes[0].id),
    (p) =>
      (p.scenes[0].draft.characters[1].id = p.scenes[0].draft.characters[0].id),
    (p) => (p.selectedSceneId = '../other'),
    (p) => (p.scenes[0].draft.characters[0].cell.row = 5),
    (p) => (p.scenes[0].draft.seed = 'x'.repeat(65)),
  ]) {
    const invalid = structuredClone(f.content);
    change(invalid);
    assert.throws(
      () => f.store.save(id, first.revision, invalid),
      code('PROJECT_INPUT'),
    );
  }
  for (const bad of ['../other', 'C:\\private', '/tmp/private'])
    assert.throws(() => f.store.open(bad), code('PROJECT_INPUT'));
  const huge = structuredClone(f.content);
  for (const s of huge.scenes) {
    s.draft.characters = Array.from({ length: 32 }, (_, i) => ({
      ...s.draft.characters[0],
      id: 'c' + i,
      prompt: 'x'.repeat(65536),
    }));
  }
  assert.throws(() => f.store.create(huge), code('PROJECT_LIMIT'));
  assert.deepEqual(fs.readFileSync(f.file(id)), before);
});
test('profile/project/manifest/image/history symlinks are refused and a leftover writer lock is never automatically removed', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id,
    folder = path.dirname(f.file(id));
  const lock = path.join(folder, 'write.lock');
  fs.writeFileSync(lock, 'synthetic incomplete writer');
  assert.throws(
    () => f.store.save(id, first.revision, f.content),
    code('PROJECT_BUSY'),
  );
  assert.equal(fs.readFileSync(lock, 'utf8'), 'synthetic incomplete writer');
  fs.unlinkSync(lock);
  if (process.platform === 'win32') return; // Linux symlink exercise; Windows junctions remain unverified.
  for (const name of ['project.json', 'history', 'images']) {
    const target = path.join(folder, name),
      original = target + '.original';
    fs.renameSync(target, original);
    fs.symlinkSync(original, target);
    const operation =
      name === 'project.json'
        ? () => f.store.open(id)
        : name === 'history'
          ? () => f.store.history(id)
          : () =>
              f.store.addPNG(id, first.revision, imageInput(f.content), png());
    assert.throws(operation, code('PROJECT_CORRUPT'));
    fs.unlinkSync(target);
    fs.renameSync(original, target);
  }
  const alias = f.profile + '-link';
  fs.symlinkSync(f.profile, alias);
  t.after(() => fs.unlinkSync(alias));
  assert.throws(() => new ProjectStore(alias).list(), code('PROJECT_CORRUPT'));
});
test('offline local IPC checks trust before storage and returns fixed codes without paths or raw exceptions', async (t) => {
  const f = fixture(t),
    handlers = new Map();
  let trusted = false;
  registerProjects(
    { handle: (channel, action) => handlers.set(channel, action) },
    f.store,
    () => trusted,
  );
  for (const handler of handlers.values())
    assert.deepEqual(await handler({}), {
      ok: false,
      code: 'PROJECT_UNTRUSTED',
    });
  assert.deepEqual(fs.readdirSync(f.profile), []);
  trusted = true;
  const created = await handlers.get('workspace-project-create')({}, f.content);
  assert.equal(created.ok, true);
  const id = created.value.project.id;
  assert.equal((await handlers.get('workspace-project-open')({}, id)).ok, true);
  assert.deepEqual(
    await handlers.get('workspace-project-open')({}, '../../synthetic-private'),
    { ok: false, code: 'PROJECT_INPUT' },
  );
  assert.equal(handlers.size, 15);
  assert.ok(handlers.has('workspace-project-empty-result-trash'));
  assert.equal(handlers.has('workspace-project-import-png'), false);
});
test('V3 fixture files/config/TOKEN remain byte-identical and cannot be silently adopted as a modern project', (t) => {
  const f = fixture(t);
  const legacy = {
    version: 1,
    name: 'legacy fixture',
    presets: {
      SDImageGen: [
        {
          type: 'SDImageGen',
          model: 'nai-diffusion-3',
          seed: 0,
          prompt: '<모음.조각>',
          vibes: [{ path: 'synthetic-vibe.png', info: 1, strength: 0.5 }],
        },
      ],
    },
    scenes: { one: { slots: [['synthetic']] } },
    inpaints: {
      paint: {
        type: 'inpaint',
        image: 'synthetic.png',
        mask: 'synthetic-mask.png',
      },
    },
    library: {},
    presetShareds: {},
  };
  const files = {
    'legacy-session.json': JSON.stringify(legacy),
    'TOKEN.txt': 'synthetic-only-token',
    'config.json': '{"saveLocation":"synthetic-only"}',
  };
  for (const [name, value] of Object.entries(files))
    fs.writeFileSync(path.join(f.profile, name), value);
  const hashes = Object.fromEntries(
    Object.keys(files).map((name) => [
      name,
      digest(fs.readFileSync(path.join(f.profile, name))),
    ]),
  );
  assert.throws(() => validateProjectContent(legacy), code('PROJECT_INPUT'));
  const first = f.store.create(f.content);
  f.store.save(first.project.id, first.revision, {
    ...f.content,
    name: 'changed',
  });
  f.store.recover(first.project.id, first.revision);
  for (const name of Object.keys(files))
    assert.equal(
      digest(fs.readFileSync(path.join(f.profile, name))),
      hashes[name],
    );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(f.profile, 'legacy-session.json'))),
    legacy,
  );
});

test('tampered history is refused before copying and missing result bytes cannot be repaired by a manifest alone', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  const image = f.store.addPNG(
    id,
    first.revision,
    imageInput(f.content),
    png(),
  );
  f.store.save(id, image.revision, { ...f.content, name: 'after image' });
  const history = path.join(
    path.dirname(f.file(id)),
    'history',
    first.revision + '.json',
  );
  const source = fs.readFileSync(f.file(id));
  fs.writeFileSync(
    history,
    JSON.stringify({ ...first.project, name: 'tampered' }),
  );
  const count = f.store.list().length;
  assert.throws(
    () => f.store.recover(id, first.revision),
    code('PROJECT_CORRUPT'),
  );
  assert.equal(f.store.list().length, count);
  assert.deepEqual(fs.readFileSync(f.file(id)), source);
  fs.unlinkSync(
    path.join(
      path.dirname(f.file(id)),
      'images',
      image.project.images[0].sha256 + '.png',
    ),
  );
  assert.throws(
    () => f.store.recover(id, image.revision),
    code('PROJECT_CORRUPT'),
  );
});
test('project version is separate from V3, malformed version and CRC-corrupt PNG are rejected', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  const current = fs.readFileSync(f.file(id));
  fs.writeFileSync(
    f.file(id),
    JSON.stringify({ ...first.project, version: '1' }),
  );
  assert.throws(() => f.store.open(id), code('PROJECT_CORRUPT'));
  fs.writeFileSync(f.file(id), current);
  const corrupt = png();
  corrupt[33] ^= 1;
  assert.throws(
    () => f.store.addPNG(id, first.revision, imageInput(f.content), corrupt),
    code('PROJECT_CORRUPT'),
  );
  assert.deepEqual(fs.readFileSync(f.file(id)), current);
  const incomplete = structuredClone(f.content);
  incomplete.scenes[0].draft.seed = '';
  incomplete.scenes[0].draft.steps = '';
  assert.equal(
    f.store.save(id, first.revision, incomplete).project.scenes[0].draft.seed,
    '',
  );
});

test('empty and oversized manifests remain untouched and do not trigger automatic fallback or repair', (t) => {
  const f = fixture(t),
    first = f.store.create(f.content),
    id = first.project.id;
  const invalidUtf8 = Buffer.from(JSON.stringify(first.project));
  invalidUtf8[invalidUtf8.indexOf(Buffer.from('합성'))] = 255;
  for (const [bytes, expected] of [
    [invalidUtf8, 'PROJECT_CORRUPT'],
    [Buffer.alloc(0), 'PROJECT_CORRUPT'],
    [Buffer.alloc(2 * 1024 * 1024 + 1, 32), 'PROJECT_LIMIT'],
  ]) {
    fs.writeFileSync(f.file(id), bytes);
    assert.throws(() => f.store.open(id), code(expected));
    assert.throws(
      () => f.store.save(id, first.revision, f.content),
      code(expected),
    );
    assert.deepEqual(fs.readFileSync(f.file(id)), bytes);
  }
});
