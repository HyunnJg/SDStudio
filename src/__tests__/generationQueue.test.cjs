const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { ProjectStore } = require('../main/projects/projectStore');
const { ProjectError } = require('../workspaceProject');
const { WorkspaceGeneration } = require('../main/nai/workspaceGeneration');
const { NaiError } = require('../main/nai/errors');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const {
  snapshotWorkspaceScenes,
} = require('../renderer/preview/workspaceDraft');
const { png } = require('./fixtures/nai/png.cjs');
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture(t, options = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-batch-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const state = createConnectedWorkspaceState();
  const scenes = snapshotWorkspaceScenes(state).map((s, i) => ({
    ...s,
    name: `Scene${i + 1}`,
    draft: {
      ...s.draft,
      prompt: `synthetic landscape${i + 1}`,
      seedMode: 'random',
    },
  }));
  const core = new ProjectStore(profile),
    first = core.create({
      name: 'synthetic',
      selectedSceneId: scenes[0].id,
      scenes,
    });
  let count = 0,
    online = true,
    inflight = 0,
    peak = 0;
  const bodies = [],
    bytes = Uint8Array.from(png());
  const service = new WorkspaceGeneration({
    store: options.store?.(core) ?? core,
    offline: () => !online,
    sendImage: async (body, signal) => {
      count++;
      const number = count;
      bodies.push(Uint8Array.from(body));
      inflight++;
      peak = Math.max(peak, inflight);
      try {
        return options.send
          ? await options.send({
              body: JSON.parse(Buffer.from(body)),
              signal,
              number,
              core,
              first,
              bytes,
            })
          : bytes;
      } finally {
        inflight--;
      }
    },
  });
  return {
    profile,
    scenes,
    core,
    first,
    service,
    bytes,
    bodies,
    offline: () => (online = false),
    prepare: (repeats = 2, ids = scenes.map((s) => s.id)) =>
      service.prepareQueue(first.project.id, first.revision, ids, repeats),
    get count() {
      return count;
    },
    get peak() {
      return peak;
    },
  };
}
function proxy(core, methods) {
  return new Proxy(core, {
    get(target, key) {
      const value = methods[key] ?? target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
test('3 scenes x2 reserve zero sends, freeze seeds/hash/input, run repetition-first serially and preserve all6 PNG records', async (t) => {
  t.mock.method(crypto, 'randomInt', () => 42);
  const f = fixture(t, {
    send: async ({ bytes }) => {
      await new Promise((r) => setImmediate(r));
      return bytes;
    },
  });
  const plan = await f.prepare(),
    expected = structuredClone(plan);
  assert.equal(plan.total, 6);
  assert.equal(f.count, 0);
  assert.deepEqual(
    plan.items.map((i) => i.sceneName),
    ['Scene1', 'Scene2', 'Scene3', 'Scene1', 'Scene2', 'Scene3'],
  );
  assert.deepEqual(
    plan.items.map((i) => i.seed),
    [42, 43, 44, 45, 46, 47],
  );
  plan.items[0].seed = 999;
  plan.items[0].sceneName = 'changed renderer copy';
  const result = await f.service.runQueue(plan.ticket, true);
  assert.equal(f.count, 6);
  assert.equal(f.peak, 1);
  assert.equal(f.service.hasWork(), false);
  const saved = f.core.open(f.first.project.id);
  assert.equal(saved.project.images.length, 6);
  assert.deepEqual(saved.project.scenes, f.scenes);
  saved.project.images.forEach((image, i) => {
    assert.equal(image.seed, expected.items[i].seed);
    assert.equal(image.sceneId, expected.items[i].sceneId);
    assert.equal(
      image.binding.requestHash,
      crypto.createHash('sha256').update(f.bodies[i]).digest('hex'),
    );
    assert.deepEqual(f.core.image(saved.project.id, image.id), f.bytes);
  });
  assert.ok(result.queue.items.every((i) => i.status === 'done'));
  assert.equal(
    f.service.queueStatus().latest,
    undefined,
    'completed snapshots are not replayed by later status polls',
  );
  await assert.rejects(f.service.runQueue(plan.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
});
test('invalid selection/count/unverified scene fail before sending and do not replace an existing queue', async (t) => {
  const f = fixture(t),
    p = await f.prepare();
  for (const [ids, repeats, code] of [
    [[], 1, 'INVALID_INPUT'],
    [[f.scenes[0].id, f.scenes[0].id], 1, 'INVALID_INPUT'],
    [[crypto.randomUUID()], 1, 'INVALID_INPUT'],
    [f.scenes.map((s) => s.id), 0, 'INVALID_INPUT'],
    [f.scenes.map((s) => s.id), 21, 'QUEUE_LIMIT'],
    [[f.scenes[0].id], 1.5, 'INVALID_INPUT'],
  ])
    await assert.rejects(
      f.service.prepareQueue(
        f.first.project.id,
        f.first.revision,
        ids,
        repeats,
      ),
      { code },
    );
  assert.equal(f.service.queueStatus().queue.id, p.queueId);
  assert.equal(f.count, 0);
  const content = {
    name: f.first.project.name,
    selectedSceneId: f.first.project.selectedSceneId,
    scenes: structuredClone(f.scenes),
  };
  content.scenes[2].draft.family = 'v5';
  const next = f.core.save(f.first.project.id, f.first.revision, content);
  await assert.rejects(
    f.service.prepareQueue(
      next.project.id,
      next.revision,
      f.scenes.map((s) => s.id),
      1,
    ),
    { code: 'UNSUPPORTED_DRAFT' },
  );
  assert.equal(f.count, 0);
  assert.equal(f.service.queueStatus().queue.id, p.queueId);
});
test('confirmation is5-minute/single-use and unconfirmed or changed saved revision never sends', async (t) => {
  const f = fixture(t),
    p = await f.prepare();
  await assert.rejects(f.service.runQueue(p.ticket, false), {
    code: 'CONFIRMATION_EXPIRED',
  });
  const now = Date.now();
  const clock = t.mock.method(Date, 'now', () => now + 300001);
  await assert.rejects(f.service.runQueue(p.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  clock.mock.restore();
  const n = await f.prepare();
  f.core.save(f.first.project.id, f.first.revision, {
    name: 'external edit',
    selectedSceneId: f.first.project.selectedSceneId,
    scenes: f.first.project.scenes,
  });
  const result = await f.service.runQueue(n.ticket, true);
  assert.equal(result.queue.items[0].error.code, 'PROJECT_CONFLICT');
  assert.equal(f.count, 0);
  await assert.rejects(f.service.runQueue(n.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
});
test('stop during metadata preflight sends nothing; pending items require a new confirmation before continuation', async (t) => {
  const entered = deferred(),
    release = deferred();
  let blocked = true;
  const f = fixture(t, {
    store: (core) =>
      proxy(core, {
        readManifest: async (id) => {
          if (blocked) {
            blocked = false;
            entered.resolve();
            await release.promise;
          }
          return core.readManifest(id);
        },
      }),
  });
  const p = await f.prepare(1),
    run = f.service.runQueue(p.ticket, true);
  await entered.promise;
  f.service.cancel();
  release.resolve();
  const stopped = await run;
  assert.equal(f.count, 0);
  assert.ok(stopped.queue.items.every((i) => i.status === 'pending'));
  assert.equal(f.service.hasWork(), false);
  await assert.rejects(f.service.runQueue(p.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  const resume = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    f.first.revision,
  );
  assert.equal(resume.total, 3);
  assert.equal(f.count, 0);
  await f.service.runQueue(resume.ticket, true);
  assert.equal(f.count, 3);
});
test('in-flight stop aborts exactly one request, never retries it, and fresh continuation includes only untransmitted tasks', async (t) => {
  const started = deferred();
  const f = fixture(t, {
    send: async ({ signal, number, bytes }) => {
      if (number !== 1) return bytes;
      started.resolve();
      return new Promise((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new NaiError('CANCELLED', true)),
          { once: true },
        ),
      );
    },
  });
  const p = await f.prepare(1),
    run = f.service.runQueue(p.ticket, true);
  await started.promise;
  assert.equal(f.service.hasWork(), true);
  await assert.rejects(f.prepare(), { code: 'GENERATION_BUSY' });
  assert.throws(() => f.service.clearQueue(), { code: 'GENERATION_BUSY' });
  f.service.cancel();
  const result = await run;
  assert.equal(f.count, 1);
  assert.equal(result.queue.items[0].status, 'failed');
  assert.equal(result.queue.items[0].error.mayHaveReachedServer, true);
  const resume = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    f.first.revision,
  );
  assert.equal(resume.total, 2);
  assert.ok(resume.items.every((i) => i.id !== p.items[0].id));
  await f.service.runQueue(resume.ticket, true);
  assert.equal(f.count, 3);
});
test('429 stops at the failed task, keeps earlier saved PNG and later untransmitted work, and never retries automatically', async (t) => {
  const f = fixture(t, {
      send: async ({ number, bytes }) => {
        if (number === 2) throw new NaiError('HTTP_ERROR', true, 429);
        return bytes;
      },
    }),
    p = await f.prepare();
  const result = await f.service.runQueue(p.ticket, true);
  assert.equal(f.count, 2);
  assert.deepEqual(
    result.queue.items.map((i) => i.status),
    ['done', 'failed', 'pending', 'pending', 'pending', 'pending'],
  );
  assert.equal(result.queue.items[1].error.httpStatus, 429);
  assert.equal(f.core.open(f.first.project.id).project.images.length, 1);
  const next = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    result.latest.snapshot.revision,
  );
  assert.equal(next.total, 4);
  assert.equal(f.count, 2);
});
test('PNG storage failure stops the batch; save-only retry completes that task without sending; continuation still needs confirmation', async (t) => {
  let fail = true;
  const f = fixture(t, {
      store: (core) =>
        proxy(core, {
          addPNG: (...args) => {
            if (fail) {
              fail = false;
              throw new ProjectError('PROJECT_IO');
            }
            return core.addPNG(...args);
          },
        }),
    }),
    p = await f.prepare(1);
  const result = await f.service.runQueue(p.ticket, true);
  assert.equal(f.count, 1);
  assert.equal(result.queue.items[0].status, 'result-pending');
  assert.equal(f.service.hasWork(), true);
  await assert.rejects(
    f.service.prepareRemaining(p.queueId, f.first.project.id, f.first.revision),
    { code: 'GENERATION_BUSY' },
  );
  const saved = await f.service.retrySave();
  assert.equal(f.count, 1);
  assert.equal(f.service.hasWork(), false);
  assert.equal(f.service.queueStatus().queue.items[0].status, 'done');
  const next = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    saved.snapshot.revision,
  );
  assert.equal(next.total, 2);
  await f.service.runQueue(next.ticket, true);
  assert.equal(f.count, 3);
  assert.equal(f.core.open(f.first.project.id).project.images.length, 3);
});
test('ambiguous committed PNG remains pending on corruption and is marked done exactly once only after selected-file validation', async (t) => {
  let ambiguous = true;
  const f = fixture(t, {
      store: (core) =>
        proxy(core, {
          addPNG: (...args) => {
            const saved = core.addPNG(...args);
            if (ambiguous) {
              ambiguous = false;
              throw new ProjectError('PROJECT_IO');
            }
            return saved;
          },
        }),
    }),
    p = await f.prepare(1);
  await f.service.runQueue(p.ticket, true);
  const saved = f.core.open(f.first.project.id),
    image = saved.project.images[0];
  const file = path.join(
    f.profile,
    'projects-v1',
    saved.project.id,
    'images',
    image.sha256 + '.png',
  );
  fs.writeFileSync(file, 'corrupt');
  await assert.rejects(f.service.retrySave(), { code: 'RESULT_SAVE_FAILED' });
  assert.equal(f.service.status().pending, true);
  fs.writeFileSync(file, f.bytes);
  const recovered = await f.service.retrySave();
  assert.equal(recovered.imageId, image.id);
  assert.equal(recovered.snapshot.project.images.length, 1);
  assert.equal(f.count, 1);
  assert.equal(f.service.queueStatus().queue.items[0].imageId, image.id);
});
test('input changed while a response is in flight is preserved by latest-revision append, then the next request stops before sending', async (t) => {
  let edited;
  const f = fixture(t, {
      send: async ({ core, first, bytes }) => {
        const content = {
          name: 'externally edited',
          selectedSceneId: first.project.selectedSceneId,
          scenes: structuredClone(first.project.scenes),
        };
        content.scenes[0].draft.prompt = 'new saved input';
        edited = core.save(first.project.id, first.revision, content);
        return bytes;
      },
    }),
    p = await f.prepare(1);
  const result = await f.service.runQueue(p.ticket, true),
    saved = f.core.open(f.first.project.id);
  assert.equal(f.count, 1);
  assert.equal(saved.project.name, edited.project.name);
  assert.equal(saved.project.scenes[0].draft.prompt, 'new saved input');
  assert.equal(saved.project.images[0].draft.prompt, f.scenes[0].draft.prompt);
  assert.equal(result.queue.items[1].error.code, 'PROJECT_CONFLICT');
  await assert.rejects(
    f.service.prepareRemaining(p.queueId, saved.project.id, saved.revision),
    { code: 'PROJECT_CONFLICT' },
  );
});
test('a race between latest manifest read and atomic append leaves the received PNG pending and never overwrites newer input', async (t) => {
  let once = true;
  const f = fixture(t, {
      store: (core) =>
        proxy(core, {
          addPNG: (id, rev, ...rest) => {
            if (once) {
              once = false;
              const before = core.readManifest(id);
              core.save(id, before.revision, {
                name: 'racing writer',
                selectedSceneId: before.project.selectedSceneId,
                scenes: before.project.scenes,
              });
            }
            return core.addPNG(id, rev, ...rest);
          },
        }),
    }),
    p = await f.prepare(1);
  const result = await f.service.runQueue(p.ticket, true);
  assert.equal(result.queue.items[0].error.projectCode, 'PROJECT_CONFLICT');
  assert.equal(f.count, 1);
  const saved = await f.service.retrySave();
  assert.equal(saved.snapshot.project.name, 'racing writer');
  assert.equal(f.count, 1);
});
test('cancel after valid PNG receipt waits for its storage and starts no next request', async (t) => {
  const entered = deferred(),
    release = deferred();
  const f = fixture(t, {
      store: (core) =>
        proxy(core, {
          addPNG: async (...args) => {
            entered.resolve();
            await release.promise;
            return core.addPNG(...args);
          },
        }),
    }),
    p = await f.prepare(1),
    run = f.service.runQueue(p.ticket, true);
  await entered.promise;
  f.service.cancel();
  assert.equal(f.service.hasWork(), true);
  release.resolve();
  const result = await run;
  assert.equal(f.count, 1);
  assert.equal(result.queue.items[0].status, 'done');
  assert.equal(result.queue.items[1].status, 'pending');
  assert.equal(f.service.hasWork(), false);
});
test('queue metadata and errors expose only fixed failure fields, cloned state cannot alter execution, clear removes no project image', async (t) => {
  const f = fixture(t, {
      send: async () => {
        throw Error('raw-server-token/private/path');
      },
    }),
    p = await f.prepare(1);
  const result = await f.service.runQueue(p.ticket, true);
  assert.equal(result.queue.items[0].error.code, 'NETWORK');
  assert.ok(!JSON.stringify(result).includes('raw-server'));
  const copy = f.service.queueStatus();
  copy.queue.items[1].status = 'done';
  assert.equal(f.service.queueStatus().queue.items[1].status, 'pending');
  f.service.clearQueue();
  assert.deepEqual(f.service.queueStatus(), {});
  assert.equal(f.core.open(f.first.project.id).project.images.length, 0);
});
test('offline checks occur before all queue filesystem/transport access and local status stays available', async (t) => {
  const f = fixture(t);
  f.offline();
  await assert.rejects(f.service.prepareQueue('../private', 'invalid', [], 2), {
    code: 'OFFLINE',
  });
  await assert.rejects(
    f.service.prepareRemaining('../private', 'invalid', 'invalid'),
    { code: 'OFFLINE' },
  );
  await assert.rejects(f.service.runQueue('invalid', true), {
    code: 'OFFLINE',
  });
  assert.deepEqual(f.service.queueStatus(), {});
  assert.equal(f.count, 0);
});
test('selected subset follows saved scene order, preserves fixed0 repeats, and does not validate or transmit unselected V5 input', async (t) => {
  const f = fixture(t),
    content = {
      name: f.first.project.name,
      selectedSceneId: f.first.project.selectedSceneId,
      scenes: structuredClone(f.scenes),
    };
  content.scenes[0].draft.seedMode = 'fixed';
  content.scenes[0].draft.seed = '0';
  content.scenes[2].draft.family = 'v5';
  const saved = f.core.save(f.first.project.id, f.first.revision, content);
  const p = await f.service.prepareQueue(
    saved.project.id,
    saved.revision,
    [f.scenes[1].id, f.scenes[0].id],
    2,
  );
  assert.deepEqual(
    p.items.map((i) => i.sceneName),
    ['Scene1', 'Scene2', 'Scene1', 'Scene2'],
  );
  assert.equal(p.items[0].seed, 0);
  assert.equal(p.items[2].seed, 0);
  await f.service.runQueue(p.ticket, true);
  assert.equal(f.count, 4);
  f.service.clearQueue();
  assert.equal(f.core.open(saved.project.id).project.images.length, 4);
});
test('total reservation count cannot exceed the remaining120-image metadata capacity', async (t) => {
  const f = fixture(t),
    initial = await f.service.prepare(
      f.first.project.id,
      f.first.revision,
      f.scenes[0].id,
    );
  const generated = await f.service.run(initial.ticket, true),
    manifest = structuredClone(generated.snapshot.project);
  manifest.images = Array.from({ length: 119 }, () => ({
    ...manifest.images[0],
    id: crypto.randomUUID(),
  }));
  fs.writeFileSync(
    path.join(f.profile, 'projects-v1', manifest.id, 'project.json'),
    JSON.stringify(manifest),
  );
  const current = f.core.readManifest(manifest.id);
  await assert.rejects(
    f.service.prepareQueue(manifest.id, current.revision, [f.scenes[0].id], 2),
    { code: 'QUEUE_LIMIT' },
  );
  assert.equal(f.count, 1);
});
test('stop during execute final preflight restores the untransmitted task rather than issuing one extra request', async (t) => {
  let reads = 0;
  const entered = deferred(),
    release = deferred();
  const f = fixture(t, {
    store: (core) =>
      proxy(core, {
        generationSnapshot: async (...args) => {
          reads++;
          if (reads === 3) {
            entered.resolve();
            await release.promise;
          }
          return core.generationSnapshot(...args);
        },
      }),
  });
  const p = await f.prepare(1),
    running = f.service.runQueue(p.ticket, true);
  await entered.promise;
  f.service.cancel();
  release.resolve();
  const result = await running;
  assert.equal(f.count, 0);
  assert.ok(result.queue.items.every((i) => i.status === 'pending'));
});
test('pending result saved as a new project leaves the original lock untouched and cannot resume the old queue into the new project', async (t) => {
  let blocked = true;
  const f = fixture(t, {
    store: (core) =>
      proxy(core, {
        addPNG: (...args) => {
          if (blocked) {
            blocked = false;
            fs.writeFileSync(
              path.join(
                f.profile,
                'projects-v1',
                f.first.project.id,
                'write.lock',
              ),
              'test lock',
            );
          }
          return core.addPNG(...args);
        },
      }),
  });
  const p = await f.prepare(1);
  await f.service.runQueue(p.ticket, true);
  assert.equal(f.service.status().pending, true);
  const recovered = await f.service.retrySave(true);
  assert.notEqual(recovered.snapshot.project.id, f.first.project.id);
  assert.equal(recovered.snapshot.project.images.length, 1);
  assert.equal(f.service.queueStatus().queue, undefined);
  assert.equal(f.count, 1);
  assert.equal(
    fs.readFileSync(
      path.join(f.profile, 'projects-v1', f.first.project.id, 'write.lock'),
      'utf8',
    ),
    'test lock',
  );
  await assert.rejects(
    f.service.prepareRemaining(
      p.queueId,
      recovered.snapshot.project.id,
      recovered.snapshot.revision,
    ),
    { code: 'INVALID_INPUT' },
  );
  f.service.clearQueue();
  assert.equal(
    f.core.open(recovered.snapshot.project.id).project.images.length,
    1,
  );
});
