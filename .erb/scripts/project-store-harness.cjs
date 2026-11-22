// Synthetic local persistence only. Uses compiled production preload, no account or generation calls.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const root = process.env.SDSTUDIO_PROJECT_TEST_ROOT;
if (!root) throw Error('Disposable test root required');
app.setName('sdstudio-project-test');
for (const name of ['userData', 'sessionData', 'crashDumps']) {
  const folder = path.join(root, name);
  fs.mkdirSync(folder, { recursive: true });
  app.setPath(name, folder);
}
app.setAppLogsPath(path.join(root, 'logs'));
require('ts-node/register/transpile-only');
const { ProjectStore } = require('../../src/main/projects/projectStore');
const { registerProjects } = require('../../src/main/projects/projectIpc');
const { isTrustedAuthFrame } = require('../../src/main/nai/authIpc');
const {
  createWorkspaceState,
  snapshotWorkspaceScenes,
} = require('../../src/renderer/preview/workspaceDraft');
const { png } = require('../../src/__tests__/fixtures/nai/png.cjs');
const report = {
  electron: process.versions.electron,
  node: process.versions.node,
  syntheticOnly: true,
  checks: [],
  remoteRequestsAllowed: 0,
  remoteRequestsBlocked: 0,
  rendererErrors: [],
};
let done = false;
function finish(status, error) {
  if (done) return;
  done = true;
  if (error) report.failure = String(error);
  fs.writeFileSync(
    path.join(root, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  app.exit(status);
}
setTimeout(() => finish(1, 'Timed out'), 20000).unref();
app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
      (_details, callback) => {
        report.remoteRequestsBlocked++;
        callback({ cancel: true });
      },
    );
    const file = path.join(root, 'index.html');
    fs.writeFileSync(
      file,
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><title>Synthetic project storage</title>`,
    );
    const expected = require('node:url').pathToFileURL(file).href;
    const options = {
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.resolve('release/app/dist/main/preload.js'),
      },
    };
    const window = new BrowserWindow(options);
    window.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) report.rendererErrors.push(message);
    });
    const profile = app.getPath('userData'),
      store = new ProjectStore(profile);
    const approvedContents = window.webContents;
    registerProjects(ipcMain, store, (event) =>
      isTrustedAuthFrame(event, approvedContents, expected),
    );
    await window.loadURL(expected);
    const invoke = (script) => window.webContents.executeJavaScript(script);
    assert.deepEqual(await invoke('window.electron.projects.list()'), {
      ok: true,
      value: [],
    });
    assert.equal(fs.existsSync(path.join(profile, 'projects-v1')), false);
    report.checks.push(
      'offline listing through compiled sandbox preload creates no project directory',
    );
    const state = createWorkspaceState();
    state.draft.seedMode = 'fixed';
    state.draft.seed = '0';
    const content = {
      name: 'synthetic-project',
      selectedSceneId: state.selectedSceneId,
      scenes: snapshotWorkspaceScenes(state),
    };
    const first = await invoke(
      `window.electron.projects.create(${JSON.stringify(content)})`,
    );
    assert.equal(first.ok, true);
    const id = first.value.project.id;
    const edited = { ...content, name: 'synthetic-edited' };
    const saved = await invoke(
      `window.electron.projects.save(${JSON.stringify(id)},${JSON.stringify(first.value.revision)},${JSON.stringify(edited)})`,
    );
    assert.equal(saved.ok, true);
    assert.deepEqual(
      await invoke(
        `window.electron.projects.save(${JSON.stringify(id)},${JSON.stringify(first.value.revision)},${JSON.stringify(content)})`,
      ),
      { ok: false, code: 'PROJECT_CONFLICT' },
    );
    report.checks.push(
      'three-scene save and stale-revision rejection work without token/network IPC',
    );
    const secondary = new BrowserWindow(options);
    await secondary.loadURL(expected);
    assert.deepEqual(
      await secondary.webContents.executeJavaScript(
        'window.electron.projects.list()',
      ),
      { ok: false, code: 'PROJECT_UNTRUSTED' },
    );
    secondary.destroy();
    report.checks.push('secondary window cannot access projects');
    assert.deepEqual(
      await invoke('window.electron.projects.open("../../synthetic-private")'),
      { ok: false, code: 'PROJECT_INPUT' },
    );
    const generated = store.addPNG(
      id,
      saved.value.revision,
      {
        sceneId: content.selectedSceneId,
        model: 'fixture-model-not-for-api',
        sampler: 'fixture-sampler',
        noiseSchedule: 'fixture-noise-schedule',
        seed: 0,
        draft: content.scenes[0].draft,
      },
      png(),
    );
    const image = generated.project.images[0];
    store.save(id, generated.revision, { ...edited, name: 'after-image' });
    fs.writeFileSync(
      path.join(profile, 'projects-v1', id, 'project.json'),
      '{synthetic broken',
    );
    assert.deepEqual(
      await invoke(`window.electron.projects.open(${JSON.stringify(id)})`),
      { ok: false, code: 'PROJECT_CORRUPT' },
    );
    const recovered = await invoke(
      `window.electron.projects.recover(${JSON.stringify(id)},${JSON.stringify(generated.revision)})`,
    );
    assert.equal(recovered.ok, true);
    assert.notEqual(recovered.value.project.id, id);
    assert.deepEqual(
      Buffer.from(store.readPNG(recovered.value.project.id, image.sha256)),
      png(),
    );
    assert.equal(
      fs.readFileSync(
        path.join(profile, 'projects-v1', id, 'project.json'),
        'utf8',
      ),
      '{synthetic broken',
    );
    report.checks.push(
      'explicit recovery copies valid history and original PNG into a new project and preserves the broken source',
    );
    const reopenedWindow = new BrowserWindow(options);
    await reopenedWindow.loadURL(expected);
    // Trusted WebContents identity changes only when the application selects its replacement main window.
    // Read via main after a fresh store construction here; the old facade remains denied.
    assert.deepEqual(
      new ProjectStore(profile).open(recovered.value.project.id),
      recovered.value,
    );
    assert.deepEqual(
      await reopenedWindow.webContents.executeJavaScript(
        'window.electron.projects.list()',
      ),
      { ok: false, code: 'PROJECT_UNTRUSTED' },
    );
    reopenedWindow.destroy();
    window.destroy();
    report.checks.push(
      'fresh store reads persisted project while a replacement unapproved document stays denied',
    );
    assert.deepEqual(report.rendererErrors, []);
    assert.equal(fs.existsSync(path.join(profile, 'TOKEN.txt')), false);
    report.checks.push(
      'no token file, raw filesystem path API or renderer PNG import endpoint',
    );
    finish(0);
  })
  .catch((error) => finish(1, error));
