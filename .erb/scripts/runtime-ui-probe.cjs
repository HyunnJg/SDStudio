// Invoked only by an explicitly enabled, disposable generation smoke harness.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, clipboard, nativeImage } = require('electron');
const { createRequire } = require('node:module');
const { png } = require('../../src/__tests__/fixtures/nai/png.cjs');
module.exports = async function runtimeUIProbe(contents, profile) {
  const relative = 'synthetic-runtime-clipboard.png';
  const file = path.join(profile, 'SDStudio', relative);
  fs.writeFileSync(file, png());
  const runtimeRequire = app.isPackaged
    ? createRequire(path.join(app.getAppPath(), 'package.json'))
    : createRequire(path.resolve(__dirname, '../../release/app/package.json'));
  const sharp = runtimeRequire('sharp');
  const sharpPNG = await sharp(png()).png().toBuffer();
  const metadata = await sharp(sharpPNG).metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 1);
  const consoleDetails = new Promise((resolve) => {
    const listener = (details) => {
      if (details.message !== 'synthetic-runtime-console-probe') return;
      contents.removeListener('console-message', listener);
      resolve(details.level);
    };
    contents.on('console-message', listener);
  });
  await contents.executeJavaScript(
    "console.warn('synthetic-runtime-console-probe')",
  );
  assert.equal(await consoleDetails, 'warning');
  try {
    await contents.executeJavaScript(
      `window.electron.ipcRenderer.invoke('copy-image-to-clipboard', ${JSON.stringify(relative)})`,
    );
    const items = await clipboard.read();
    const item = items.find((value) => value.types.includes('image/png'));
    assert.ok(item);
    const blob = await item.getType('image/png');
    const image = nativeImage.createFromBuffer(
      Buffer.from(await blob.arrayBuffer()),
    );
    assert.deepEqual(image.getSize(), { width: 2, height: 1 });
    const before = Buffer.from(await blob.arrayBuffer());
    const invalid = 'synthetic-runtime-invalid.png';
    const invalidFile = path.join(profile, 'SDStudio', invalid);
    fs.writeFileSync(invalidFile, 'synthetic non-image');
    try {
      for (const name of ['synthetic-runtime-missing.png', invalid]) {
        const outcome = await contents.executeJavaScript(
          `(async()=>{try {await window.electron.ipcRenderer.invoke('copy-image-to-clipboard', ${JSON.stringify(name)}); return 'unexpected-success';} catch (error) {return error.message.includes('IMAGE_NOT_READABLE') ? 'rejected' : 'unexpected-error';}})()`,
        );
        assert.equal(outcome, 'rejected');
        const preserved = (await clipboard.read()).find((entry) =>
          entry.types.includes('image/png'),
        );
        assert.ok(preserved);
        assert.deepEqual(
          Buffer.from(
            await (await preserved.getType('image/png')).arrayBuffer(),
          ),
          before,
        );
      }
    } finally {
      fs.unlinkSync(invalidFile);
    }
    fs.writeFileSync(
      process.env.SDSTUDIO_RUNTIME_REPORT,
      JSON.stringify({
        electron: process.versions.electron,
        node: process.versions.node,
        clipboardPNG: true,
        missingAndCorruptRejected: true,
        previousClipboardPreserved: true,
        sharpPNG: true,
        sharp: sharp.versions.sharp,
        libvips: sharp.versions.vips,
        consoleDetails: true,
        isPackaged: app.isPackaged,
        bytes: blob.size,
      }),
    );
  } finally {
    fs.unlinkSync(file);
  }
};
