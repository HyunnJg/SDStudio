const assert = require('node:assert/strict');
const { test } = require('node:test');
const { WorkspaceQueue } = require('../renderer/preview/workspaceQueue');
const {
  createWorkspaceState,
  snapshotWorkspaceScenes,
  selectWorkspaceScene,
  projectWorkspaceDraft,
} = require('../renderer/preview/workspaceDraft');

const createQueue = (options = {}) => {
  const results = [];
  const errors = [];
  const queue = new WorkspaceQueue({
    render: async () => 'example',
    onResult: (image, request, sceneName) => {
      results.push({ image, request, sceneName });
      return results.length;
    },
    onError: (error) => errors.push(error),
    seed: () => 42,
    beforeRender: async () => {},
    ...options,
  });
  return { queue, results, errors };
};
const gate = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test('scene selection saves the active editor and never shares mutable drafts', () => {
  let state = createWorkspaceState();
  assert.equal(state.draft.seedMode, 'random');
  state.draft.prompt = 'edited scene one';
  const reserved = snapshotWorkspaceScenes(state);
  state = selectWorkspaceScene(state, 'scene-2');
  assert.notEqual(state.draft.prompt, 'edited scene one');
  state.draft.prompt = 'edited scene two';
  state = selectWorkspaceScene(state, 'scene-1');
  assert.equal(state.draft.prompt, 'edited scene one');
  state.draft.prompt = 'after reservation';
  assert.equal(reserved[0].draft.prompt, 'edited scene one');
});

test('three scenes twice use reservation snapshots and record distinct resolved seeds', async () => {
  const state = createWorkspaceState();
  const scenes = snapshotWorkspaceScenes(state);
  const { queue, results, errors } = createQueue();
  queue.reserve(scenes, 2, 'success');
  scenes[0].draft.prompt = 'changed after reservation';
  await queue.start();
  assert.equal(errors.length, 0);
  assert.equal(results.length, 6);
  assert.deepEqual(
    results.map((r) => r.sceneName),
    [...state.scenes, ...state.scenes].map((s) => s.name),
  );
  assert.equal(new Set(results.map((r) => r.request.parameters.seed)).size, 6);
  assert.notEqual(results[0].request.input, 'changed after reservation');
  assert.ok(
    queue
      .getSnapshot()
      .jobs.every((job) => job.status === 'done' && job.resultId),
  );
});

test('fixed zero is preserved for every repeat without requesting random values', async () => {
  const state = createWorkspaceState();
  state.draft.seedMode = 'fixed';
  state.draft.seed = '0';
  const { queue, results } = createQueue({
    seed: () => {
      throw Error('must not use randomness');
    },
  });
  queue.reserve(snapshotWorkspaceScenes(state).slice(0, 1), 3, 'success');
  await queue.start();
  assert.deepEqual(
    results.map((r) => r.request.parameters.seed),
    [0, 0, 0],
  );
  assert.equal(projectWorkspaceDraft(state.draft).parameters.seed, 0);
});

test('stop finishes only the active example, then resume starts pending work once', async () => {
  const first = gate();
  let calls = 0;
  const { queue, results } = createQueue({
    render: async () => {
      calls++;
      if (calls === 1) await first.promise;
      return 'example';
    },
  });
  queue.reserve(snapshotWorkspaceScenes(createWorkspaceState()), 2, 'success');
  const running = queue.start();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls, 1);
  queue.stop();
  assert.throws(
    () => queue.reserve([], 1, 'success'),
    (e) => e.code === 'QUEUE_BUSY',
  );
  first.resolve();
  await running;
  assert.equal(results.length, 1);
  assert.equal(queue.getSnapshot().active, false);
  assert.equal(
    queue.getSnapshot().jobs.filter((j) => j.status === 'pending').length,
    5,
  );
  await Promise.all([queue.start(), queue.start()]);
  assert.equal(results.length, 6);
  assert.equal(calls, 6);
});

test('a failure stops scheduling, keeps prior results and pending jobs, and never auto retries', async () => {
  let calls = 0;
  const { queue, results, errors } = createQueue({
    render: async () => {
      if (++calls === 2) throw { code: 'CONNECTION' };
      return 'example';
    },
  });
  queue.reserve(snapshotWorkspaceScenes(createWorkspaceState()), 1, 'success');
  await queue.start();
  assert.equal(results.length, 1);
  assert.equal(errors.length, 1);
  assert.deepEqual(
    queue.getSnapshot().jobs.map((j) => j.status),
    ['done', 'failed', 'pending'],
  );
  await queue.start();
  assert.equal(calls, 3);
  assert.equal(results.length, 2);
});

test('invalid scene or repeat cannot replace an existing valid reservation', () => {
  const scenes = snapshotWorkspaceScenes(createWorkspaceState());
  const { queue } = createQueue();
  queue.reserve(scenes, 2, 'success');
  const before = queue.getSnapshot();
  assert.throws(
    () => queue.reserve(scenes, 11, 'success'),
    (e) => e.code === 'QUEUE_LIMIT',
  );
  scenes[2].draft.seedMode = 'fixed';
  scenes[2].draft.seed = '';
  assert.throws(
    () => queue.reserve(scenes, 1, 'success'),
    (e) => e.code === 'INVALID_NUMBER',
  );
  assert.equal(queue.getSnapshot(), before);
});

test('disposing during an active render prevents late results and next work', async () => {
  const deferred = gate();
  const { queue, results } = createQueue({ render: () => deferred.promise });
  queue.reserve(snapshotWorkspaceScenes(createWorkspaceState()), 2, 'success');
  const running = queue.start();
  await Promise.resolve();
  await Promise.resolve();
  queue.dispose();
  deferred.resolve('late example');
  await running;
  assert.equal(results.length, 0);
});
