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
test('confirmation is5-minute/single-use and unconfirmed or changed queued input never sends', async (t) => {
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
    scenes: f.scenes.map((scene, index) =>
      index === 0
        ? {
            ...scene,
            draft: { ...scene.draft, prompt: 'changed queued prompt' },
          }
        : scene,
    ),
  });
  const result = await f.service.runQueue(n.ticket, true);
  assert.equal(result.queue.items[0].error.code, 'QUEUE_INPUT_CHANGED');
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
      send: async ({ core, first, bytes, number }) => {
        if (number > 1) return bytes;
        const content = {
          name: 'externally edited',
          selectedSceneId: first.project.selectedSceneId,
          scenes: structuredClone(first.project.scenes),
        };
        content.scenes[1].draft.prompt = 'new saved input';
        edited = core.save(first.project.id, first.revision, content);
        return bytes;
      },
    }),
    p = await f.prepare(1);
  const result = await f.service.runQueue(p.ticket, true),
    saved = f.core.open(f.first.project.id);
  assert.equal(f.count, 1);
  assert.equal(saved.project.name, edited.project.name);
  assert.equal(saved.project.scenes[1].draft.prompt, 'new saved input');
  assert.equal(saved.project.images[0].draft.prompt, f.scenes[0].draft.prompt);
  assert.equal(result.queue.items[1].error.code, 'QUEUE_INPUT_CHANGED');
  assert.equal(result.queue.items[1].status, 'pending');
  assert.equal(result.queue.items[1].error.conflictSceneId, f.scenes[1].id);
  await assert.rejects(
    f.service.prepareRemaining(p.queueId, saved.project.id, saved.revision),
    { code: 'QUEUE_INPUT_CHANGED' },
  );
  const restored = f.core.save(saved.project.id, saved.revision, {
    name: saved.project.name,
    selectedSceneId: saved.project.selectedSceneId,
    scenes: f.scenes,
  });
  const remaining = await f.service.prepareRemaining(
    p.queueId,
    restored.project.id,
    restored.revision,
  );
  assert.equal(remaining.total, 2);
  assert.equal(remaining.items[0].id, p.items[1].id);
  await f.service.runQueue(remaining.ticket, true);
  assert.equal(f.count, 3);
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
function editedContent(project, mutate) {
  const content = {
    name: project.name,
    selectedSceneId: project.selectedSceneId,
    scenes: structuredClone(project.scenes),
  };
  mutate(content);
  return content;
}
test('429 continuation allows project rename, another selected scene, renamed reserved scene and unreserved draft changes without replaying sent jobs', async (t) => {
  const f = fixture(t, {
    send: async ({ number, bytes }) => {
      if (number === 2) throw new NaiError('HTTP_ERROR', true, 429);
      return bytes;
    },
  });
  const p = await f.prepare(3, [f.scenes[0].id, f.scenes[1].id]),
    first = await f.service.runQueue(p.ticket, true);
  const edited = f.core.save(
    f.first.project.id,
    first.latest.snapshot.revision,
    editedContent(first.latest.snapshot.project, (c) => {
      c.name = 'renamed project';
      c.selectedSceneId = c.scenes[2].id;
      c.scenes[0].name = 'renamed reserved scene';
      c.scenes[2].draft.prompt = 'unreserved edit';
    }),
  );
  const next = await f.service.prepareRemaining(
    p.queueId,
    edited.project.id,
    edited.revision,
  );
  assert.equal(next.total, 4);
  assert.deepEqual(
    next.items.map((i) => i.id),
    p.items.slice(2).map((i) => i.id),
  );
  const done = await f.service.runQueue(next.ticket, true);
  assert.equal(f.count, 6);
  assert.equal(done.latest.snapshot.project.images.length, 5);
  assert.equal(done.latest.snapshot.project.name, 'renamed project');
  assert.equal(done.latest.snapshot.project.selectedSceneId, f.scenes[2].id);
  assert.equal(
    done.latest.snapshot.project.scenes[2].draft.prompt,
    'unreserved edit',
  );
  assert.deepEqual(
    f.bodies.map((b) => JSON.parse(Buffer.from(b)).parameters.seed),
    p.items.map((i) => i.seed),
  );
});
test('first run checks queued drafts rather than a stale project revision or non-generating scene metadata', async (t) => {
  const f = fixture(t),
    p = await f.prepare(2, [f.scenes[0].id]);
  f.core.save(
    f.first.project.id,
    f.first.revision,
    editedContent(f.first.project, (c) => {
      c.name = 'metadata only';
      c.selectedSceneId = c.scenes[1].id;
      c.scenes = [c.scenes[1], { ...c.scenes[0], name: 'new scene name' }];
    }),
  );
  const result = await f.service.runQueue(p.ticket, true);
  assert.equal(f.count, 2);
  assert.equal(result.latest.snapshot.project.images.length, 2);
});
test('editing a done-only scene and deleting a failed-only scene does not block the sole remaining unsent scene', async (t) => {
  const f = fixture(t, {
      send: async ({ number, bytes }) => {
        if (number === 2) throw new NaiError('HTTP_ERROR', true, 429);
        return bytes;
      },
    }),
    p = await f.prepare(1);
  const first = await f.service.runQueue(p.ticket, true);
  const edited = f.core.save(
    f.first.project.id,
    first.latest.snapshot.revision,
    editedContent(first.latest.snapshot.project, (c) => {
      c.scenes[0].draft.prompt = 'edit completed scene';
      c.scenes.splice(1, 1);
      c.selectedSceneId = c.scenes[1].id;
    }),
  );
  const next = await f.service.prepareRemaining(
    p.queueId,
    edited.project.id,
    edited.revision,
  );
  assert.equal(next.total, 1);
  assert.equal(next.items[0].sceneId, f.scenes[2].id);
  await f.service.runQueue(next.ticket, true);
  assert.equal(f.count, 3);
});
test('deleted reserved scene is a named, unsent conflict; restoring it permits the same jobs under fresh confirmation', async (t) => {
  const f = fixture(t),
    p = await f.prepare(1, [f.scenes[0].id, f.scenes[1].id]);
  const edited = f.core.save(
    f.first.project.id,
    f.first.revision,
    editedContent(f.first.project, (c) => {
      c.scenes.splice(1, 1);
    }),
  );
  const stopped = await f.service.runQueue(p.ticket, true);
  assert.equal(f.count, 0);
  assert.equal(stopped.queue.items[0].status, 'pending');
  assert.equal(stopped.queue.items[0].error.code, 'QUEUE_INPUT_CHANGED');
  assert.equal(stopped.queue.items[0].error.conflictSceneId, f.scenes[1].id);
  const restored = f.core.save(edited.project.id, edited.revision, {
    name: edited.project.name,
    selectedSceneId: edited.project.selectedSceneId,
    scenes: f.scenes,
  });
  const next = await f.service.prepareRemaining(
    p.queueId,
    restored.project.id,
    restored.revision,
  );
  assert.equal(next.total, 2);
  await f.service.runQueue(next.ticket, true);
  assert.equal(f.count, 2);
});
test('semantically identical draft keys in a different JSON order do not create a false conflict', async (t) => {
  const f = fixture(t),
    p = await f.prepare(1, [f.scenes[0].id]);
  f.core.save(
    f.first.project.id,
    f.first.revision,
    editedContent(f.first.project, (c) => {
      c.scenes[0].draft = Object.fromEntries(
        Object.entries(c.scenes[0].draft).reverse(),
      );
    }),
  );
  await f.service.runQueue(p.ticket, true);
  assert.equal(f.count, 1);
});
test('temporary storage preflight failures preserve unsent work and error code; recovery never sends without fresh confirmation', async (t) => {
  let reads = 0;
  const f = fixture(t, {
      store: (core) =>
        proxy(core, {
          generationSnapshot: (...args) => {
            reads++;
            if (reads === 3) throw new ProjectError('PROJECT_SERVICE_STOPPED');
            return core.generationSnapshot(...args);
          },
        }),
    }),
    p = await f.prepare(1);
  const stopped = await f.service.runQueue(p.ticket, true);
  assert.equal(f.count, 0);
  assert.ok(stopped.queue.items.every((i) => i.status === 'pending'));
  assert.equal(stopped.queue.items[0].error.code, 'PROJECT_SERVICE_STOPPED');
  await assert.rejects(f.service.runQueue(p.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  const next = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    f.first.revision,
  );
  assert.equal(next.total, 3);
  assert.equal(f.count, 0);
  await f.service.runQueue(next.ticket, true);
  assert.equal(f.count, 3);
});
test('a sendImage-stage failure stays failed even when the transport proves it never reached the server', async (t) => {
  const f = fixture(t, {
      send: async ({ number, bytes }) => {
        if (number === 1) throw new NaiError('OFFLINE', false);
        return bytes;
      },
    }),
    p = await f.prepare(1);
  const stopped = await f.service.runQueue(p.ticket, true);
  assert.equal(stopped.queue.items[0].status, 'failed');
  assert.equal(stopped.queue.items[0].error.mayHaveReachedServer, false);
  const next = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    f.first.revision,
  );
  assert.equal(next.total, 2);
  assert.ok(next.items.every((i) => i.id !== p.items[0].id));
});
test('trusted conflict IPC returns only a bounded local scene ID and fixed code; untrusted calls still fail first', async (t) => {
  const { registerGeneration } = require('../main/nai/generationIpc');
  const { GenerationError } = require('../main/nai/workspaceGeneration');
  const f = fixture(t),
    p = await f.prepare(1),
    handlers = new Map();
  const saved = f.core.save(
    f.first.project.id,
    f.first.revision,
    editedContent(f.first.project, (c) => {
      c.scenes[0].draft.negativePrompt = 'changed negative';
    }),
  );
  registerGeneration(
    { handle: (name, action) => handlers.set(name, action) },
    f.service,
    (e) => e === 'trusted',
  );
  const action = handlers.get('workspace-generation-prepare-remaining');
  assert.deepEqual(
    await action('untrusted', p.queueId, saved.project.id, saved.revision),
    { ok: false, code: 'UNTRUSTED_SENDER', mayHaveReachedServer: false },
  );
  assert.deepEqual(
    await action('trusted', p.queueId, saved.project.id, saved.revision),
    {
      ok: false,
      code: 'QUEUE_INPUT_CHANGED',
      mayHaveReachedServer: false,
      conflictSceneId: f.scenes[0].id,
    },
  );
  assert.equal(
    new GenerationError(
      'QUEUE_INPUT_CHANGED',
      false,
      undefined,
      undefined,
      undefined,
      '/private/raw/token',
    ).conflictSceneId,
    undefined,
  );
  assert.equal(
    new GenerationError(
      'NETWORK',
      true,
      undefined,
      undefined,
      undefined,
      'valid-looking-id',
    ).conflictSceneId,
    undefined,
  );
});
test('429 followed by a later TIMEOUT reports the current stopped item, not the historic429', async (t) => {
  const {
    queueOutcome,
  } = require('../renderer/generation/generationPresentation');
  const f = fixture(t, {
      send: async ({ number, bytes }) => {
        if (number === 1) throw new NaiError('HTTP_ERROR', true, 429);
        if (number === 3) throw new NaiError('TIMEOUT', true);
        return bytes;
      },
    }),
    p = await f.prepare(1);
  const first = await f.service.runQueue(p.ticket, true);
  assert.equal(first.queue.stoppedItemId, p.items[0].id);
  const next = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    f.first.revision,
  );
  const stopped = await f.service.runQueue(next.ticket, true);
  assert.equal(stopped.queue.items[0].error.httpStatus, 429);
  assert.equal(stopped.queue.stoppedItemId, p.items[2].id);
  assert.equal(queueOutcome(stopped.queue).error.code, 'TIMEOUT');
  assert.equal(queueOutcome(stopped.queue).pending, false);
  assert.equal(f.count, 3);
});
test('historic429 cannot mask a new result-pending or delay the storage recovery state; save-only success resolves the current cause', async (t) => {
  const {
    queueOutcome,
  } = require('../renderer/generation/generationPresentation');
  let fail = true;
  const f = fixture(t, {
      send: async ({ number, bytes }) => {
        if (number === 1) throw new NaiError('HTTP_ERROR', true, 429);
        return bytes;
      },
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
  await f.service.runQueue(p.ticket, true);
  const next = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    f.first.revision,
  );
  const stopped = await f.service.runQueue(next.ticket, true),
    outcome = queueOutcome(stopped.queue);
  assert.equal(outcome.error.code, 'RESULT_SAVE_FAILED');
  assert.equal(outcome.pending, true);
  assert.equal(stopped.queue.stoppedItemId, p.items[1].id);
  assert.equal(f.count, 2);
  const saved = await f.service.retrySave();
  assert.equal(f.count, 2);
  assert.equal(f.service.queueStatus().queue.stoppedItemId, undefined);
  assert.equal(queueOutcome(f.service.queueStatus().queue).error, undefined);
  const remaining = await f.service.prepareRemaining(
    p.queueId,
    saved.snapshot.project.id,
    saved.snapshot.revision,
  );
  assert.equal(remaining.total, 1);
});
test('fresh execution clears the previous pending error before asynchronous preflight completes', async (t) => {
  let calls = 0,
    block = false;
  const entered = deferred(),
    release = deferred();
  const f = fixture(t, {
      store: (core) =>
        proxy(core, {
          generationSnapshot: (...args) => {
            calls++;
            if (calls === 3) throw new ProjectError('PROJECT_BUSY');
            return core.generationSnapshot(...args);
          },
          readManifest: async (...args) => {
            if (block) {
              block = false;
              entered.resolve();
              await release.promise;
            }
            return core.readManifest(...args);
          },
        }),
    }),
    p = await f.prepare(1);
  const first = await f.service.runQueue(p.ticket, true);
  assert.equal(first.queue.items[0].error.code, 'PROJECT_BUSY');
  const next = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    f.first.revision,
  );
  block = true;
  const running = f.service.runQueue(next.ticket, true);
  await entered.promise;
  const status = f.service.queueStatus().queue;
  assert.equal(status.stoppedItemId, undefined);
  assert.equal(status.items[0].status, 'preparing');
  assert.equal(status.items[0].error, undefined);
  assert.throws(
    () => f.service.excludePendingScene(p.queueId, f.scenes[0].id, true),
    { code: 'GENERATION_BUSY' },
  );
  release.resolve();
  await running;
  assert.equal(f.count, 3);
});
test('successful continuation does not redisplay an earlier failure and a stop before the next send has no stale cause', async (t) => {
  const {
    queueOutcome,
  } = require('../renderer/generation/generationPresentation');
  const f = fixture(t, {
      send: async ({ number, bytes }) => {
        if (number === 1) throw new NaiError('HTTP_ERROR', true, 429);
        return bytes;
      },
    }),
    p = await f.prepare(1);
  await f.service.runQueue(p.ticket, true);
  const next = await f.service.prepareRemaining(
    p.queueId,
    f.first.project.id,
    f.first.revision,
  );
  const done = await f.service.runQueue(next.ticket, true);
  assert.equal(done.queue.items[0].error.httpStatus, 429);
  assert.equal(queueOutcome(done.queue).error, undefined);
  assert.equal(done.queue.stoppedItemId, undefined);
});
test('confirmed exclusion removes only a conflicting scene unsent count, edits no project file and never replays or transmits automatically', async (t) => {
  const f = fixture(t, {
      send: async ({ number, bytes }) => {
        if (number === 1) throw new NaiError('HTTP_ERROR', true, 429);
        return bytes;
      },
    }),
    p = await f.prepare(2);
  await f.service.runQueue(p.ticket, true);
  const edited = f.core.save(
    f.first.project.id,
    f.first.revision,
    editedContent(f.first.project, (c) => {
      c.scenes[1].draft.prompt = 'new conflicting input';
    }),
  );
  await assert.rejects(
    f.service.prepareRemaining(p.queueId, edited.project.id, edited.revision),
    { code: 'QUEUE_INPUT_CHANGED' },
  );
  const file = path.join(
      f.profile,
      'projects-v1',
      edited.project.id,
      'project.json',
    ),
    before = fs.readFileSync(file),
    sceneId = f.scenes[1].id;
  assert.throws(
    () => f.service.excludePendingScene(p.queueId, sceneId, false),
    { code: 'INVALID_INPUT' },
  );
  assert.throws(
    () => f.service.excludePendingScene(crypto.randomUUID(), sceneId, true),
    { code: 'INVALID_INPUT' },
  );
  assert.throws(
    () => f.service.excludePendingScene(p.queueId, f.scenes[0].id, true),
    { code: 'INVALID_INPUT' },
  );
  const excluded = f.service.excludePendingScene(p.queueId, sceneId, true);
  assert.equal(
    excluded.queue.items.filter((i) => i.status === 'skipped').length,
    2,
  );
  assert.ok(
    excluded.queue.items
      .filter((i) => i.status === 'skipped')
      .every((i) => i.sceneId === sceneId),
  );
  assert.equal(excluded.queue.items[0].status, 'failed');
  assert.equal(excluded.queue.stoppedItemId, undefined);
  assert.equal(f.count, 1);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.throws(() => f.service.excludePendingScene(p.queueId, sceneId, true), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(f.service.runQueue(p.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  const next = await f.service.prepareRemaining(
    p.queueId,
    edited.project.id,
    edited.revision,
  );
  assert.equal(next.total, 3);
  assert.ok(next.items.every((i) => i.sceneId !== sceneId));
  assert.equal(f.count, 1);
  const done = await f.service.runQueue(next.ticket, true);
  assert.equal(f.count, 4);
  assert.equal(done.latest.snapshot.project.images.length, 3);
  assert.equal(
    done.latest.snapshot.project.scenes[1].draft.prompt,
    'new conflicting input',
  );
});
test('excluding a later conflicting scene clears the current job stop error and preserves the other unsent jobs', async (t) => {
  const f = fixture(t, {
    send: async ({ number, core, first, bytes }) => {
      if (number === 1)
        core.save(
          first.project.id,
          first.revision,
          editedContent(first.project, (c) => {
            c.scenes[2].draft.prompt = 'changed later scene';
          }),
        );
      return bytes;
    },
  });
  const plan = await f.prepare(2);
  const stopped = await f.service.runQueue(plan.ticket, true);
  const current = stopped.queue.items[1];
  assert.equal(current.sceneId, f.scenes[1].id);
  assert.equal(current.status, 'pending');
  assert.equal(current.error.conflictSceneId, f.scenes[2].id);
  assert.equal(stopped.queue.stoppedItemId, current.id);
  const before = f.core.readManifest(f.first.project.id);
  const excluded = f.service.excludePendingScene(
    plan.queueId,
    f.scenes[2].id,
    true,
  );
  assert.equal(excluded.queue.stoppedItemId, undefined);
  assert.ok(excluded.queue.items.every((item) => item.error === undefined));
  assert.equal(excluded.queue.items[1].status, 'pending');
  assert.equal(
    excluded.queue.items.filter((i) => i.status === 'skipped').length,
    2,
  );
  assert.equal(f.count, 1);
  assert.deepEqual(f.core.readManifest(f.first.project.id), before);
  await assert.rejects(f.service.runQueue(plan.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  const remaining = await f.service.prepareRemaining(
    plan.queueId,
    before.project.id,
    before.revision,
  );
  assert.deepEqual(
    remaining.items.map((i) => i.sceneId),
    [f.scenes[1].id, f.scenes[0].id, f.scenes[1].id],
  );
  assert.equal(f.count, 1);
  const done = await f.service.runQueue(remaining.ticket, true);
  assert.equal(f.count, 4);
  assert.equal(done.latest.snapshot.project.images.length, 4);
  assert.ok(done.queue.items.every((item) => item.error === undefined));
});
test('deleting and excluding every remaining scene leaves zero requests and requires a new reservation', async (t) => {
  const f = fixture(t),
    p = await f.prepare(2, [f.scenes[0].id]);
  f.core.save(
    f.first.project.id,
    f.first.revision,
    editedContent(f.first.project, (c) => {
      c.scenes.splice(0, 1);
      c.selectedSceneId = c.scenes[0].id;
    }),
  );
  await f.service.runQueue(p.ticket, true);
  const skipped = f.service.excludePendingScene(
    p.queueId,
    f.scenes[0].id,
    true,
  );
  assert.ok(skipped.queue.items.every((i) => i.status === 'skipped'));
  assert.equal(f.count, 0);
  const current = f.core.readManifest(f.first.project.id);
  await assert.rejects(
    f.service.prepareRemaining(p.queueId, current.project.id, current.revision),
    { code: 'INVALID_INPUT' },
  );
  assert.equal(f.count, 0);
});
test('a received unsaved PNG and active run cannot be bypassed by excluding a scene; discard resolves its stop cause without replay', async (t) => {
  const f = fixture(t, {
      store: (core) =>
        proxy(core, {
          addPNG: () => {
            throw new ProjectError('PROJECT_IO');
          },
        }),
    }),
    p = await f.prepare(1);
  const stopped = await f.service.runQueue(p.ticket, true);
  assert.equal(stopped.queue.items[0].status, 'result-pending');
  assert.throws(
    () => f.service.excludePendingScene(p.queueId, f.scenes[0].id, true),
    { code: 'GENERATION_BUSY' },
  );
  assert.equal(f.service.status().pending, true);
  f.service.discardPending();
  assert.equal(f.service.queueStatus().queue.stoppedItemId, undefined);
  assert.equal(f.count, 1);
});
test('exclusion IPC uses the existing trust guard and accepts no stale or unrelated scene operation', async (t) => {
  const { registerGeneration } = require('../main/nai/generationIpc');
  const f = fixture(t),
    p = await f.prepare(1),
    handlers = new Map();
  registerGeneration(
    { handle: (name, action) => handlers.set(name, action) },
    f.service,
    (e) => e === 'trusted',
  );
  const action = handlers.get('workspace-generation-exclude-scene');
  assert.deepEqual(await action('untrusted', p.queueId, f.scenes[0].id, true), {
    ok: false,
    code: 'UNTRUSTED_SENDER',
    mayHaveReachedServer: false,
  });
  assert.deepEqual(await action('trusted', p.queueId, f.scenes[0].id, true), {
    ok: false,
    code: 'INVALID_INPUT',
    mayHaveReachedServer: false,
  });
  assert.equal(f.count, 0);
});
