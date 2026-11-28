const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ProjectStore } = require('../main/projects/projectStore');
const { WorkspaceGeneration } = require('../main/nai/workspaceGeneration');
const { bindBasicGeneration } = require('../main/nai/workspaceBinding');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const {
  snapshotWorkspaceScenes,
} = require('../renderer/preview/workspaceDraft');
const {
  V5_QUALITY_TAGS,
  V5_UC_PRESETS,
} = require('../workspaceGenerationSettings');
const {
  validateWorkspaceProject,
  validateProjectContent,
} = require('../workspaceProject');
const { png } = require('./fixtures/nai/png.cjs');
test('transparent tags respect tag boundaries, whitespace and active numeric weight groups', () => {
  const {
    transparentBackgroundTags,
  } = require('../workspaceGenerationSettings');
  const scene = createConnectedWorkspaceState().scenes[0];
  scene.draft.transparentBackground = true;
  for (const [text, present, suppressed] of [
    ['portrait, transparent   background', true, false],
    ['2.1::transparent background::', true, false],
    ['-1::portrait, transparent background::', true, true],
    ['0::transparent background::', true, true],
    ['-1::outline::, transparent background', true, false],
    ['semi-transparent background, transparent backgrounds', false, false],
  ]) {
    assert.deepEqual(transparentBackgroundTags(text), { present, suppressed });
    scene.draft.prompt = text;
    const bound = bindBasicGeneration(scene);
    assert.equal(bound.input.draft.prompt, text);
    assert.equal(
      bound.request.input.startsWith(text + ', transparent background,'),
      !present,
    );
  }
});
test('V5 alpha uses the approved caption, preserves manual tags and reopens only opted-in projects at v13', (t) => {
  const { core, first } = fixture(t);
  const scene = structuredClone(first.project.scenes[0]);
  const content = { name: 'alpha', selectedSceneId: scene.id, scenes: [scene] };
  scene.draft.transparentBackground = true;
  for (const text of [
    'portrait',
    'portrait, transparent background',
    'portrait, 2.1::transparent background::',
  ]) {
    scene.draft.prompt = text;
    const { request, input } = bindBasicGeneration(scene);
    assert.equal(request.parameters.tag_hint_transparent_background, true);
    assert.equal(request.parameters.straight_alpha, true);
    assert.equal(request.input.match(/transparent background/g).length, 1);
    assert.equal(
      request.input,
      request.parameters.v4_prompt.caption.base_caption,
    );
    assert.equal(input.draft.prompt, text);
  }
  const saved = core.create(content);
  const reopened = core.readManifest(saved.project.id);
  assert.equal(reopened.project.version, 13);
  assert.deepEqual(reopened.project.scenes[0], scene);
  assert.throws(() =>
    validateWorkspaceProject({ ...saved.project, version: 12 }),
  );
  const legacy = {
    ...scene,
    draft: { ...scene.draft, family: 'v4.5', model: 'nai-diffusion-3' },
  };
  assert.equal(
    bindBasicGeneration(legacy).request.parameters
      .tag_hint_transparent_background,
    undefined,
  );
  delete scene.draft.transparentBackground;
  const disabled = bindBasicGeneration(scene).request;
  assert.equal(disabled.parameters.tag_hint_transparent_background, undefined);
  assert.ok(disabled.input.includes('2.1::transparent background::'));
  assert.ok(core.create(content).project.version < 13);
});
function fixture(t, legacy = false, failSave = false) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-v5-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const state = createConnectedWorkspaceState(legacy ? 'v4.5' : 'v5');
  const core = new ProjectStore(profile);
  const first = core.create({
    name: 'synthetic',
    selectedSceneId: state.selectedSceneId,
    scenes: snapshotWorkspaceScenes(state),
  });
  const bodies = [];
  let fail = failSave;
  const store = new Proxy(core, {
    get(target, key) {
      if (key === 'addPNG')
        return (...args) => {
          if (fail) {
            fail = false;
            throw new (require('../workspaceProject').ProjectError)(
              'PROJECT_IO',
            );
          }
          return target.addPNG(...args);
        };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const bytes = Uint8Array.from(png());
  const service = new WorkspaceGeneration({
    store,
    offline: () => false,
    sendImage: async (body) => {
      bodies.push(Buffer.from(body));
      return bytes;
    },
  });
  return { core, first, state, service, bodies, bytes, profile };
}
test('approved alpha results retain transparent pixels through selection, reopening and ZIP export', async (t) => {
  const { core, service, state, bytes, profile } = fixture(t);
  const scene = state.scenes[0];
  scene.draft.transparentBackground = true;
  let snapshot = core.create({
    name: 'alpha',
    selectedSceneId: scene.id,
    scenes: [scene],
  });
  for (let i = 0; i < 2; i++) {
    const plan = await service.prepare(
      snapshot.project.id,
      snapshot.revision,
      scene.id,
    );
    assert.equal(plan.transparentBackground, true);
    snapshot = (await service.run(plan.ticket, true)).snapshot;
  }
  const id = snapshot.project.id;
  const ids = snapshot.project.images.map((image) => image.id);
  core.setResultPicks(id, snapshot.revision, ids, true);
  assert.equal(core.readManifest(id).project.version, 13);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-zip-'));
  t.after(() => fs.rmSync(dest, { recursive: true, force: true }));
  const file = path.join(dest, 'selected.zip');
  let save;
  require('../main/projects/resultExport').default(
    {
      handle: (_, fn) => {
        save = fn;
      },
    },
    core,
    profile,
    () => true,
    async () => file,
  );
  assert.deepEqual(await save({}, id, core.resultPicks(id)), {
    ok: true,
    value: true,
  });
  const zip = await require('jszip').loadAsync(fs.readFileSync(file), {
    checkCRC32: true,
  });
  assert.equal(Object.keys(zip.files).length, 2);
  for (const entry of Object.values(zip.files)) {
    const pngBytes = await entry.async('nodebuffer');
    assert.deepEqual(pngBytes, Buffer.from(bytes));
    // The 2x1 RGBA fixture stores an unfiltered row in one IDAT chunk.
    const idat = pngBytes.indexOf('IDAT');
    const length = pngBytes.readUInt32BE(idat - 4);
    const row = require('node:zlib').inflateSync(
      pngBytes.subarray(idat + 4, idat + 4 + length),
    );
    assert.deepEqual([row[0], row[4], row[8]], [0, 0, 255]);
  }
});

test('new scenes use V5 portrait with observed defaults and reversible quality controls', () => {
  const state = createConnectedWorkspaceState(),
    d = state.draft;
  assert.deepEqual(
    [d.family, d.resolution, d.steps, d.guidance, d.qualityTags, d.ucPreset],
    ['v5', 'portrait', '23', '7', 'standard', 'heavy'],
  );
  assert.equal(d.seedMode, 'random');
  const before = structuredClone(state.scenes[0]);
  const { request, input, bindingId } = bindBasicGeneration(
    before,
    () => 12345,
  );
  assert.equal(bindingId, 'nai-v5-full-v1');
  assert.equal(request.model, 'nai-diffusion-5-full');
  assert.equal(request.parameters.params_version, 4);
  assert.deepEqual(
    [
      request.parameters.width,
      request.parameters.height,
      request.parameters.steps,
      request.parameters.scale,
    ],
    [832, 1216, 23, 7],
  );
  assert.equal(request.parameters.image_format, 'png');
  assert.equal(request.parameters.use_coords, false);
  assert.equal(request.parameters.legacy_uc, false);
  assert.equal(request.input, `${d.prompt}, ${V5_QUALITY_TAGS.standard}`);
  assert.equal(
    request.parameters.v4_prompt.caption.base_caption,
    request.input,
  );
  assert.equal(
    request.parameters.negative_prompt,
    `${V5_UC_PRESETS.heavy}, ${d.negativePrompt}`,
  );
  assert.equal(
    request.parameters.v4_negative_prompt.caption.base_caption,
    request.parameters.negative_prompt,
  );
  assert.equal(request.parameters.v4_negative_prompt.legacy_uc, false);
  assert.equal(request.parameters.deliberate_euler_ancestral_bug, false);
  assert.equal(request.parameters.prefer_brownian, true);
  assert.equal(request.parameters.extra_noise_seed, 12344);
  assert.deepEqual(input.draft, state.scenes[0].draft);
  assert.deepEqual(before, state.scenes[0]);
});
test('V5 quality and UC choices affect only effective request strings; seed0 and aspect choices remain explicit', () => {
  const scene = createConnectedWorkspaceState().scenes[0];
  for (const qualityTags of Object.keys(V5_QUALITY_TAGS))
    for (const ucPreset of Object.keys(V5_UC_PRESETS)) {
      const d = {
        ...scene.draft,
        qualityTags,
        ucPreset,
        seedMode: 'fixed',
        seed: '0',
        negativePrompt: '',
      };
      const { request } = bindBasicGeneration({ ...scene, draft: d });
      assert.equal(request.parameters.seed, 0);
      assert.equal(request.parameters.extra_noise_seed, 0);
      assert.equal(request.parameters.negative_prompt, V5_UC_PRESETS[ucPreset]);
      assert.equal(
        request.input,
        [d.prompt, V5_QUALITY_TAGS[qualityTags]].filter(Boolean).join(', '),
      );
    }
  for (const [resolution, width, height] of [
    ['portrait', 832, 1216],
    ['landscape', 1216, 832],
    ['square', 1024, 1024],
  ]) {
    const p = bindBasicGeneration({
      ...scene,
      draft: { ...scene.draft, resolution },
    }).request.parameters;
    assert.deepEqual([p.width, p.height], [width, height]);
  }
});
test('V5 invalid controls and unsupported character/mixing inputs never become requests', () => {
  const scene = createConnectedWorkspaceState().scenes[0];
  for (const patch of [
    { steps: '' },
    { steps: '51' },
    { steps: '2.5' },
    { guidance: '0' },
    { guidance: 'Infinity' },
    { resolution: 'other' },
    { qualityTags: 'other' },
    { ucPreset: 'other' },
    { seedMode: 'fixed', seed: '4294967296' },
    { prompt: 'a | b' },
    { prompt: '<group.piece>' },
    { characters: [{ enabled: true }] },
  ])
    assert.throws(() =>
      bindBasicGeneration({ ...scene, draft: { ...scene.draft, ...patch } }),
    );
});
test('V5 generation records exact body hash and PNG; v3 reopen/copy and v1/v2 reading remain independent', async (t) => {
  const f = fixture(t),
    plan = await f.service.prepare(
      f.first.project.id,
      f.first.revision,
      f.state.selectedSceneId,
    );
  assert.equal(f.first.project.version, 3);
  assert.equal(f.bodies.length, 0);
  assert.equal(plan.width, 832);
  assert.equal(plan.height, 1216);
  const generated = await f.service.run(plan.ticket, true),
    image = generated.snapshot.project.images[0];
  assert.equal(generated.snapshot.project.version, 3);
  assert.deepEqual(image.binding, {
    id: 'nai-v5-full-v1',
    requestHash: crypto.createHash('sha256').update(f.bodies[0]).digest('hex'),
  });
  assert.deepEqual(
    await f.service.image(f.first.project.id, image.id),
    f.bytes,
  );
  assert.deepEqual(f.core.open(f.first.project.id).project.images[0], image);
  const copy = f.core.copy(f.first.project.id, generated.snapshot.revision, {
    name: 'copy',
    selectedSceneId: f.state.selectedSceneId,
    scenes: generated.snapshot.project.scenes,
  });
  assert.equal(copy.project.version, 3);
  assert.deepEqual(copy.project.images, [image]);
  await assert.rejects(f.service.run(plan.ticket, true), {
    code: 'CONFIRMATION_EXPIRED',
  });
  assert.equal(f.bodies.length, 1);
  assert.throws(
    () =>
      validateWorkspaceProject({ ...generated.snapshot.project, version: 2 }),
    { code: 'PROJECT_CORRUPT' },
  );
});
test('switching legacy input to V5 preserves its immutable history; latest app can recover the old v1 copy', (t) => {
  const f = fixture(t, true),
    content = {
      name: f.first.project.name,
      selectedSceneId: f.first.project.selectedSceneId,
      scenes: structuredClone(f.first.project.scenes),
    };
  assert.equal(f.first.project.version, 1);
  Object.assign(content.scenes[0].draft, {
    family: 'v5',
    resolution: 'portrait',
    steps: '23',
    guidance: '7',
    qualityTags: 'standard',
    ucPreset: 'heavy',
  });
  const saved = f.core.save(f.first.project.id, f.first.revision, content);
  assert.equal(saved.project.version, 3);
  const recovered = f.core.recover(f.first.project.id, f.first.revision);
  assert.equal(recovered.project.version, 1);
  assert.equal(recovered.project.scenes[0].draft.family, 'v4.5');
  assert.equal(f.core.open(f.first.project.id).project.version, 3);
  assert.throws(
    () =>
      validateProjectContent({
        ...content,
        scenes: [
          {
            ...content.scenes[0],
            draft: { ...content.scenes[0].draft, qualityTags: 'invalid' },
          },
        ],
      }),
    { code: 'PROJECT_INPUT' },
  );
});
test('mixed V5/V4.5 queue exposes every approved setting and sends original per-scene bodies serially', async (t) => {
  const f = fixture(t),
    legacy = createConnectedWorkspaceState('v4.5').scenes[0];
  const content = {
    name: 'mixed',
    selectedSceneId: f.state.selectedSceneId,
    scenes: [f.first.project.scenes[0], { ...legacy, id: 'legacy' }],
  };
  const saved = f.core.save(f.first.project.id, f.first.revision, content);
  const plan = await f.service.prepareQueue(
    saved.project.id,
    saved.revision,
    content.scenes.map((s) => s.id),
    2,
  );
  assert.equal(plan.total, 4);
  assert.equal(plan.settings.length, 2);
  assert.equal(f.bodies.length, 0);
  assert.deepEqual(
    plan.items.map((i) => i.settings.model),
    [
      'nai-diffusion-5-full',
      'nai-diffusion-4-5-full',
      'nai-diffusion-5-full',
      'nai-diffusion-4-5-full',
    ],
  );
  const done = await f.service.runQueue(plan.ticket, true);
  assert.ok(done.queue.items.every((i) => i.status === 'done'));
  assert.deepEqual(
    f.bodies.map((b) => JSON.parse(b).model),
    plan.items.map((i) => i.settings.model),
  );
  assert.equal(done.latest.snapshot.project.version, 3);
  assert.deepEqual(
    done.latest.snapshot.project.images.map((i) => i.seed),
    plan.items.map((i) => i.seed),
  );
});
test('a V5 PNG save failure retains the result and retrySave never sends a second request', async (t) => {
  const f = fixture(t, false, true),
    p = await f.service.prepare(
      f.first.project.id,
      f.first.revision,
      f.state.selectedSceneId,
    );
  await assert.rejects(f.service.run(p.ticket, true), {
    code: 'RESULT_SAVE_FAILED',
    pendingResult: true,
  });
  assert.equal(f.bodies.length, 1);
  assert.equal(f.service.status().pending, true);
  const result = await f.service.retrySave();
  assert.equal(result.snapshot.project.version, 3);
  assert.equal(f.bodies.length, 1);
  assert.equal(f.service.status().pending, false);
  assert.deepEqual(
    await f.service.image(result.snapshot.project.id, result.imageId),
    f.bytes,
  );
});
