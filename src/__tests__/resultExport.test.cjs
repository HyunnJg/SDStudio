const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { promises: fs } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const register = require('../main/projects/resultExport').default;
const { png } = require('./fixtures/nai/png.cjs');
const { ProjectError } = require('../workspaceProject');

async function fixture(t) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'sdstudio-export-'),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const profile = path.join(directory, 'profile');
  await fs.mkdir(profile);
  const id = randomUUID();
  const data = [Buffer.from(png(1, 1)), Buffer.from(png(2, 1))];
  const images = data.map((bytes) => ({
    id: randomUUID(),
    seed: 7,
    pngBytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }));
  const project = { images, trashedImageIds: [] };
  let invoke;
  const state = {
    trusted: true,
    reads: [],
    choose: async (_, ext) => path.join(directory, 'export.' + ext),
  };
  register(
    {
      handle: (_, fn) => {
        invoke = fn;
      },
    },
    {
      readManifest: async () => ({ project }),
      readPNG: async (_, hash) => {
        state.reads.push(hash);
        if (hash === state.corrupt) throw new ProjectError('PROJECT_CORRUPT');
        return data[images.findIndex((i) => i.sha256 === hash)];
      },
    },
    profile,
    () => state.trusted,
    (...args) => state.choose(...args),
  );
  return {
    state,
    images,
    data,
    directory,
    profile,
    project,
    save: (ids = images.map((i) => i.id)) => invoke({}, id, ids),
  };
}

test('PNG and same-seed ZIP exports preserve original bytes in project order', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await f.save([f.images[1].id]), { ok: true, value: true });
  assert.deepEqual(
    await fs.readFile(path.join(f.directory, 'export.png')),
    f.data[1],
  );
  assert.deepEqual(await f.save(f.images.map((i) => i.id).reverse()), {
    ok: true,
    value: true,
  });
  const zip = await JSZip.loadAsync(
    await fs.readFile(path.join(f.directory, 'export.zip')),
    { checkCRC32: true },
  );
  const entries = Object.values(zip.files);
  assert.equal(entries.length, 2);
  for (const [index, entry] of entries.entries()) {
    assert.ok(entry.name.endsWith(f.images[index].id + '.png'));
    assert.deepEqual(await entry.async('nodebuffer'), f.data[index]);
  }
});

test('mixed V3 picks and generated results export without a fabricated seed', async (t) => {
  const f = await fixture(t);
  const image = f.images[0];
  delete image.seed;
  image.origin = 'v3-pick';
  f.state.choose = async (name, ext) => {
    if (ext === 'png') assert.equal(name, `sdstudio-v3-${image.id.slice(0, 8)}.png`);
    return path.join(f.directory, 'mixed.' + ext);
  };
  assert.equal((await f.save([image.id])).ok, true);
  assert.equal((await f.save()).ok, true);
  const zip = await JSZip.loadAsync(await fs.readFile(path.join(f.directory, 'mixed.zip')));
  assert.deepEqual(await zip.file(`001-v3-${image.id}.png`).async('nodebuffer'), f.data[0]);
  assert.deepEqual(await zip.file(`002-7-${f.images[1].id}.png`).async('nodebuffer'), f.data[1]);
});

test('a bad second result leaves a previous ZIP intact and removes the partial export', async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, 'export.zip'), 'previous');
  f.state.corrupt = f.images[1].sha256;
  assert.deepEqual(await f.save(), { ok: false, code: 'PROJECT_CORRUPT' });
  assert.equal(
    await fs.readFile(path.join(f.directory, 'export.zip'), 'utf8'),
    'previous',
  );
  assert.deepEqual((await fs.readdir(f.directory)).sort(), [
    'export.zip',
    'profile',
  ]);
});

test('invalid or hidden selection, cancellation and trust loss never write results', async (t) => {
  const f = await fixture(t);
  const ids = f.images.map((i) => i.id);
  assert.equal((await f.save([])).code, 'PROJECT_INPUT');
  assert.equal((await f.save([ids[0], ids[0]])).code, 'PROJECT_INPUT');
  f.project.trashedImageIds = [ids[0]];
  assert.equal((await f.save()).code, 'PROJECT_NOT_FOUND');
  f.project.trashedImageIds = [];
  f.state.choose = async () => undefined;
  assert.deepEqual(await f.save(), { ok: true, value: false });
  f.state.choose = async () => path.join(f.profile, 'export.zip');
  assert.equal((await f.save()).code, 'PROJECT_INPUT');
  f.state.choose = async () => {
    f.state.trusted = false;
    return path.join(f.directory, 'invalid.zip');
  };
  assert.equal((await f.save()).code, 'PROJECT_UNTRUSTED');
  assert.equal(f.state.reads.length, 0);
  assert.deepEqual(await fs.readdir(f.directory), ['profile']);
});

test('a result hidden while choosing a destination stops the export before any PNG read', async (t) => {
  const f = await fixture(t);
  f.state.choose = async () => {
    f.project.trashedImageIds = [f.images[1].id];
    return path.join(f.directory, 'picked.zip');
  };
  assert.deepEqual(await f.save(), { ok: false, code: 'PROJECT_NOT_FOUND' });
  assert.deepEqual(f.state.reads, []);
  assert.deepEqual(await fs.readdir(f.directory), ['profile']);
});

test('a full gallery keeps distinct records even when all 120 use the same PNG and seed', async (t) => {
  const f = await fixture(t);
  const original = f.images[0];
  f.images.splice(
    0,
    f.images.length,
    ...Array.from({ length: 120 }, () => ({ ...original, id: randomUUID() })),
  );
  assert.deepEqual(await f.save(), { ok: true, value: true });
  const zip = await JSZip.loadAsync(
    await fs.readFile(path.join(f.directory, 'export.zip')),
    { checkCRC32: true },
  );
  assert.equal(Object.keys(zip.files).length, 120);
  assert.deepEqual(
    await Object.values(zip.files).at(-1).async('nodebuffer'),
    f.data[0],
  );
});

test('overlapping exports open one save dialog and cancelling leaves the next export available', async (t) => {
  const f = await fixture(t);
  let release, notify;
  const dialogOpened = new Promise((resolve) => {
    notify = resolve;
  });
  f.state.choose = () => {
    notify();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const pending = f.save();
  await dialogOpened;
  assert.deepEqual(await f.save(), { ok: false, code: 'PROJECT_BUSY' });
  release(undefined);
  assert.deepEqual(await pending, { ok: true, value: false });
  f.state.choose = async () => path.join(f.directory, 'next.zip');
  assert.deepEqual(await f.save(), { ok: true, value: true });
});
