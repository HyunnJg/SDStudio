const test = require('node:test');
const assert = require('node:assert/strict');
const register = require('../main/geminiCuts').default;
const {
  blankRecipe,
  appendSuggestedCuts,
  buildRecipeScenes,
} = require('../renderer/generation/sceneRecipe');
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');

const request = {
  instruction: '표정 세 가지, 각각 두 장',
  style: 'watercolor',
  characters: ['A'],
};
const cuts = ['긴장', '웃음', '안도'].map((name, i) => ({
  name,
  setting: i === 2 ? 'close-up' : 'hall',
  emotion: ['tense', 'smile', 'relieved'][i],
}));
function reply(plan, reason = 'STOP') {
  return Response.json({
    candidates: [
      {
        finishReason: reason,
        content: {
          parts: [
            { thought: true, text: 'private thought' },
            { text: JSON.stringify(plan) },
          ],
        },
      },
    ],
  });
}
function handler({
  read = async () => 'fixture-key',
  send,
  offline = () => false,
  trusted = () => true,
}) {
  let invoke;
  register(
    {
      handle: (_, action) => {
        invoke = (r = request) => action({}, r);
      },
    },
    read,
    offline,
    trusted,
    send,
  );
  return invoke;
}

test('Gemini receives only selected labels and instruction, and returns editable cuts in order', async () => {
  let calls = 0;
  const suggest = handler({
    send: async (url, options) => {
      calls++;
      assert.equal(
        new URL(url).origin,
        'https://generativelanguage.googleapis.com',
      );
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
      const body = JSON.parse(options.body);
      assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), request);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      return reply({ cuts, repeats: 2 });
    },
  });
  const result = await suggest({
    ...request,
    reference: 'private-image',
    prompt: 'private appearance',
  });
  assert.deepEqual(result, { ok: true, suggestion: { cuts, repeats: 2 } });
  const recipe = appendSuggestedCuts(
    blankRecipe(),
    result.suggestion.cuts,
    true,
  );
  const [base] = createConnectedWorkspaceState().scenes;
  const actor = {
    id: 'a',
    prompt: 'original',
    enabled: true,
    negativePrompt: '',
    cell: { row: 2, column: 2 },
  };
  const scenes = buildRecipeScenes(
    recipe,
    { ...base, draft: { ...base.draft, characters: [actor] } },
    [],
    60,
    require('node:crypto').randomUUID,
  );
  assert.equal(scenes.length * result.suggestion.repeats, 6);
  assert.equal(scenes[2].draft.characters[0].prompt, 'original\n\nrelieved');
  assert.match(scenes[2].draft.prompt, /close-up$/);
  assert.equal(actor.prompt, 'original');
  assert.equal(calls, 1);
  assert.equal(
    appendSuggestedCuts(recipe, [cuts[0]], false).situations.length,
    4,
  );
  assert.throws(() =>
    appendSuggestedCuts(recipe, Array(58).fill(cuts[0]), false),
  );
});

test('offline, untrusted, invalid and duplicate calls cannot start a provider request', async () => {
  let reads = 0;
  let calls = 0;
  let release;
  const opts = {
    read: async () => {
      reads++;
      return 'key';
    },
    send: () => {
      calls++;
      return new Promise((resolve) => {
        release = () => resolve(reply({ cuts, repeats: 0 }));
      });
    },
  };
  assert.equal((await handler({ ...opts, offline: () => true })()).ok, false);
  assert.equal((await handler({ ...opts, trusted: () => false })()).ok, false);
  assert.equal(
    (await handler(opts)({ ...request, instruction: ' ' })).ok,
    false,
  );
  assert.equal(reads, 0);
  const suggest = handler(opts);
  const first = suggest();
  assert.equal((await suggest()).ok, false);
  assert.equal(calls, 1);
  release();
  assert.equal((await first).ok, true);
});

test('an older Gemini store containing a NovelAI token cannot send a request', async () => {
  let sends = 0;
  const result = await handler({
    read: async () => 'pst-synthetic-test-only',
    send: async () => {
      sends++;
      return reply({ cuts, repeats: 2 });
    },
  })();
  assert.equal(result.ok, false);
  assert.match(result.message, /NovelAI/);
  assert.equal(sends, 0);
});

test('a truncated response prompts smaller batches and supplies no partial cuts', async () => {
  const result = await handler({
    send: async () => reply({ cuts, repeats: 2 }, 'MAX_TOKENS'),
  })();
  assert.equal(result.ok, false);
  assert.match(result.message, /컷 수를 줄여/);
  assert.equal(result.suggestion, undefined);
});

test('oversized, malformed and rate limited replies produce only local error messages', async () => {
  for (const response of [
    reply({ cuts: [], repeats: 2 }),
    reply({ cuts, repeats: -1 }),
    reply({ cuts: [{ name: 'x', emotion: '', setting: '' }], repeats: 1 }),
    new Response('sensitive raw error', { status: 429 }),
    new Response('x'.repeat(262145)),
  ]) {
    const result = await handler({ send: async () => response })();
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /sensitive/);
    if (response.status === 429) assert.match(result.message, /429/);
  }
});
