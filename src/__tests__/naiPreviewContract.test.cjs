const assert = require('node:assert/strict');
const { test } = require('node:test');
const JSZip = require('jszip');
const {
  buildPreviewImageRequest,
  readPreviewPNGZip,
} = require('../renderer/backends/genVendors/naiPreviewContract');
const fixture = require('./fixtures/nai/modern-draft.json');
const expected = require('./fixtures/nai/modern-request.json');
const draft = () => structuredClone(fixture);
const project = (value) =>
  buildPreviewImageRequest(value, 'fixture-model-not-for-api');

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('offline request projection matches the reviewed fixture, keeps seed zero, and does no fetch', (t) => {
  t.mock.method(global, 'fetch', () => {
    throw new Error('unexpected network');
  });
  const input = freeze(draft());
  assert.deepEqual(project(input), expected);
  assert.deepEqual(project(input), project(input));
  assert.deepEqual(input, fixture);
  assert.equal(project(input).parameters.seed, 0);
});

test('character reordering and disabling keep positive/negative prompts aligned', () => {
  const value = draft();
  value.characters.reverse();
  const output = project(value).parameters;
  assert.deepEqual(
    output.v4_prompt.caption.char_captions.map((c) => c.char_caption),
    ['person, blue coat', 'person, red coat'],
  );
  assert.deepEqual(
    output.v4_negative_prompt.caption.char_captions.map((c) => c.char_caption),
    ['scarf', 'hat'],
  );
  assert.deepEqual(output.v4_prompt.caption.char_captions[0].centers, [
    { x: 0.7, y: 0.5 },
  ]);
  output.v4_prompt.caption.char_captions[0].centers[0].x = 0;
  assert.equal(value.characters[0].position.x, 0.7);
  assert.equal(
    output.v4_negative_prompt.caption.char_captions[0].centers[0].x,
    0.7,
  );
});

test('auto placement does not apply stale manual positions', () => {
  const value = draft();
  value.placement = 'auto';
  const output = project(value).parameters;
  assert.equal(output.v4_prompt.use_coords, false);
  assert.deepEqual(
    output.v4_prompt.caption.char_captions.map((c) => c.centers),
    [[], []],
  );
  assert.deepEqual(value, { ...fixture, placement: 'auto' });
});

test('character count policy is family-specific and counts only enabled characters', () => {
  const value = draft();
  value.placement = 'auto';
  for (const [family, limit] of [
    ['v4.5', 6],
    ['v5', 22],
  ]) {
    value.family = family;
    value.characters = Array.from({ length: limit }, (_, i) => ({
      id: String(i),
      enabled: true,
      prompt: 'fixture person',
      negativePrompt: '',
    }));
    assert.equal(
      project(value).parameters.v4_prompt.caption.char_captions.length,
      limit,
    );
    value.characters.push({
      id: 'extra',
      enabled: true,
      prompt: 'extra',
      negativePrompt: '',
    });
    assert.throws(() => project(value), /Too many/);
    value.characters.at(-1).enabled = false;
    assert.equal(
      project(value).parameters.v4_prompt.caption.char_captions.length,
      limit,
    );
  }
});

test('unsupported drafts, ambiguous inline syntax and invalid positions fail explicitly', () => {
  for (const patch of [
    { version: 2 },
    { family: 'unknown' },
    { family: 'toString' },
    { prompt: 'base | character' },
    { placement: 'invalid' },
  ])
    assert.throws(() => project(Object.assign(draft(), patch)));
  for (const position of [undefined, { x: NaN, y: 0.5 }, { x: 0.3, y: 2 }]) {
    const value = draft();
    value.characters[0].position = position;
    assert.throws(() => project(value));
  }
  const duplicate = draft();
  duplicate.characters[2].id = duplicate.characters[0].id;
  assert.throws(() => project(duplicate), /unique/);
  const empty = draft();
  empty.characters[0].prompt = ' ';
  assert.throws(() => project(empty), /empty/);
});

test('local numeric policy rejects invalid values without inventing an API default', () => {
  for (const patch of [
    { seed: -1 },
    { seed: 0x100000000 },
    { seed: 0.1 },
    { steps: NaN },
    { width: 0 },
    { height: 1.5 },
    { guidance: Infinity },
    { cfgRescale: 2 },
  ])
    assert.throws(() => project(Object.assign(draft(), patch)));
  assert.throws(() => buildPreviewImageRequest(draft(), ''), /Explicit/);
  const body = project(draft());
  assert.equal(Object.hasOwn(body, 'action'), false);
  assert.equal(Object.hasOwn(body.parameters, 'params_version'), false);
});

function pngWithMetadata() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAAL0lEQVR4nO3NQQkAAAgEsEtnK9NZzBQ+hMH+S/WcikAgEAgEAoFAIBAIBAKB4FOwYx8kiE+dRPgAAAAASUVORK5CYII=',
    'base64',
  );
  const payload = Buffer.from('Comment\0{"seed":0,"fixture":true}');
  const typeAndData = Buffer.concat([Buffer.from('tEXt'), payload]);
  let crc = 0xffffffff;
  for (const byte of typeAndData) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([
    png.subarray(0, -12),
    length,
    typeAndData,
    checksum,
    png.subarray(-12),
  ]);
}

test('ZIP response selects the PNG after folders/text and preserves all metadata bytes', async () => {
  const original = pngWithMetadata();
  const zip = new JSZip();
  zip.folder('result');
  zip.file('readme.txt', 'synthetic fixture');
  zip.file('result/image.png', original);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  assert.deepEqual(Buffer.from(await readPreviewPNGZip(bytes)), original);
});

test('malformed, empty, invalid PNG and ambiguous multi-image ZIP responses fail', async () => {
  await assert.rejects(readPreviewPNGZip(new Uint8Array([0, 1, 2])));
  for (const files of [
    {},
    { 'not-image.png': 'invalid' },
    { 'one.png': pngWithMetadata(), 'two.png': pngWithMetadata() },
  ]) {
    const zip = new JSZip();
    Object.entries(files).forEach(([name, content]) => zip.file(name, content));
    await assert.rejects(
      readPreviewPNGZip(await zip.generateAsync({ type: 'uint8array' })),
    );
  }
});

test('inline syntax is rejected in every prompt field, including disabled character notes', () => {
  for (const field of ['prompt', 'negativePrompt']) {
    const input = draft();
    input[field] = 'left | right';
    assert.throws(() => project(input), /Inline/);
  }
  for (const index of [0, 1])
    for (const field of ['prompt', 'negativePrompt']) {
      const input = draft();
      input.characters[index][field] = 'left | right';
      assert.throws(() => project(input), /Inline/);
    }
});

test('a base-free character draft is allowed but an empty positive request is rejected', () => {
  const input = draft();
  input.prompt = '';
  assert.equal(project(input).input, '');
  input.characters.forEach((character) => {
    character.enabled = false;
  });
  assert.throws(() => project(input), /base prompt or active character/);
  input.prompt = 'landscape';
  assert.equal(project(input).input, 'landscape');
});
