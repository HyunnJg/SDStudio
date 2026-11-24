// Test only: exercise real renderer layout and bounded history reads without extra API requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { BrowserWindow, ipcMain } = require('electron');
const pause = () => new Promise((r) => setTimeout(r, 150));
exports.checkEditor = async ({
  contents,
  evaluate,
  click,
  fill,
  until,
  checks,
}) => {
  assert.equal(
    await evaluate("document.querySelector('[data-testid=ai-settings]').open"),
    false,
  );
  const prompt = await evaluate("document.querySelector('#live-prompt').value");
  const negative = await evaluate(
    "document.querySelector('#live-negative').value",
  );
  await evaluate(
    "[...document.querySelectorAll('.connected-prompt-tabs button')].find(b=>b.textContent==='부정 프롬프트').click()",
  );
  assert.equal(
    await evaluate(
      "document.querySelector('#live-prompt').hidden && !document.querySelector('#live-negative').hidden",
    ),
    true,
  );
  await evaluate(
    "document.querySelector('.connected-prompt-tabs button').click()",
  );
  assert.deepEqual(
    await evaluate(
      "[document.querySelector('#live-prompt').value,document.querySelector('#live-negative').value]",
    ),
    [prompt, negative],
  );
  await click('[data-testid=ai-settings] summary');
  assert.equal(
    await evaluate("document.querySelector('[data-testid=ai-settings]').open"),
    true,
  );
  const before = await evaluate(
    "(()=>{const r=document.querySelector('[data-testid=prepare-generation]').getBoundingClientRect();return [r.left,r.top,r.bottom]})()",
  );
  await evaluate(
    "document.querySelector('[data-testid=input-scroll]').scrollTop=100000",
  );
  await pause();
  assert.deepEqual(
    await evaluate(
      "(()=>{const r=document.querySelector('[data-testid=prepare-generation]').getBoundingClientRect();return [r.left,r.top,r.bottom]})()",
    ),
    before,
  );
  assert.equal(
    await evaluate(
      "(()=>{const b=document.querySelector('[data-testid=prepare-generation]'),r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b})()",
    ),
    true,
  );
  await evaluate(
    "document.querySelector('[data-testid=input-scroll]').scrollTop=0",
  );
  // Enable the right queue panel explicitly, rather than clicking invisible controls.
  await evaluate(
    "document.querySelectorAll('.connected-sidebar-tabs button')[1].click()",
  );
  checks.push(
    'prompt tabs retain text; AI settings initially collapsed; Generate remains reachable while editor scrolls',
  );
};
exports.checkGallery = async ({
  contents,
  evaluate,
  click,
  until,
  checks,
  profile,
  sourceProjectId,
}) => {
  // Thirty record UUIDs deliberately reuse one synthetic PNG: this measures IPC scheduling, not disk throughput.
  const root = path.join(profile, 'projects-v1');
  const source = JSON.parse(
    fs.readFileSync(path.join(root, sourceProjectId, 'project.json')),
  );
  assert.ok(source.images.length);
  const fixtureId = randomUUID(),
    dir = path.join(root, fixtureId);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'history'));
  const png = source.images[0];
  fs.copyFileSync(
    path.join(root, sourceProjectId, 'images', png.sha256 + '.png'),
    path.join(dir, 'images', png.sha256 + '.png'),
  );
  const fixture = {
    ...source,
    id: fixtureId,
    name: 'Synthetic layout gallery',
    images: Array.from({ length: 30 }, (_, i) => ({
      ...png,
      id: randomUUID(),
      seed: i,
    })),
  };
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(fixture));
  await evaluate(
    `(()=>{const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.__layoutURLs=new Set();window.__layoutURLRestore=()=>{URL.createObjectURL=create;URL.revokeObjectURL=revoke;};URL.createObjectURL=(blob)=>{const url=create(blob);window.__layoutURLs.add(url);return url;};URL.revokeObjectURL=(url)=>{window.__layoutURLs.delete(url);revoke(url);};})()`,
  );
  let reads = [];
  const event = 'workspace-generation-image';
  const listener = (_event, id, imageId) => {
    if (id === fixtureId) reads.push(imageId);
  };
  // handle invocations do not emit ipcMain events. Wrap the registered handler in this test process only.
  const original = ipcMain._invokeHandlers.get(event);
  assert.equal(typeof original, 'function');
  ipcMain.removeHandler(event);
  ipcMain.handle(event, (...args) => {
    listener(...args);
    return original(...args);
  });
  try {
    await click('[data-testid=project-list]');
    await until(() =>
      evaluate(
        `!!document.querySelector('[data-project-open="${fixtureId}"]')`,
      ),
    );
    await click(`[data-project-open="${fixtureId}"]`);
    await until(() =>
      evaluate("document.querySelectorAll('[data-image-id]').length===30"),
    );
    await evaluate(
      "document.querySelector('.connected-sidebar-tabs button').click()",
    );
    await until(() =>
      evaluate(
        "document.querySelectorAll('.connected-thumbnail img').length>=2",
      ),
    );
    await pause();
    assert.ok(
      reads.length > 0 && reads.length < 10,
      `Initial visible reads ${reads.length}`,
    );
    assert.ok(
      !reads.includes(fixture.images[0].id),
      'offscreen oldest PNG is not fetched',
    );
    const firstReads = reads.length;
    assert.ok(await evaluate('window.__layoutURLs.size<10'));
    await evaluate(
      "document.querySelector('.connected-history').parentElement.scrollTop=100000",
    );
    await until(() => reads.includes(fixture.images[0].id));
    await pause();
    assert.ok(reads.length < 20, `Scrolled visible reads ${reads.length}`);
    await click(`[data-image-id="${fixture.images[0].id}"]`);
    await until(() =>
      evaluate(
        "document.querySelector('[data-testid=generated-seed]').textContent.includes('시드 0')",
      ),
    );
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('.connected-thumbnail-preview img')).objectFit",
      ),
      'contain',
    );
    checks.push(
      `30-record gallery reads only visible thumbnails (${firstReads} initial IPC reads); scroll/select opens original-aspect PNG`,
    );
    const window = BrowserWindow.fromWebContents(contents);
    window.setMinimumSize(360, 500);
    window.setSize(390, 844);
    await until(() => evaluate('innerWidth===390'));
    // Current pane initially input; select a thumbnail to switch to canvas on small screens.
    await click(`[data-image-id="${fixture.images[0].id}"]`);
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('.connected-results')).display!== 'none'",
      ),
      true,
    );
    assert.equal(
      await evaluate('document.documentElement.scrollWidth<=innerWidth'),
      true,
    );
    await evaluate(
      "document.querySelector('.connected-mobile-switch').click()",
    );
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('.connected-input')).display!== 'none'",
      ),
      true,
    );
    assert.equal(
      await evaluate(
        "(()=>{const b=document.querySelector('[data-testid=prepare-generation]'),r=b.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)===b})()",
      ),
      true,
    );
    await evaluate(
      "document.querySelector('.connected-sidebar-toggle').click()",
    );
    assert.equal(
      await evaluate(
        "getComputedStyle(document.querySelector('#connected-sidebar')).display",
      ),
      'flex',
    );
    await evaluate(
      'document.querySelector(\'[aria-label="결과·씬 패널 닫기"]\').click()',
    );
    checks.push(
      '390px editor/canvas switch and sidebar drawer retain reachable fixed Generate with no horizontal overflow',
    );
    window.setSize(1400, 900);
    await until(() => evaluate('innerWidth===1400'));
    await evaluate(
      "document.querySelectorAll('.connected-sidebar-tabs button')[1].click()",
    );
    await until(() => evaluate('window.__layoutURLs.size<=1'));
    await click('[data-testid=project-new]');
    await until(() => evaluate('window.__layoutURLs.size===0'));
    checks.push(
      'hiding gallery releases thumbnail object URLs; replacing project releases canvas URL and stale gallery work',
    );
  } finally {
    await evaluate('window.__layoutURLRestore?.()');
    ipcMain.removeHandler(event);
    ipcMain.handle(event, original);
  }
};
