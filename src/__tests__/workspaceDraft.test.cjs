const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  createWorkspaceState,
  projectWorkspaceDraft,
  moveWorkspaceCharacter,
  previewErrorMessage,
} = require('../renderer/preview/workspaceDraft');
const { MockBackend } = require('../renderer/backends/mockBackend');

test('workspace starts with independent memory drafts and explicit placeholder IDs', () => {
  const first = createWorkspaceState();
  const second = createWorkspaceState();
  first.draft.characters[0].prompt = 'edited';
  assert.notEqual(second.draft.characters[0].prompt, 'edited');
  const request = projectWorkspaceDraft(second.draft);
  assert.equal(request.parameters.seed, 0);
  assert.equal(request.model, 'fixture-model-not-for-api');
  assert.equal(request.parameters.sampler, 'fixture-sampler');
  assert.equal(request.parameters.noise_schedule, 'fixture-noise-schedule');
});

test('grid selections remain source data and are projected without mutation', () => {
  const { draft } = createWorkspaceState();
  draft.placement = 'manual';
  draft.characters[0].cell = { row: 4, column: 0 };
  const before = structuredClone(draft);
  const request = projectWorkspaceDraft(draft).parameters;
  assert.deepEqual(request.v4_prompt.caption.char_captions[0].centers, [
    { x: 0.1, y: 0.9 },
  ]);
  assert.deepEqual(draft, before);
  draft.placement = 'auto';
  assert.deepEqual(
    projectWorkspaceDraft(draft).parameters.v4_prompt.caption.char_captions[0]
      .centers,
    [],
  );
  draft.characters[0].cell.column = 5;
  assert.throws(() => projectWorkspaceDraft(draft), /grid cell/);
});

test('moving or disabling a character preserves identity and matching negative prompts', () => {
  const { draft } = createWorkspaceState();
  const original = draft.characters;
  draft.characters = moveWorkspaceCharacter(
    draft.characters,
    'character-2',
    -1,
  );
  assert.equal(original[0].id, 'character-1');
  assert.equal(draft.characters[0].id, 'character-2');
  assert.deepEqual(
    projectWorkspaceDraft(
      draft,
    ).parameters.v4_negative_prompt.caption.char_captions.map(
      (x) => x.char_caption,
    ),
    ['scarf', 'hat'],
  );
  draft.characters[0].enabled = false;
  assert.equal(
    projectWorkspaceDraft(draft).parameters.v4_prompt.caption.char_captions
      .length,
    1,
  );
});

test('blank numeric fields are not silently treated as zero and all-empty positive input fails', () => {
  const { draft } = createWorkspaceState();
  draft.seed = '';
  assert.throws(() => projectWorkspaceDraft(draft), /seed/);
  draft.seed = '0';
  draft.prompt = '';
  draft.characters = [];
  assert.throws(() => projectWorkspaceDraft(draft), /base prompt/);
});

test('mock modern preview stays in memory and reports simulated failures without file writes', async (t) => {
  t.mock.method(global, 'fetch', () => {
    throw new Error('network forbidden');
  });
  const backend = new MockBackend();
  const request = projectWorkspaceDraft(createWorkspaceState().draft);
  const image = await backend.renderDraftPreview(request, 'success');
  assert.match(image, /^data:image\/svg\+xml/);
  assert.equal(backend.previewRequests.length, 1);
  request.parameters.seed = 88;
  assert.equal(backend.previewRequests[0].parameters.seed, 0);
  for (const scenario of ['prompt-length', 'connection'])
    await assert.rejects(backend.renderDraftPreview(request, scenario));
  assert.equal(backend.files.size, 0);
  assert.equal(backend.generations.length, 0);
});

test('error messages explain length and connection failures without inventing a token count', () => {
  assert.match(previewErrorMessage({ code: 'PROMPT_TOO_LONG' }), /입력 한도/);
  assert.doesNotMatch(
    previewErrorMessage({ code: 'PROMPT_TOO_LONG' }),
    /512|토큰/,
  );
  assert.match(previewErrorMessage({ code: 'CONNECTION' }), /입력은 그대로/);
});
