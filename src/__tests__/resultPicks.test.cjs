const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProjectStore } = require('../main/projects/projectStore');
const { registerProjects } = require('../main/projects/projectIpc');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const {
  snapshotWorkspaceScenes,
} = require('../renderer/preview/workspaceDraft');
const { png } = require('./fixtures/nai/png.cjs');

function fixture(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-picks-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const store = new ProjectStore(profile);
  const draft = createConnectedWorkspaceState('v5');
  const scenes = snapshotWorkspaceScenes(draft);
  const content = {
    name: 'fixture',
    selectedSceneId: draft.selectedSceneId,
    scenes,
  };
  let snap = store.create(content);
  const id = snap.project.id;
  const input = {
    sceneId: draft.selectedSceneId,
    model: 'fixture',
    sampler: 'fixture',
    noiseSchedule: 'fixture',
    seed: 7,
    draft: scenes[0].draft,
  };
  for (let i = 0; i < 3; i++)
    snap = store.addPNG(id, snap.revision, input, png());
  return {
    profile,
    store,
    content,
    id,
    revision: snap.revision,
    ids: snap.project.images.map((i) => i.id),
  };
}

test('picks survive reopening and project restore; each matching result UUID stays independent', (t) => {
  const { store, profile, id, revision, ids, content } = fixture(t);
  const history = store.history(id);
  assert.deepEqual(store.resultPicks(id), []);
  store.setResultPicks(id, revision, [ids[2], ids[0]], true);
  store.setResultPicks(id, revision, [ids[0]], false);
  assert.deepEqual(store.history(id), history);
  assert.equal(store.open(id).revision, revision);
  store.trashProject(id);
  const reopened = new ProjectStore(profile);
  reopened.restoreProject(id);
  assert.deepEqual(reopened.resultPicks(id), [ids[2]]);
  const copy = reopened.copy(id, revision, content);
  assert.deepEqual(reopened.resultPicks(copy.project.id), [ids[2]]);
  reopened.setResultPicks(copy.project.id, copy.revision, [ids[2]], false);
  assert.deepEqual(reopened.resultPicks(id), [ids[2]]);
  assert.deepEqual(
    reopened.resultPicks(reopened.create(content, id).project.id),
    [],
  );
});

test('hidden picks survive restore, emptied picks are omitted, and history recovery starts a separate selection', (t) => {
  const { store, id, revision, ids } = fixture(t);
  store.setResultPicks(id, revision, ids, true);
  const hidden = store.setImageDeleted(id, revision, ids[1], true);
  assert.throws(
    () => store.setResultPicks(id, hidden.revision, [ids[1]], false),
    { code: 'PROJECT_NOT_FOUND' },
  );
  const restored = store.setImageDeleted(id, hidden.revision, ids[1], false);
  assert.deepEqual(store.resultPicks(id), ids);
  const again = store.setImageDeleted(id, restored.revision, ids[1], true);
  const emptied = store.emptyResultTrash(id, again.revision, true);
  assert.deepEqual(store.resultPicks(id), [ids[0], ids[2]]);
  assert.throws(
    () => store.setResultPicks(id, again.revision, [ids[0]], false),
    { code: 'PROJECT_CONFLICT' },
  );
  store.setResultPicks(id, emptied.snapshot.revision, [ids[0]], false);
  assert.deepEqual(store.resultPicks(store.recover(id, revision).project.id), []);
});

test('untrusted calls, invalid selection and damaged selection file preserve disk state', async (t) => {
  const { store, profile, id, ids, revision } = fixture(t);
  const handlers = new Map();
  registerProjects(
    { handle: (name, fn) => handlers.set(name, fn) },
    store,
    () => false,
  );
  assert.deepEqual(
    await handlers.get('workspace-project-set-result-picks')(
      {},
      id,
      revision,
      ids,
      true,
    ),
    { ok: false, code: 'PROJECT_UNTRUSTED' },
  );
  assert.throws(
    () => store.setResultPicks(id, revision, [ids[0], ids[0]], true),
    { code: 'PROJECT_INPUT' },
  );
  assert.throws(
    () =>
      store.setResultPicks(
        id,
        revision,
        [...ids, require('node:crypto').randomUUID()],
        true,
      ),
    { code: 'PROJECT_NOT_FOUND' },
  );
  assert.deepEqual(store.resultPicks(id), []);
  const file = path.join(profile, 'projects-v1', id, 'result-picks.v1.json');
  fs.writeFileSync(file, '{');
  assert.throws(() => store.setResultPicks(id, revision, ids, true), {
    code: 'PROJECT_CORRUPT',
  });
  assert.equal(fs.readFileSync(file, 'utf8'), '{');
  assert.equal(store.open(id).project.images.length, 3);
});
