const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { dialog } = require('electron');
const JSZip = require('jszip');

module.exports = async ({
  evaluate,
  click,
  until,
  checks,
  folder = path.join(
    process.env.SDSTUDIO_USER_DATA_DIR,
    'SDStudio',
    'outs',
    'MaskCopy',
    'Garden',
  ),
  filename = 'picked.png',
  prompt = 'imported sky',
}) => {
  const bytes = fs.readFileSync(path.join(folder, filename));
  const selected = await evaluate(
    "document.querySelector('[data-image-id][aria-pressed=true]').dataset.imageId",
  );
  await click('[data-testid=result-use-metadata]');
  await until(() =>
    evaluate("!!document.querySelector('[data-import-field=prompt]:checked')"),
  );
  await click('[data-testid=apply-metadata]');
  await until(() =>
    evaluate(
      `document.querySelector('#live-prompt').value===${JSON.stringify(prompt)}`,
    ),
  );
  assert.equal(
    await evaluate(
      "!!document.querySelector('[data-testid=legacy-copy-notice]')",
    ),
    false,
  );
  await evaluate(
    "(()=>{const s=document.querySelector('#live-model');s.value='nai-diffusion-5-full';s.dispatchEvent(new Event('change',{bubbles:true}));})()",
  );
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=result-use-reference]').matches(':enabled')",
    ),
  );
  await click('[data-testid=result-use-reference]');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=reference-panel] img')?.naturalWidth>0",
    ),
  );
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=result-use-variation]').matches(':enabled')",
    ),
  );
  await click('[data-testid=result-use-variation]');
  await until(() =>
    evaluate(
      "[...document.querySelectorAll('[data-testid=reference-panel] img')].filter(i=>i.naturalWidth>0).length===2",
    ),
  );
  await click('[data-testid=project-save]');
  await until(() =>
    evaluate(
      "!!document.querySelector('[data-testid=project-dirty] [aria-label=저장됨]')",
    ),
  );
  const copy = await evaluate(
    "(async()=>{const name=document.querySelector('#workspace-project-name').value;const list=await window.electron.projects.list();const p=list.value.find(row=>row.name===name);return (await window.electron.projects.open(p.id)).value.project;})()",
  );
  const { draft } = copy.scenes.find((s) => s.id === copy.selectedSceneId);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(draft.reference.sourceHash, hash);
  assert.equal(draft.img2img.sourceHash, hash);
  checks.push(
    'a V3 pick supplies embedded metadata, a V5 reference and an img2img source with the original hash',
  );

  await click('[data-testid=trash-result]');
  await until(() =>
    evaluate(`!document.querySelector('[data-image-id="${selected}"]')`),
  );
  await click('[data-testid=open-result-trash]');
  const restore = `[data-restore-result="${selected}"]`;
  await until(() => evaluate(`!!document.querySelector('${restore}')`));
  await click(restore);
  await until(() => evaluate(`!document.querySelector('${restore}')`));
  await click('[data-testid=result-trash-close]');
  await until(() =>
    evaluate(
      "document.querySelector('.gallery-export button[aria-pressed]')?.textContent.includes('(2)')",
    ),
  );
  await click('.gallery-export button[aria-pressed]');
  await until(() =>
    evaluate(
      "document.querySelector('[data-testid=gallery-save]')?.textContent.includes('ZIP')",
    ),
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sdstudio-pick-export-'),
  );
  const output = path.join(directory, 'picks.zip');
  const choose = dialog.showSaveDialog;
  try {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
    await click('[data-testid=gallery-save]');
    await until(() => fs.existsSync(output));
    const zip = await JSZip.loadAsync(fs.readFileSync(output), {
      checkCRC32: true,
    });
    assert.equal(Object.keys(zip.files).length, 2);
    for (const [i, image] of copy.images.entries()) {
      const entry = zip.file(
        `${String(i + 1).padStart(3, '0')}-v3-${image.id}.png`,
      );
      assert.deepEqual(
        await entry.async('nodebuffer'),
        fs.readFileSync(path.join(folder, image.filename)),
      );
    }
  } finally {
    dialog.showSaveDialog = choose;
    fs.rmSync(directory, { recursive: true, force: true });
  }
  checks.push(
    'restored the V3 pick from trash and exported both original PNGs byte-for-byte through the gallery',
  );
};
