// Only synthetic images enter this temporary desktop profile.
const assert = require('node:assert/strict');
const { png } = require('../../src/__tests__/fixtures/nai/png.cjs');

module.exports = async ({
  evaluate,
  click,
  fill,
  until,
  checks,
  requestCount,
}) => {
  const auth = await evaluate(
    "window.electron.naiAuth.setToken('synthetic-never-a-real-token', false)",
  );
  assert.equal(auth.ok, true);
  await fill('[data-testid=live-prompt]', 'synthetic img2img');
  const sharp = require('../../release/app/node_modules/sharp');
  const base = sharp(png(2, 1, Buffer.from('distinct original')));
  const pick = async (bytes, format) => {
    await evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(${JSON.stringify(Array.from(bytes))})], 'fixture.' + '${format}', {type:'image/${format}'}));
      const picker = document.querySelector('[data-testid=metadata-file]');
      picker.files = transfer.files;
      picker.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    await until(() =>
      evaluate("document.querySelector('[data-testid=image-choice]')?.open"),
    );
  };
  const webp = await base
    .clone()
    .webp()
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>{"prompt":"webp xmp fixture","seed":0}</dc:description></rdf:Description></rdf:RDF></x:xmpmeta>',
    )
    .toBuffer();
  await pick(webp, 'webp');
  await click('[data-testid=image-use-metadata]');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=metadata-dialog] pre')?.textContent === 'webp xmp fixture'",
    ),
  );
  await click('[data-testid=metadata-dialog] header button');
  assert.equal(requestCount(), 0);
  checks.push('WebP XMP prompt previews locally without a generation request');
  const {
    fixture,
  } = require('../../src/__tests__/fixtures/nai/metadataPNG.cjs');
  const hidden = fixture(
    { Comment: { prompt: 'webp alpha fixture', seed: 0 } },
    { format: 'alpha' },
  );
  await pick(
    await sharp(hidden.bytes).webp({ lossless: true }).toBuffer(),
    'webp',
  );
  await click('[data-testid=image-use-metadata]');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=metadata-dialog] pre')?.textContent === 'webp alpha fixture'",
    ),
  );
  await click('[data-testid=metadata-dialog] header button');
  assert.equal(requestCount(), 0);
  checks.push(
    'WebP retaining stealth alpha bits previews the original caption without a request',
  );
  const original = await base.clone().jpeg().toBuffer();
  await pick(original, 'jpeg');
  await click('[data-testid=image-use-variation]');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=reference-panel] img')?.naturalWidth===832",
    ),
  );
  await fill('#variation-strength', '0.4');
  await fill('#variation-noise', '0.1');
  assert.equal(requestCount(), 0);
  assert.equal(
    await evaluate(
      "!!document.querySelector('[data-testid=reference-cost-badge]')",
    ),
    false,
  );
  checks.push(
    'selecting an img2img source shows a target-size preview and two controls without sending',
  );
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=prepare-generation]')?.disabled === false",
    ),
  );
  await click('[data-testid=prepare-generation]');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=generated-png]')?.naturalWidth===2",
    ),
  );
  const list = (await evaluate('window.electron.projects.list()')).value;
  const open = () =>
    evaluate(`window.electron.projects.open('${list[0].id}')`).then(
      (r) => r.value.project,
    );
  const first = (await open()).images[0];
  assert.equal(first.draft.img2img.sourceFormat, 'jpeg');
  assert.equal(first.binding.id, 'nai-v5-img2img-v1');
  assert.equal(first.draft.img2img.strength, 0.4);
  assert.equal(first.draft.img2img.noise, 0.1);
  checks.push(
    'one click stores the first variation with the selected strength and noise',
  );
  await until(() =>
    evaluate(
      "!document.querySelector('[data-testid=result-use-variation]').disabled",
    ),
  );
  await click('[data-testid=result-use-variation]');
  await until(() =>
    evaluate(
      "document.querySelector('#variation-strength')?.value==='0.4' && !document.querySelector('[data-testid=prepare-generation]').disabled",
    ),
  );
  assert.equal(requestCount(), 1);
  await click('[data-testid=prepare-generation]');
  await until(async () => (await open()).images.length === 2);
  const second = (await open()).images[1];
  assert.equal(second.draft.img2img.sourceHash, first.sha256);
  assert.notEqual(
    second.draft.img2img.sourceHash,
    first.draft.img2img.sourceHash,
  );
  assert.notEqual(second.id, first.id);
  assert.equal(requestCount(), 2);
  checks.push(
    'reusing the canvas result creates a second independent record and preserves the first',
  );
};
