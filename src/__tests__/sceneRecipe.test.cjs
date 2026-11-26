const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('crypto');
const { buildRecipeScenes } = require('../renderer/generation/sceneRecipe');
const { importPieces, expandDraft } = require('../workspacePromptPieces');
const { MODELS, draftSize, resolveSize } = require('../workspaceCatalog');
const { bindBasicGeneration } = require('../main/nai/workspaceBinding');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const base = createConnectedWorkspaceState().scenes[0];
test('two characters and two paired settings become four named independent queue scenes', () => {
  const presets = ['a', 'b'].map((id) => ({
    kind: 'character',
    id,
    name: id,
    prompt: id,
    negativePrompt: 'hat',
    deleted: false,
  }));
  const recipe = {
    name: 'travel',
    styleId: '',
    characterIds: ['a', 'b'],
    situations: [
      { name: 'garden', setting: 'garden', emotion: 'happy' },
      { name: 'rain', setting: 'raining', emotion: 'sad' },
    ],
  };
  const scenes = buildRecipeScenes(recipe, base, presets, 4, randomUUID);
  assert.equal(new Set(scenes.map((s) => s.id)).size, 4);
  assert.deepEqual(
    scenes.map((s) => s.name),
    [
      'travel · a · garden',
      'travel · a · rain',
      'travel · b · garden',
      'travel · b · rain',
    ],
  );
  assert.deepEqual(
    scenes.map((s) => s.draft.characters[0].prompt),
    ['a, happy', 'a, sad', 'b, happy', 'b, sad'],
  );
  assert.equal(scenes[0].draft.resolution, base.draft.resolution);
  assert.throws(() => buildRecipeScenes(recipe, base, [], 4, randomUUID));
  assert.throws(() => buildRecipeScenes(recipe, base, presets, 3, randomUUID));
});
test('cut preparation rejects ambiguous targets, missing I2I and unsafe paragraph replacement', () => {
  const actor = {
    id: 'actor',
    enabled: true,
    prompt: 'hair and clothing',
    negativePrompt: '',
    cell: { row: 2, column: 2 },
  };
  const draft = { ...base.draft, characters: [actor] };
  const cut = {
    name: 'shot',
    setting: '',
    emotion: 'overhead view',
    cutMode: 'append',
  };
  const make = (row, characters = [actor]) =>
    buildRecipeScenes(
      { name: 'shots', styleId: '', characterIds: [], situations: [row] },
      { ...base, draft: { ...draft, characters } },
      [],
      1,
      randomUUID,
    );
  assert.equal(
    make(cut)[0].draft.characters[0].prompt,
    'hair and clothing\n\noverhead view',
  );
  assert.throws(() => make({ ...cut, cutMode: 'replace' }), /빈 줄/);
  assert.throws(() => make(cut, [actor, { ...actor, id: 'another' }]), /카드/);
  assert.throws(() => make(cut, []), /카드/);
  assert.throws(() => make({ ...cut, img2imgStrength: '0' }), /변형 원본/);
  for (const invalid of ['1.01', '-0.1', 'NaN', '0x1'])
    assert.throws(() => make({ ...cut, img2imgStrength: invalid }));
  assert.deepEqual(make({ ...cut, included: false }), []);
});
test('model IDs, caption generations, sizes and medium effort constraints agree', () => {
  for (const model of Object.keys(MODELS)) {
    const draft = {
      ...base.draft,
      model,
      family: model.startsWith('nai-diffusion-5') ? 'v5' : 'v4.5',
      resolution: 'large_portrait',
    };
    const { request } = bindBasicGeneration({ ...base, draft });
    assert.equal(request.model, model);
    assert.deepEqual(
      [request.parameters.width, request.parameters.height],
      [1024, 1536],
    );
    const v3 = model.endsWith('-3');
    assert.equal('v4_prompt' in request.parameters, !v3);
    if (model.endsWith('medium')) {
      assert.equal(request.parameters.steps, 14);
      assert.ok(
        !request.parameters.negative_prompt.includes(base.draft.negativePrompt),
      );
    }
  }
  assert.deepEqual(
    draftSize({ ...base.draft, family: 'v4.5', resolution: 'square' }),
    { width: 512, height: 512 },
  );
  assert.throws(() => resolveSize('2000x2000'));
  assert.throws(() => resolveSize('2048x2048'));
});
test('V3 libraries, nested choices and weighted braces keep fixed seeds reproducible', () => {
  const pieces = importPieces({
    library: {
      art: {
        pieces: [
          { name: 'hair', prompt: '{red|blue} hair\nblack hair', multi: true },
        ],
      },
    },
  });
  const draft = {
    ...base.draft,
    pieces,
    prompt: '{{portrait}}, <art.hair>, ||day|night||',
  };
  const samples = Array.from(
    { length: 12 },
    (_, i) => expandDraft(draft, i).prompt,
  );
  assert.ok(new Set(samples).size > 2);
  assert.equal(expandDraft(draft, 0).prompt, samples[0]);
  samples.forEach((x) =>
    assert.match(x, /^\{\{portrait\}\}, (red|blue|black) hair, (day|night)$/),
  );
  assert.throws(() =>
    expandDraft(
      {
        ...draft,
        pieces: [{ key: 'art.hair', text: '<art.hair>', multi: false }],
      },
      1,
    ),
  );
  assert.throws(() => importPieces({ name: 'bad', pieces: [null] }));
});
test('a situation can target one character; missing character references block preparation', () => {
  const a = {
    kind: 'character',
    id: 'a',
    name: 'actor A',
    prompt: 'coat',
    negativePrompt: '',
    deleted: false,
  };
  const b = { ...a, id: 'b', name: 'actor B' };
  const scene = {
    ...base,
    draft: { ...base.draft, reference: { id: 'current' } },
  };
  const other = {
    ...base,
    draft: { ...base.draft, reference: { id: 'other' } },
  };
  const recipe = {
    name: 'set',
    styleId: '',
    characterIds: ['a', 'b'],
    referenceByCharacter: { a: 'other', b: 'none' },
    situations: [
      { name: 'both', setting: 'garden', emotion: '' },
      { name: 'A only', setting: 'boat', emotion: 'happy', characterId: 'a' },
    ],
  };
  const jobs = buildRecipeScenes(recipe, scene, [a, b], 3, randomUUID, [other]);
  assert.deepEqual(
    jobs.map((s) => s.draft.reference?.id),
    ['other', 'other', undefined],
  );
  assert.throws(
    () => buildRecipeScenes(recipe, scene, [a, b], 3, randomUUID, []),
    /참조/,
  );
});
