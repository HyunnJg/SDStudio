const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { spawnSync } = require('node:child_process');
const JSZip = require('jszip');
const { png } = require('./fixtures/nai/png.cjs');
const tool = path.resolve(
  __dirname,
  '../../.erb/scripts/inspect-nai-response.cjs',
);
function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sdstudio-response-inspect-'),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const guard = path.join(root, 'guard.cjs');
  fs.writeFileSync(
    guard,
    `const Module=require('node:module'),load=Module._load;Module._load=function(name,...args){if(/^(node:)?(https?|http2|net|tls|electron|undici)$/.test(name)||name.includes('tokenStore'))throw Error('network or token module forbidden');return load.call(this,name,...args)};global.fetch=()=>{throw Error('fetch forbidden')};`,
  );
  return {
    root,
    run: (file) => {
      const r = spawnSync(
        process.execPath,
        ['-r', guard, tool, ...(file === undefined ? [] : [file])],
        { encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(r.stderr, '');
      return { status: r.status, report: JSON.parse(r.stdout), text: r.stdout };
    },
  };
}
test('local replay validates metadata PNG without network/token imports, writes or input changes', async (t) => {
  const f = fixture(t),
    file = path.join(f.root, 'synthetic-sensitive-name.zip');
  const archive = new JSZip();
  archive.file('image.png', png());
  fs.writeFileSync(
    file,
    await archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' }),
  );
  const bytes = fs.readFileSync(file),
    mtime = fs.statSync(file).mtimeMs,
    before = fs.readdirSync(f.root).sort();
  const r = f.run(file);
  assert.equal(r.status, 0);
  assert.deepEqual(r.report, {
    ok: true,
    zipBytes: bytes.length,
    pngBytes: png().length,
  });
  assert.equal(r.text.includes('sensitive'), false);
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.equal(fs.statSync(file).mtimeMs, mtime);
  assert.deepEqual(fs.readdirSync(f.root).sort(), before);
});
test('local replay reports only safe reason codes for a malformed response', (t) => {
  const f = fixture(t),
    file = path.join(f.root, 'synthetic-private-name.zip');
  fs.writeFileSync(file, 'synthetic-private-prompt-token-server-message');
  const r = f.run(file);
  assert.equal(r.status, 1);
  assert.deepEqual(r.report, {
    ok: false,
    zipBytes: fs.statSync(file).size,
    code: 'INVALID_IMAGE_RESPONSE',
    reason: 'zip-eocd',
  });
  assert.equal(r.text.includes('private'), false);
});
test('local replay bounds input before reading and sanitizes usage/filesystem failures', (t) => {
  const f = fixture(t),
    file = path.join(f.root, 'oversized.zip');
  fs.writeFileSync(file, '');
  fs.truncateSync(file, 64 * 1024 * 1024 + 1);
  const large = f.run(file);
  assert.equal(large.status, 2);
  assert.deepEqual(large.report, {
    ok: false,
    code: 'RESPONSE_TOO_LARGE',
    reason: 'response-compressed-limit',
  });
  for (const input of [
    undefined,
    f.root,
    path.join(f.root, 'synthetic-private-missing'),
  ]) {
    const r = f.run(input);
    assert.equal(r.status, 2);
    assert.deepEqual(r.report, { ok: false, code: 'INPUT_ERROR' });
    assert.equal(r.text.includes('private'), false);
  }
});
