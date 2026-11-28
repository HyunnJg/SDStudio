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
  const channels = new Map();
  const event = { sender: {} };
  register(
    {
      handle: (channel, action) => channels.set(channel, action),
    },
    read,
    offline,
    trusted,
    send,
  );
  const invoke = (r = request, id) =>
    channels.get('gemini-suggest-cuts')(event, r, id);
  invoke.cancel = (id, owner = event) =>
    channels.get('vibe-cancel-cuts')(owner, id);
  return invoke;
}

test('cancel during key read frees the slot and a late completion cannot unlock its replacement', async () => {
  const firstId = crypto.randomUUID(),
    secondId = crypto.randomUUID();
  const reads = [];
  let sends = 0;
  const suggest = handler({
    read: () => new Promise((resolve) => reads.push(resolve)),
    send: async () => {
      sends++;
      return reply({ cuts, repeats: 1 });
    },
    trusted: (event) => !event.untrusted,
  });
  const first = suggest(request, firstId);
  assert.equal(suggest.cancel(firstId, { sender: {} }), false);
  assert.equal(suggest.cancel(firstId, { untrusted: true }), false);
  assert.equal(suggest.cancel(secondId), false);
  assert.equal(suggest.cancel(firstId), true);
  const next = suggest({ ...request, provider: 'vertex' }, secondId);
  assert.equal(suggest.cancel(firstId), false);
  reads[0]('fixture');
  assert.match((await first).message, /취소/);
  assert.equal(sends, 0);
  assert.match((await suggest()).message, /처리 중/);
  reads[1]('fixture');
  assert.equal((await next).ok, true);
  assert.equal(sends, 1);
});

test('cancel aborts an in-flight Flex fetch and discards a late successful response', async () => {
  let signal, finish;
  const suggest = handler({
    send: async (_, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const id = crypto.randomUUID();
  const pending = suggest(
    { ...request, model: 'gemini-3.8-flash', tier: 'flex' },
    id,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(suggest.cancel(id), true);
  assert.equal(signal.aborted, true);
  finish(reply({ cuts, repeats: 2 }));
  assert.match((await pending).message, /취소/);
  assert.equal(suggest.cancel(id), false);
});

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
  assert.deepEqual(result, {
    ok: true,
    suggestion: { cuts, repeats: 2 },
    httpStatus: 200,
  });
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

test('selected provider binds its own key, exact model, endpoint, and reply format', async () => {
  const plan = { cuts, repeats: 2 };
  for (const [provider, model, origin] of [
    ['vertex', 'gemini-3.5-flash', 'https://aiplatform.googleapis.com'],
    ['openai', 'gpt-4.1-mini', 'https://api.openai.com'],
    ['anthropic', 'claude-sonnet-4-6', 'https://api.anthropic.com'],
    ['openrouter', 'vendor/custom-model:free', 'https://openrouter.ai'],
  ]) {
    const key = 'fixture-' + provider;
    const suggest = handler({
      read: async (selected) => {
        assert.equal(selected, provider);
        return key;
      },
      send: async (url, options) => {
        assert.equal(new URL(url).origin, origin);
        assert.equal(options.redirect, 'error');
        const body = JSON.parse(options.body);
        if (provider === 'vertex') {
          assert.equal(
            new URL(url).pathname,
            '/v1/publishers/google/models/' + model + ':generateContent',
          );
          assert.equal(options.headers['x-goog-api-key'], key);
          return reply(plan);
        }
        assert.equal(body.model, model);
        if (provider === 'anthropic') {
          assert.equal(options.headers['x-api-key'], key);
          return Response.json({
            model,
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify(plan) }],
          });
        }
        assert.equal(options.headers.Authorization, 'Bearer ' + key);
        return Response.json({
          model,
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(plan) },
            },
          ],
        });
      },
    });
    const result = await suggest({ ...request, provider, model });
    assert.equal(result.ok, true);
    assert.equal(result.httpStatus, 200);
    assert.deepEqual(result.suggestion, plan);
    if (provider !== 'vertex') assert.equal(result.responseModel, model);
  }
});
test('Anthropic and OpenRouter accept one fenced JSON plan and still validate the entire response', async () => {
  const plan = { cuts, repeats: 2 };
  const json = JSON.stringify(plan);
  const fenced = '```json\n' + json + '\n```';
  for (const provider of ['anthropic', 'openrouter']) {
    for (const [content, ok] of [
      [fenced, true],
      ['  ```\r\n' + json + '\r\n```  ', true],
      ['Here is a plan:\n' + fenced, false],
      [fenced + '\nextra text', false],
      [fenced + '\n' + fenced, false],
      ['```json\n' + json, false],
      ['```json\n{"cuts":[],"repeats":1}\n```', false],
    ]) {
      const response =
        provider === 'anthropic'
          ? {
              stop_reason: 'end_turn',
              content: [{ type: 'text', text: content }],
            }
          : { choices: [{ finish_reason: 'stop', message: { content } }] };
      const suggest = handler({ send: async () => Response.json(response) });
      const result = await suggest({ ...request, provider });
      assert.equal(result.ok, ok);
      assert.deepEqual(result.suggestion, ok ? plan : undefined);
    }
  }
});

test('invalid model paths and recognized keys for a different provider are rejected locally', async () => {
  let calls = 0;
  for (const [provider, model, key] of [
    ['vertex', '../x', 'key'],
    ['openrouter', 'a/b?x=y', 'key'],
    ['openai', 'gpt-4.1', 'sk-or-test'],
    ['anthropic', 'abc', 'sk-openai-test'],
    ['openrouter', 'google/model', 'sk-ant-test'],
    ['gemini', 'test', 'sk-or-test'],
  ]) {
    const result = await handler({
      read: async () => key,
      send: async () => {
        calls++;
        return reply({ cuts, repeats: 0 });
      },
    })({ ...request, provider, model });
    assert.equal(result.ok, false);
  }
  assert.equal(calls, 0);
});

test('a Vertex service account signs a short-lived assertion for Google and sends only its access token to the project endpoint', async () => {
  const { generateKeyPairSync, verify } = require('node:crypto');
  const { normalizeVertexAccount } = require('../main/vertexAccount');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const account = {
    type: 'service_account',
    project_id: 'demo-project',
    client_email: 'studio@demo-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    private_key_id: 'synthetic1',
    client_id: 'unused',
    universe_domain: 'googleapis.com',
  };
  const normalized = normalizeVertexAccount(JSON.stringify(account));
  assert.ok(!normalized.includes('unused'));
  assert.throws(() =>
    normalizeVertexAccount(
      JSON.stringify({ ...account, token_uri: 'https://example.test/token' }),
    ),
  );
  assert.throws(() =>
    normalizeVertexAccount(
      JSON.stringify({ ...account, private_key: 'invalid' }),
    ),
  );
  let calls = 0;
  const suggest = handler({
    read: async () => normalized,
    send: async (url, options) => {
      calls++;
      if (calls === 1) {
        assert.equal(url, 'https://oauth2.googleapis.com/token');
        assert.equal(options.redirect, 'error');
        const [header, payload, signature] = options.body
          .get('assertion')
          .split('.');
        assert.equal(
          JSON.parse(Buffer.from(header, 'base64url')).kid,
          account.private_key_id,
        );
        const claims = JSON.parse(Buffer.from(payload, 'base64url'));
        assert.equal(claims.aud, url);
        assert.equal(claims.iss, account.client_email);
        assert.equal(claims.exp - claims.iat, 3600);
        assert.ok(
          verify(
            'RSA-SHA256',
            Buffer.from(header + '.' + payload),
            publicKey,
            Buffer.from(signature, 'base64url'),
          ),
        );
        return Response.json({
          access_token: 'fake-access-token',
          token_type: 'Bearer',
        });
      }
      assert.equal(
        url,
        'https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent',
      );
      assert.equal(options.headers.Authorization, 'Bearer fake-access-token');
      assert.equal(
        options.headers['X-Vertex-AI-LLM-Shared-Request-Type'],
        'flex',
      );
      const b = JSON.parse(options.body);
      assert.equal(b.generationConfig.topP, 0.9);
      assert.equal(b.generationConfig.responseMimeType, 'application/json');
      assert.doesNotMatch(options.body, /PRIVATE KEY|gserviceaccount/);
      return reply({ cuts, repeats: 1 });
    },
  });
  assert.ok(
    (
      await suggest({
        ...request,
        provider: 'vertexAccount',
        tier: 'flex',
        extraBody: '{"generationConfig":{"topP":0.9}}',
      })
    ).ok,
  );
  assert.equal(calls, 2);

  const endpoints = [];
  let finishAuth, oauthSignal;
  const interrupted = handler({
    read: async () => normalized,
    send: async (url, options) => {
      endpoints.push(url);
      oauthSignal = options.signal;
      return new Promise((resolve) => {
        finishAuth = resolve;
      });
    },
  });
  const id = crypto.randomUUID();
  const pending = interrupted({ ...request, provider: 'vertexAccount' }, id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(interrupted.cancel(id), true);
  assert.equal(oauthSignal.aborted, true);
  finishAuth(Response.json({ access_token: 'fixture', token_type: 'Bearer' }));
  assert.match((await pending).message, /취소/);
  assert.deepEqual(endpoints, ['https://oauth2.googleapis.com/token']);
});

test('tiers and body controls follow the selected provider and model before any credential read', async () => {
  for (const [provider, model, tier, extraBody] of [
    ['openai', 'gpt-6.2-astra', 'flex', '{}'],
    ['anthropic', 'claude-haiku-5-5', 'fast', '{}'],
    ['vertexAccount', 'gemini-4-neon', 'flex', '{}'],
    [
      'gemini',
      'gemini-4-carbon',
      'flex',
      '{"generationConfig":{"responseSchema":{}}}',
    ],
    ['openrouter', 'openai/gpt-6-luna', 'flex', '{"messages":[]}'],
    ['openai', 'gpt-6-luna', '', '{"store":true}'],
    ['openai', 'gpt-6-luna', '', '{"temperature":"wrong"}'],
    ['gemini', 'gemini-3.8-flash', '', '{'],
  ]) {
    let reads = 0;
    const result = await handler({
      read: async () => {
        reads++;
        return 'key';
      },
      send: async () => reply({ cuts, repeats: 1 }),
    })({ ...request, provider, model, tier, extraBody });
    assert.equal(result.ok, false);
    assert.equal(reads, 0);
  }
  for (const [provider, model, tier, extra, expected] of [
    [
      'gemini',
      'gemini-4-carbon',
      'priority',
      { generationConfig: { maxOutputTokens: 1234 } },
      { serviceTier: 'priority' },
    ],
    [
      'openai',
      'gpt-6.2-sol',
      'fast',
      { reasoning_effort: 'low' },
      { service_tier: 'fast', reasoning_effort: 'low' },
    ],
    [
      'anthropic',
      'claude-fable-5-2',
      'fast',
      { output_config: { effort: 'high' } },
      { speed: 'fast', output_config: { effort: 'high' } },
    ],
    [
      'openrouter',
      'anthropic/claude-opus-5.5',
      'priority',
      { max_completion_tokens: 1024 },
      { service_tier: 'priority', max_completion_tokens: 1024 },
    ],
  ]) {
    let body;
    await handler({
      send: async (_, options) => {
        body = JSON.parse(options.body);
        return new Response(null, { status: 429 });
      },
    })({ ...request, provider, model, tier, extraBody: JSON.stringify(extra) });
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(body[k], v);
    if (provider === 'gemini')
      assert.equal(body.generationConfig.maxOutputTokens, 1234);
  }
});
