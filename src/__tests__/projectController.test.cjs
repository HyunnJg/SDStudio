const { test } = require('node:test'),
  assert = require('node:assert/strict');
const { ProjectController } = require('../renderer/projects/projectController');
const { createWorkspaceState } = require('../renderer/preview/workspaceDraft');
function fixture(overrides = {}) {
  let workspace = createWorkspaceState(),
    tasks = false,
    calls = [];
  const snapshot = (
    content,
    id = '11111111-1111-4111-8111-111111111111',
    revision = 'a'.repeat(64),
  ) => ({
    project: {
      format: 'sdstudio-workspace',
      version: 1,
      id,
      ...structuredClone(content),
      images: [],
    },
    revision,
  });
  const client = {
    create: async (c) => {
      calls.push('create');
      return { ok: true, value: snapshot(c) };
    },
    save: async (id, r, c) => {
      calls.push('save');
      return { ok: true, value: snapshot(c, id, 'b'.repeat(64)) };
    },
    copy: async (id, r, c) => {
      calls.push('copy');
      return {
        ok: true,
        value: snapshot(c, '22222222-2222-4222-8222-222222222222'),
      };
    },
    open: async () => {
      calls.push('open');
      return {
        ok: true,
        value: snapshot({
          name: 'opened',
          selectedSceneId: workspace.selectedSceneId,
          scenes: workspace.scenes,
        }),
      };
    },
    list: async () => ({ ok: true, value: [] }),
    history: async () => ({ ok: true, value: [] }),
    recover: async () => {
      calls.push('recover');
      return {
        ok: true,
        value: snapshot({
          name: 'recovered',
          selectedSceneId: workspace.selectedSceneId,
          scenes: workspace.scenes,
        }),
      };
    },
    ...overrides,
  };
  const controller = new ProjectController({
    client,
    workspace: () => workspace,
    busy: () => tasks,
    reset: () => {
      workspace = createWorkspaceState();
    },
    apply: (s) => {
      workspace = {
        ...createWorkspaceState(),
        scenes: s.project.scenes,
        selectedSceneId: s.project.selectedSceneId,
        draft: s.project.scenes[0].draft,
      };
    },
  });
  return {
    controller,
    client,
    calls,
    edit: () => {
      workspace = {
        ...workspace,
        draft: { ...workspace.draft, prompt: 'edited' },
      };
    },
    busy: (v) => {
      tasks = v;
    },
    get workspace() {
      return workspace;
    },
  };
}
test('explicit save snapshots the authoritative editor and saving never records example images or queue state', async () => {
  const f = fixture();
  assert.equal(f.controller.dirty(), false);
  f.edit();
  assert.equal(f.controller.dirty(), true);
  await f.controller.save();
  assert.equal(f.controller.dirty(), false);
  assert.deepEqual(f.calls, ['create']);
  await f.controller.save();
  assert.deepEqual(f.calls, ['create', 'save']);
  assert.equal(f.controller.content().scenes[0].draft.prompt, 'edited');
  assert.equal('results' in f.controller.content(), false);
});
test('open/new/recover dirty guard has save/discard/cancel choices and failed save preserves both input and intent', async () => {
  const f = fixture({
    save: async () => ({ ok: false, code: 'PROJECT_CONFLICT' }),
  });
  await f.controller.save();
  f.edit();
  await f.controller.open('other');
  assert.ok(f.controller.getSnapshot().confirm);
  await f.controller.confirm('save');
  assert.equal(f.controller.getSnapshot().error, 'PROJECT_CONFLICT');
  assert.ok(f.controller.getSnapshot().confirm);
  assert.equal(f.workspace.draft.prompt, 'edited');
  await f.controller.confirm('cancel');
  assert.equal(f.controller.getSnapshot().confirm, undefined);
  assert.equal(f.calls.includes('open'), false);
  await f.controller.open('other');
  await f.controller.confirm('discard');
  assert.equal(f.controller.getSnapshot().name, 'opened');
  assert.equal(f.controller.dirty(), false);
  f.edit();
  await f.controller.newProject();
  await f.controller.confirm('cancel');
  assert.equal(f.workspace.draft.prompt, 'edited');
  await f.controller.recover('other', 'a'.repeat(64));
  await f.controller.confirm('discard');
  assert.equal(f.controller.getSnapshot().name, 'recovered');
});
test('pending/running tasks and an in-flight storage request prevent project switching and leave approval', async () => {
  let release;
  const f = fixture({
    create: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  f.busy(true);
  await f.controller.open('other');
  assert.deepEqual(f.calls, []);
  assert.equal(await f.controller.prepareLeave(), false);
  f.busy(false);
  const task = f.controller.save();
  assert.ok(f.controller.getSnapshot().operation);
  await f.controller.open('other');
  assert.equal(await f.controller.prepareLeave(), false);
  release({ ok: false, code: 'PROJECT_IO' });
  await task;
  assert.equal(f.controller.getSnapshot().operation, '');
});
test('busy/limit copy route keeps existing identity until success and input-only copy is explicit', async () => {
  const f = fixture({
    save: async () => ({ ok: false, code: 'PROJECT_BUSY' }),
  });
  await f.controller.save();
  f.edit();
  await f.controller.save();
  const original = f.controller.getSnapshot().id;
  assert.equal(f.controller.getSnapshot().error, 'PROJECT_BUSY');
  await f.controller.copy();
  assert.notEqual(f.controller.getSnapshot().id, original);
  assert.ok(f.calls.includes('copy'));
  assert.equal(f.controller.dirty(), false);
  f.edit();
  await f.controller.copy(true);
  assert.match(f.controller.getSnapshot().message, /PNG는 복사하지/);
  assert.equal(f.calls.at(-1), 'create');
});
test('close/restart waits for a decision and an edit after a captured save remains dirty', async () => {
  const f = fixture();
  f.edit();
  const leave = f.controller.prepareLeave();
  assert.ok(f.controller.getSnapshot().confirm);
  await f.controller.confirm('cancel');
  assert.equal(await leave, false);
  assert.equal(f.workspace.draft.prompt, 'edited');
  const leaveAgain = f.controller.prepareLeave();
  await f.controller.confirm('save');
  assert.equal(await leaveAgain, true);
  assert.equal(f.controller.dirty(), false);
  let release;
  const g = fixture({
    create: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  const save = g.controller.save();
  g.edit();
  release({
    ok: true,
    value: { project: { id: 'x', images: [] }, revision: 'a' },
  });
  await save;
  assert.equal(g.controller.dirty(), true);
});

test('stopped storage has specific UI guidance and manual restart preserves dirty input and failed-save intent', async () => {
  let saves = 0,
    restarts = 0;
  const f = fixture({
    save: async () => {
      saves++;
      return { ok: false, code: 'PROJECT_SERVICE_STOPPED' };
    },
    restartStorage: async () => {
      restarts++;
      return { ok: true };
    },
  });
  await f.controller.save();
  f.edit();
  const leaving = f.controller.prepareLeave();
  await f.controller.confirm('save');
  assert.equal(f.controller.getSnapshot().error, 'PROJECT_SERVICE_STOPPED');
  assert.match(f.controller.getSnapshot().message, /다시 시작/);
  assert.ok(f.controller.getSnapshot().confirm);
  await f.controller.restartStorage();
  assert.equal(restarts, 1);
  assert.equal(saves, 1);
  assert.equal(f.workspace.draft.prompt, 'edited');
  assert.equal(f.controller.dirty(), true);
  assert.ok(f.controller.getSnapshot().confirm);
  await f.controller.confirm('cancel');
  assert.equal(await leaving, false);
});

test('generated revision preserves current input and uses actual persisted content as dirty baseline; an explicit result-only new project adopts its input', async () => {
  const f = fixture();
  await f.controller.save();
  const id = f.controller.getSnapshot().id;
  const stored = f.controller.content();
  f.edit();
  f.controller.acceptGenerated({
    project: {
      ...stored,
      id,
      images: [],
      format: 'sdstudio-workspace',
      version: 1,
    },
    revision: 'c'.repeat(64),
  });
  assert.equal(f.controller.dirty(), true);
  assert.equal(f.workspace.draft.prompt, 'edited');
  const content = f.controller.content();
  f.controller.acceptGenerated(
    {
      project: {
        ...content,
        id: '22222222-2222-4222-8222-222222222222',
        images: [],
        format: 'sdstudio-workspace',
        version: 1,
      },
      revision: 'd'.repeat(64),
    },
    true,
  );
  assert.equal(f.controller.dirty(), false);
  assert.equal(f.workspace.draft.prompt, 'edited');
});

test('result metadata comes from the accepted snapshot without a second open; clearing/new input drops the old record list', async () => {
  const f = fixture();
  await f.controller.save();
  const current = f.controller.getSnapshot();
  const content = f.controller.content();
  const image = { id: '33333333-3333-4333-8333-333333333333', seed: 0 };
  const snapshot = {
    project: {
      ...content,
      id: current.id,
      images: [image],
      format: 'sdstudio-workspace',
      version: 2,
    },
    revision: 'c'.repeat(64),
  };
  f.controller.acceptGenerated(snapshot);
  assert.deepEqual(f.controller.getSnapshot().imageRecords, [image]);
  assert.equal(f.controller.dirty(), false);
  snapshot.project.images[0].seed = 99;
  assert.equal(f.controller.getSnapshot().imageRecords[0].seed, 0);
  assert.deepEqual(f.calls, ['create']);
  await f.controller.newProject();
  assert.deepEqual(f.controller.getSnapshot().imageRecords, []);
});

test('preset presentation scope changes on new input and explicit reopen, not routine saves', async () => {
  const {controller}=fixture();
  const initial=controller.getSnapshot().inputEpoch;
  assert.equal(await controller.save(),true);
  assert.equal(controller.getSnapshot().inputEpoch,initial);
  await controller.newProject();
  assert.equal(controller.getSnapshot().inputEpoch,initial+1);
  assert.equal(await controller.save(),true);
  assert.equal(controller.getSnapshot().inputEpoch,initial+1);
  await controller.open(controller.getSnapshot().id);
  assert.equal(controller.getSnapshot().inputEpoch,initial+2);
});
