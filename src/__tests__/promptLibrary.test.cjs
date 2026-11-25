const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PromptLibraryStore } = require('../main/prompts/promptLibraryStore');
const { registerPromptLibrary } = require('../main/prompts/promptLibraryIpc');
const {
  validatePreset,
  applyPromptPreset,
  presetFromDraft,
  legacyPresetCandidates,
  LIBRARY_LIMITS,
} = require('../promptLibrary');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const { bindBasicGeneration } = require('../main/nai/workspaceBinding');
const main = (name = '가상의 메인') => ({
  kind: 'main',
  name,
  prompt: 'garden',
  negativePrompt: 'blur',
  qualityTags: 'none',
  ucPreset: 'none',
});
const character = {
  kind: 'character',
  name: '가상의 인물',
  prompt: 'person, coat',
  negativePrompt: 'hat',
};
const options = {
  mode: 'replace',
  prompt: true,
  negative: true,
  presets: true,
};
function fixture(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-library-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  return {
    profile,
    file: path.join(profile, 'prompt-library/library.v1.json'),
    store: new PromptLibraryStore(profile),
  };
}
test('an empty library is local and main/character entries reopen with stable UUIDs and revision', async (t) => {
  const f = fixture(t),
    initial = await f.store.read();
  assert.equal(fs.existsSync(f.file), false);
  const a = await f.store.save(initial.revision, main());
  const b = await f.store.save(a.revision, character);
  assert.deepEqual(await new PromptLibraryStore(f.profile).read(), b);
  assert.deepEqual(
    b.entries.map((p) => p.kind),
    ['main', 'character'],
  );
  assert.equal(new Set(b.entries.map((p) => p.id)).size, 2);
  if (process.platform !== 'win32')
    assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
});
test('serialized concurrent edits and stale revisions cannot silently overwrite another preset', async (t) => {
  const f = fixture(t),
    before = await f.store.read();
  const results = await Promise.allSettled([
    f.store.save(before.revision, main('a')),
    f.store.save(before.revision, main('b')),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.find((r) => r.status === 'rejected').reason.code,
    'LIBRARY_CONFLICT',
  );
  const current = await f.store.read();
  assert.equal(current.entries.length, 1);
  const next = await f.store.save(
    current.revision,
    main('renamed'),
    current.entries[0].id,
  );
  assert.equal(next.entries.length, 1);
  assert.equal(next.entries[0].id, current.entries[0].id);
});
test('deletion is reversible, permanent deletion is limited to trash, and unrelated presets survive', async (t) => {
  const f = fixture(t),
    a = await f.store.read();
  const b = await f.store.save(a.revision, main()),
    c = await f.store.save(b.revision, character),
    id = b.entries[0].id;
  await assert.rejects(f.store.remove(c.revision, id), {
    code: 'LIBRARY_INPUT',
  });
  const deleted = await f.store.setDeleted(c.revision, id, true);
  assert.equal(deleted.entries[0].deleted, true);
  const restored = await f.store.setDeleted(deleted.revision, id, false);
  assert.deepEqual(restored.entries, c.entries);
  const again = await f.store.setDeleted(restored.revision, id, true);
  const removed = await f.store.remove(again.revision, id);
  assert.deepEqual(removed.entries, [c.entries[1]]);
});
test('corrupt and future files are preserved; an oversized file is bounded before JSON parsing', async (t) => {
  const f = fixture(t);
  await f.store.read();
  for (const [body, code] of [
    [Buffer.from('garbage'), 'LIBRARY_CORRUPT'],
    [
      Buffer.from(
        JSON.stringify({
          format: 'sdstudio-prompt-library',
          version: 99,
          entries: [],
        }),
      ),
      'LIBRARY_VERSION',
    ],
    [Buffer.alloc(LIBRARY_LIMITS.bytes + 1), 'LIBRARY_CORRUPT'],
  ]) {
    fs.writeFileSync(f.file, body);
    await assert.rejects(f.store.read(), { code });
    await assert.rejects(f.store.save('0'.repeat(64), main()), { code });
    assert.deepEqual(fs.readFileSync(f.file), body);
  }
});
test('a failed atomic rename leaves the old library intact and cleans only its own temporary file', async (t) => {
  const f = fixture(t),
    a = await f.store.read(),
    b = await f.store.save(a.revision, main());
  const before = fs.readFileSync(f.file),
    rename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (to === f.file) throw Error('synthetic private path');
    return rename(from, to);
  };
  try {
    await assert.rejects(f.store.save(b.revision, character));
  } finally {
    fsp.rename = rename;
  }
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.deepEqual(fs.readdirSync(path.dirname(f.file)), ['library.v1.json']);
  assert.deepEqual(await f.store.read(), b);
});
test('duplicate UUIDs and extra stored keys are rejected without changing file bytes', async (t) => {
  const f = fixture(t),
    a = await f.store.read(),
    b = await f.store.save(a.revision, main());
  const body = JSON.parse(fs.readFileSync(f.file));
  body.entries.push(structuredClone(body.entries[0]));
  fs.writeFileSync(f.file, JSON.stringify(body));
  await assert.rejects(f.store.read(), { code: 'LIBRARY_CORRUPT' });
  body.entries = [{ ...b.entries[0], path: '/not-accepted' }];
  fs.writeFileSync(f.file, JSON.stringify(body));
  await assert.rejects(f.store.read(), { code: 'LIBRARY_CORRUPT' });
});
test('library IPC rejects untrusted frames and hides raw exceptions while staying usable offline', async (t) => {
  const f = fixture(t),
    handles = new Map();
  let trusted = false;
  registerPromptLibrary(
    { handle: (name, fn) => handles.set(name, fn) },
    f.store,
    () => trusted,
  );
  for (const fn of handles.values())
    assert.deepEqual(await fn({}), { ok: false, code: 'LIBRARY_UNTRUSTED' });
  trusted = true;
  const r = await handles.get('prompt-library-read')({});
  assert.equal(r.ok, true);
  const saved = await handles.get('prompt-library-save')(
    {},
    r.value.revision,
    main(),
  );
  assert.equal(saved.ok, true);
  const invalid = await handles.get('prompt-library-save')(
    {},
    saved.value.revision,
    { ...main(), path: 'secret' },
  );
  assert.deepEqual(invalid, { ok: false, code: 'LIBRARY_INPUT' });
  const blocked = new Map();
  registerPromptLibrary(
    { handle: (name, fn) => blocked.set(name, fn) },
    {
      read: async () => {
        trusted = false;
        return saved.value;
      },
    },
    () => trusted,
  );
  assert.deepEqual(await blocked.get('prompt-library-read')({}), {
    ok: false,
    code: 'LIBRARY_UNTRUSTED',
  });
});
test('preset validation has distinct kind fields, bounded names/text and no model/path/seed input', () => {
  for (const p of [
    { ...character, qualityTags: 'none' },
    { ...main(), seed: 12 },
    { ...main(), model: 'anything' },
    { ...main(), name: '' },
    { ...main(), prompt: 'x'.repeat(65537) },
    { ...main(), prompt: 'a\0b' },
    { ...main(), qualityTags: 'unknown' },
  ])
    assert.throws(() => validatePreset(p), { code: 'LIBRARY_INPUT' });
});
test('main partial application preserves seed/model/characters and untouched fields exactly', () => {
  const draft = createConnectedWorkspaceState().draft,
    before = structuredClone(draft);
  const next = applyPromptPreset(draft, main(), {
    ...options,
    negative: false,
    presets: false,
  });
  assert.deepEqual(next, { ...draft, prompt: 'garden' });
  assert.deepEqual(draft, before);
  const applied = applyPromptPreset(draft, main(), options);
  assert.deepEqual([applied.qualityTags, applied.ucPreset], ['none', 'none']);
  const legacy = createConnectedWorkspaceState('v4.5').draft;
  const old = applyPromptPreset(legacy, main(), options);
  assert.equal(Object.hasOwn(old, 'qualityTags'), false);
  assert.throws(
    () =>
      applyPromptPreset(
        legacy,
        { ...main(), qualityTags: 'standard' },
        options,
      ),
    { code: 'LIBRARY_INPUT' },
  );
});
test('append preserves both texts verbatim and retains current quality/UC unless explicitly selected', () => {
  const draft = createConnectedWorkspaceState().draft;
  draft.prompt = 'original, ';
  const next = applyPromptPreset(draft, main(), {
    ...options,
    mode: 'append',
    presets: false,
  });
  assert.equal(next.prompt, 'original, \ngarden');
  assert.equal(next.qualityTags, draft.qualityTags);
  assert.equal(next.ucPreset, draft.ucPreset);
});
test('character presets target a single existing UUID without changing activation/location; adding is explicit', () => {
  const draft = createConnectedWorkspaceState().draft;
  draft.characters = [
    {
      id: 'existing',
      prompt: 'old',
      negativePrompt: '',
      enabled: false,
      cell: { row: 1, column: 4 },
    },
  ];
  const next = applyPromptPreset(draft, character, {
    ...options,
    characterId: 'existing',
  });
  assert.deepEqual(next.characters[0], {
    ...draft.characters[0],
    prompt: character.prompt,
    negativePrompt: 'hat',
  });
  const added = applyPromptPreset(draft, character, options, () => 'new-id');
  assert.equal(added.characters.length, 2);
  assert.equal(added.characters[1].id, 'new-id');
  assert.deepEqual(added.characters[0], draft.characters[0]);
  assert.throws(
    () =>
      applyPromptPreset(draft, character, {
        ...options,
        characterId: 'missing',
      }),
    { code: 'LIBRARY_INPUT' },
  );
});
test('PNG-derived captions with disabled automatic presets remain single in the rebound request', () => {
  const draft = createConnectedWorkspaceState().draft;
  const bound = bindBasicGeneration(
    { id: 'scene', name: 'scene', draft },
    () => 12345,
  );
  const restored = {
    ...draft,
    prompt: bound.request.input,
    negativePrompt: bound.request.parameters.negative_prompt,
    qualityTags: 'none',
    ucPreset: 'none',
  };
  const preset = {
    ...presetFromDraft(restored, 'main'),
    name: 'PNG final captions',
  };
  const next = applyPromptPreset(draft, preset, options);
  const rebound = bindBasicGeneration(
    { id: 'scene', name: 'scene', draft: next },
    () => 12345,
  );
  assert.equal(rebound.request.input, bound.request.input);
  assert.equal(
    rebound.request.parameters.negative_prompt,
    bound.request.parameters.negative_prompt,
  );
});
test('legacy session import reads only known text fields and leaves input bytes/data untouched', () => {
  const session = {
    version: 1,
    presets: {
      SDImageGen: [
        {
          name: 'old',
          frontPrompt: 'front',
          backPrompt: 'back',
          uc: 'bad',
          sampling: 'unverified',
          model: 'v3',
        },
      ],
      Other: [{ name: 'ignore', frontPrompt: 'x', backPrompt: '', uc: '' }],
    },
    scenes: { scene: { prompt: 'not imported' } },
  };
  const before = JSON.stringify(session),
    values = legacyPresetCandidates(session);
  assert.deepEqual(values, [
    { ...main('old'), prompt: 'front\nback', negativePrompt: 'bad' },
  ]);
  assert.equal(JSON.stringify(session), before);
  assert.throws(() => legacyPresetCandidates({ presets: [] }), {
    code: 'LIBRARY_INPUT',
  });
});

test('legacy Easy shared character and background/global negative become distinct candidates', () => {
  const values = legacyPresetCandidates({
    presets: {},
    presetShareds: {
      SDImageGenEasy: {
        characterPrompt: 'person',
        backgroundPrompt: 'garden',
        uc: 'global bad',
        seed: 123,
      },
    },
  });
  assert.deepEqual(
    values.map((p) => [p.kind, p.prompt, p.negativePrompt]),
    [
      ['character', 'person', ''],
      ['main', 'garden', 'global bad'],
    ],
  );
});
test('library capacity includes trash and can be freed by explicit permanent removal', async (t) => {
  const f = fixture(t);
  await f.store.read();
  const entries = Array.from({ length: LIBRARY_LIMITS.entries }, () => ({
    ...main(),
    id: require('node:crypto').randomUUID(),
    deleted: true,
  }));
  fs.writeFileSync(
    f.file,
    JSON.stringify({ format: 'sdstudio-prompt-library', version: 1, entries }),
  );
  const full = await f.store.read();
  await assert.rejects(f.store.save(full.revision, character), {
    code: 'LIBRARY_LIMIT',
  });
  const freed = await f.store.remove(full.revision, entries[0].id);
  assert.equal(
    (await f.store.save(freed.revision, character)).entries.length,
    LIBRARY_LIMITS.entries,
  );
});
test('invalid UTF8 is preserved and cannot be rewritten as replacement characters', async (t) => {
  const f = fixture(t),
    before = await f.store.read();
  await f.store.save(before.revision, main());
  const bytes = fs.readFileSync(f.file);
  bytes[bytes.indexOf('garden')] = 0xff;
  fs.writeFileSync(f.file, bytes);
  await assert.rejects(f.store.read(), { code: 'LIBRARY_CORRUPT' });
  assert.deepEqual(fs.readFileSync(f.file), bytes);
});
test(
  'a symlink library is refused without reading or altering its target',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = fixture(t);
    await f.store.read();
    const target = path.join(f.profile, 'target');
    fs.writeFileSync(target, 'private');
    fs.symlinkSync(target, f.file);
    await assert.rejects(f.store.read(), { code: 'LIBRARY_CORRUPT' });
    assert.equal(fs.readFileSync(target, 'utf8'), 'private');
  },
);
