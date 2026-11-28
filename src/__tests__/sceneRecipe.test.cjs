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
test('built-in emotions add editable cuts to a fresh workspace, and only to the chosen actor when present', (t) => {
  const React = require('react');
  const { act, create } = require('react-test-renderer');
  require.extensions['.css'] = () => {};
  const Panel = require('../renderer/componenets/SceneRecipePanel').default;
  const {
    createEmptyWorkspace,
  } = require('../renderer/generation/connectedDraft');
  const { scenes, draft } = createEmptyWorkspace();
  assert.equal(scenes.length, 1);
  assert.equal(draft.prompt, '');
  assert.equal(draft.negativePrompt, '');
  const names = [
    '기쁨',
    '슬픔',
    '분노',
    '공포',
    '놀람',
    '혐오',
    '신뢰',
    '기대',
    '당황',
    '질투',
  ];
  for (const withActors of [false, true]) {
    const scene = structuredClone(scenes[0]);
    scene.draft.prompt = 'quiet garden';
    if (withActors)
      scene.draft.characters = ['A', 'B'].map((id) => ({
        id,
        enabled: true,
        prompt: id,
        negativePrompt: '',
        cell: { row: 2, column: 2 },
      }));
    let renderer, result;
    act(() => {
      renderer = create(
        React.createElement(Panel, {
          presets: [],
          sources: [scene],
          base: scene,
          repeats: 2,
          canPrepare: true,
          onCreate: (rows) => {
            result = rows;
          },
        }),
      );
    });
    t.after(() => act(() => renderer.unmount()));
    const picker = renderer.root
      .findAllByType('details')
      .find(
        (p) =>
          p
            .findAllByType('summary')
            .some((s) => s.children[0] === '기본 감정 10종') &&
          p.findAllByType('summary').length === 1,
      );
    act(() =>
      picker
        .findAllByType('input')[0]
        .props.onChange({ target: { checked: true } }),
    );
    act(() => picker.findByType('button').props.onClick());
    if (withActors) {
      const select = renderer.root
        .findAllByType('select')
        .find((s) =>
          s.findAllByType('option').some((o) => o.props.value === 'B'),
        );
      act(() => select.props.onChange({ target: { value: 'B' } }));
    }
    act(() =>
      renderer.root
        .findByProps({ 'data-testid': 'prepare-recipe' })
        .props.onClick(),
    );
    assert.deepEqual(
      result.map((r) => r.name.split(' · ').pop()),
      names,
    );
    assert.equal(scene.draft.prompt, 'quiet garden');
    for (const row of result) {
      if (withActors) {
        assert.equal(row.draft.prompt, scene.draft.prompt);
        assert.equal(row.draft.characters[0].prompt, 'A');
        assert.match(row.draft.characters[1].prompt, /^B\n\n\S/);
      } else assert.match(row.draft.prompt, /^quiet garden, \S/);
    }
  }
});
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
test('multi pieces exclude only whitespace lines at import and when binding old drafts', () => {
  const text = ' dark hair \r\n \t\r\ngray hair\r\n';
  const piece = { key: 'art.hair', multi: true, text };
  const library = (prompt) => ({
    name: 'art',
    pieces: [{ name: 'hair', multi: true, prompt }],
  });
  const imported = require('../workspacePromptPieces').inspectPieceImport(
    library(text),
  );
  assert.equal(imported.ignored, 2);
  assert.equal(imported.pieces[0].text, ' dark hair \ngray hair');
  const draft = { ...base.draft, prompt: '<art.hair>', pieces: [piece] };
  const seen = new Set();
  for (let seed = 0; seed < 128; seed++) {
    const selected = expandDraft(draft, seed).prompt;
    seen.add(selected);
    assert.equal(
      expandDraft({ ...draft, pieces: imported.pieces }, seed).prompt,
      selected,
    );
  }
  assert.deepEqual(seen, new Set([' dark hair ', 'gray hair']));
  assert.throws(() => importPieces(library('\n \t')), /UNSUPPORTED_DRAFT/);
  assert.throws(
    () => expandDraft({ ...draft, pieces: [{ ...piece, text: '  \n' }] }, 1),
    /UNSUPPORTED_DRAFT/,
  );
  assert.equal(
    expandDraft({ ...draft, pieces: [{ ...piece, multi: false }] }, 1).prompt,
    text,
  );
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
