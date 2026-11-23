// Actual packaged native relaunch journey, instrumented only through a loopback inspector.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { spawn } = require('node:child_process'),
  http = require('node:http'),
  net = require('node:net'),
  WebSocket = require('ws');
if (process.platform !== 'linux' || !process.env.DISPLAY || !process.argv[2])
  throw Error(
    'Usage: npm run smoke:network-mode -- /absolute/linux-unpacked (Linux X11)',
  );
const directory = fs.realpathSync(process.argv[2]),
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-mode-journey-')),
  appData = path.join(root, 'app-data'),
  journal = path.join(root, 'journey.json');
fs.mkdirSync(appData);
// Preserve the user's previously saved offline choice across the new online default.
const forkProfile = path.join(appData, 'SDStudio-HyunnJg');
fs.mkdirSync(forkProfile);
fs.writeFileSync(
  path.join(forkProfile, 'network-mode.v1.json'),
  JSON.stringify({ version: 1, mode: 'offline' }),
);
const sentinels = [];
for (const folder of ['SDStudio', 'sdstudio']) {
  const file = path.join(appData, folder, 'TOKEN.txt');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'synthetic-original');
  sentinels.push({
    file,
    bytes: fs.readFileSync(file),
    mtime: fs.statSync(file).mtimeMs,
  });
}
const archive = path.join(directory, 'resources/app.asar'),
  hash = () =>
    crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
  beforeHash = hash();
const port = awaitPort();
function awaitPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const p = server.address().port;
      server.close(() => resolve(p));
    });
  });
}
(async () => {
  const selectedPort = await port;
  const env = {
    ...process.env,
    XDG_CONFIG_HOME: appData,
    SDSTUDIO_MODE_SMOKE_ROOT: root,
    SDSTUDIO_MODE_INSPECTOR_PORT: String(selectedPort),
  };
  for (const key of [
    'SDSTUDIO_OFFLINE',
    'SDSTUDIO_MOCK_BACKEND',
    'SDSTUDIO_USER_DATA_DIR',
    'SDSTUDIO_PROFILE_CHECK',
  ])
    delete env[key];
  const child = spawn(
    path.join(directory, require('../../package.json').build.executableName),
    [
      `--inspect-brk=127.0.0.1:${selectedPort}`,
      '--ozone-platform=x11',
      '--disable-gpu',
      '--password-store=basic',
    ],
    { env, stdio: ['ignore', 'inherit', 'pipe'] },
  );
  child.stderr.on('data', (data) => process.stderr.write(data));
  child.on('error', (error) => {
    throw error;
  });
  const seen = new Set();
  let finished = false;
  function attach(url) {
    if (seen.has(url) || finished) return;
    seen.add(url);
    const socket = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        socket.send(JSON.stringify({ id: n, method, params }));
      });
    socket.on('error', (error) => {
      if (!finished) console.error('Inspector', String(error));
    });
    socket.on('message', async (raw) => {
      const m = JSON.parse(raw);
      if (m.id) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p?.reject(m.error);
        else p?.resolve(m.result);
        return;
      }
      if (m.method === 'Debugger.paused') {
        try {
          const r = await send('Debugger.evaluateOnCallFrame', {
            callFrameId: m.params.callFrames[0].callFrameId,
            expression: `require(${JSON.stringify(path.join(__dirname, 'network-mode-harness.cjs'))})`,
            returnByValue: true,
          });
          if (r.exceptionDetails)
            throw Error(JSON.stringify(r.exceptionDetails));
          await send('Debugger.resume');
          socket.close();
        } catch (error) {
          console.error(String(error));
          process.exitCode = 1;
          finished = true;
          child.kill('SIGTERM');
        }
      }
    });
    socket.on('open', async () => {
      await send('Runtime.enable');
      await send('Debugger.enable');
      await send('Runtime.runIfWaitingForDebugger');
    });
  }
  const timer = setTimeout(
    () => finish(Error('Native restart journey timed out')),
    55000,
  );
  function finish(error) {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    clearTimeout(timer);
    const report = fs.existsSync(journal)
      ? JSON.parse(fs.readFileSync(journal))
      : {};
    if (error || report.error) {
      console.error(error || report.error);
      console.error(JSON.stringify(report));
      process.exitCode = 1;
      child.kill('SIGTERM');
      return;
    }
    try {
      assert.equal(report.done, true);
      assert.equal(report.pids.length, 3);
      assert.equal(report.relaunchCalls, 2);
      assert.equal(hash(), beforeHash);
      for (const s of sentinels) {
        assert.deepEqual(fs.readFileSync(s.file), s.bytes);
        assert.equal(fs.statSync(s.file).mtimeMs, s.mtime);
      }
      report.packageContext = {
        isPackaged: true,
        archiveUnchanged: true,
        nativeRestarts: 2,
        inspectorInjectedHarness: true,
        singleInstanceLockSimulated: true,
        originalFixtureUnchanged: true,
      };
      fs.writeFileSync(journal, JSON.stringify(report, null, 2));
      console.log('Network mode report: ' + journal);
    } catch (e) {
      console.error(e);
      process.exitCode = 1;
    }
  }
  const poll = setInterval(() => {
    if (fs.existsSync(journal)) {
      const report = JSON.parse(fs.readFileSync(journal));
      if (report.done || report.error) {
        finish();
        return;
      }
    }
    const request = http.get(
      `http://127.0.0.1:${selectedPort}/json/list`,
      (response) => {
        let data = '';
        response.on('data', (chunk) => (data += chunk));
        response.on('end', () => {
          try {
            for (const target of JSON.parse(data))
              if (target.webSocketDebuggerUrl)
                attach(target.webSocketDebuggerUrl);
          } catch {}
        });
      },
    );
    request.on('error', () => {});
    request.setTimeout(200, () => request.destroy());
  }, 150);
})();
