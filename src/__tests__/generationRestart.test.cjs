const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { WorkspaceGeneration } = require('../main/nai/workspaceGeneration');
const { GenerationJournal } = require('../main/nai/generationJournal');
const { ProjectStore } = require('../main/projects/projectStore');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const { png } = require('./fixtures/nai/png.cjs');

async function writer(profile, id, point) {
  const store = new ProjectStore(profile);
  const initial = store.open(id);
  const addPNG = store.addPNG.bind(store);
  store.addPNG = (...args) => {
    if (point === 'received') process.exit(37);
    if (point === 'written') {
      const rename = fs.renameSync;
      fs.renameSync = (from, to) => {
        if (path.basename(to) === 'project.json') process.exit(37);
        return rename(from, to);
      };
    }
    const result = addPNG(...args);
    if (point === 'committed') process.exit(37);
    return result;
  };
  const client = new WorkspaceGeneration({
    store,
    journal: new GenerationJournal(profile),
    offline: () => false,
    sendImage: async () => {
      if (point === 'staged') {
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => {
          if (to.endsWith('workspace-generation-recovery.v1')) process.exit(37);
          return rename(from, to);
        };
      }
      if (point === 'submitted') process.exit(37);
      return png();
    },
  });
  const plan = await client.prepareQueue(
    id,
    initial.revision,
    [initial.project.selectedSceneId],
    2,
    0,
  );
  await client.runQueue(plan.ticket, true);
}

if (process.argv[2] === 'writer')
  writer(...process.argv.slice(3)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
else
  for (const point of [
    'submitted',
    'staged',
    'received',
    'written',
    'committed',
  ])
    test('process restart after ' + point, async (t) => {
      const profile = fs.mkdtempSync(
        path.join(os.tmpdir(), 'sdstudio-interruption-'),
      );
      t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
      const store = new ProjectStore(profile);
      const { scenes, selectedSceneId } = createConnectedWorkspaceState();
      scenes[0].draft.prompt = 'garden';
      const initial = store.create({ name: 'Garden', scenes, selectedSceneId });
      const id = initial.project.id;
      const child = spawnSync(
        process.execPath,
        [
          '-r',
          'ts-node/register/transpile-only',
          __filename,
          'writer',
          profile,
          id,
          point,
        ],
        { encoding: 'utf8', timeout: 30000 },
      );
      assert.equal(child.status, 37, child.stderr);
      const reopen = () =>
        new WorkspaceGeneration({
          store,
          journal: new GenerationJournal(profile),
          offline: () => false,
          sendImage: () => assert.fail('unexpected send'),
        });
      const client = reopen();
      if (point === 'submitted') {
        assert.match(client.status().interruption, /Garden/);
        await assert.rejects(
          client.prepare(id, initial.revision, selectedSceneId),
          { code: 'GENERATION_BUSY' },
        );
        client.discardPending();
        assert.equal(reopen().status().interruption, undefined);
        return;
      }
      assert.equal(client.status().pending, true);
      if (point === 'written')
        await assert.rejects(client.retrySave(), {
          code: 'RESULT_SAVE_FAILED',
        });
      const result = await client.retrySave(
        point === 'written' || point === 'committed',
      );
      if (point === 'committed') assert.equal(result.snapshot.project.id, id);
      assert.equal(result.snapshot.project.images.length, 1);
      assert.deepEqual(
        Buffer.from(store.image(result.snapshot.project.id, result.imageId)),
        Buffer.from(png()),
      );
      assert.equal(reopen().status().pending, false);
    });
