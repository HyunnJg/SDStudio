const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const {
  createConnectedWorkspaceState,
} = require('../../src/renderer/generation/connectedDraft');
const { blankRecipe } = require('../../src/renderer/generation/sceneRecipe');

async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.RUNNER_OS, 'Windows');
  const [exe, mode] = process.argv.slice(2);
  const child = spawn(exe, ['--remote-debugging-port=19242', '--disable-gpu'], {
    env: { ...process.env, SDSTUDIO_OFFLINE: '1' },
    stdio: 'ignore',
  });
  const closed = once(child, 'exit');
  let socket;
  try {
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      const targets = await fetch('http://127.0.0.1:19242/json/list')
        .then((r) => r.json())
        .catch(() => []);
      page = targets.find(
        (t) => t.type === 'page' && t.url.startsWith('file:'),
      );
      if (!page) await delay(200);
    }
    assert.ok(page, 'installed renderer did not start');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await once(socket, 'open');
    let id = 0;
    async function evaluate(expression) {
      const request = ++id;
      const reply = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(Error('renderer evaluation timed out')),
          10000,
        );
        function receive(event) {
          const message = JSON.parse(event.data);
          if (message.id !== request) return;
          clearTimeout(timeout);
          socket.removeEventListener('message', receive);
          if (message.error || message.result.exceptionDetails)
            reject(Error('installed renderer rejected operation'));
          else resolve(message.result.result.value);
        }
        socket.addEventListener('message', receive);
      });
      socket.send(
        JSON.stringify({
          id: request,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
      return reply;
    }
    const { scenes, selectedSceneId } = createConnectedWorkspaceState();
    scenes[0].draft.prompt = '짧은 머리, school uniform, 창가에 앉은 인물';
    const content = { name: 'Windows update fixture', scenes, selectedSceneId };
    const recipe = { ...blankRecipe(), name: 'Windows update recipe' };
    const key = 'sdstudio.scene-recipes.v2';
    const preset = {
      kind: 'main',
      name: '한글 화풍',
      prompt: '수채화, 따뜻한 빛',
      negativePrompt: '',
      qualityTags: 'none',
      ucPreset: 'none',
    };
    if (mode === 'seed') {
      const library = await evaluate('window.electron.promptLibrary.read()');
      assert.ok(library.ok);
      const saved = await evaluate(
        `window.electron.promptLibrary.save(${JSON.stringify(library.value.revision)}, ${JSON.stringify(preset)})`,
      );
      assert.ok(saved.ok);
      assert.equal(
        (
          await evaluate(
            `window.electron.projects.create(${JSON.stringify(content)})`,
          )
        ).ok,
        true,
      );
      await evaluate(
        `localStorage.setItem('${key}', ${JSON.stringify(JSON.stringify([recipe]))})`,
      );
    } else {
      const list = await evaluate('window.electron.projects.list()');
      const row = list.value.find((p) => p.name === content.name);
      assert.ok(row);
      const project = await evaluate(
        `window.electron.projects.open(${JSON.stringify(row.id)})`,
      );
      assert.deepEqual(project.value.project.scenes, scenes);
      const library = await evaluate('window.electron.promptLibrary.read()');
      assert.ok(library.ok);
      assert.ok(
        library.value.entries.some(
          (p) => p.name === preset.name && p.prompt === preset.prompt,
        ),
      );
      for (const query of ['smile', 'short hair', 'school uniform']) {
        const hits = await evaluate(
          `window.electron.ipcRenderer.invoke('search-tags', ${JSON.stringify(query)})`,
        );
        assert.ok(
          hits.some((hit) => hit.word === query),
          query,
        );
      }
      assert.deepEqual(
        await evaluate(`JSON.parse(localStorage.getItem('${key}'))`),
        [recipe],
      );
    }
    await evaluate('setTimeout(()=>window.close(),100);true');
    const timeout = setTimeout(() => child.kill(), 15000);
    try {
      assert.equal((await closed)[0], 0);
    } finally {
      clearTimeout(timeout);
    }
    console.log(mode + ' verified in the installed application');
  } finally {
    socket?.close();
    if (child.exitCode === null) child.kill();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
