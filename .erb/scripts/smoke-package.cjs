const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
if (!process.argv[2])
  throw Error(
    'Usage: npm run smoke:package -- /absolute/linux-unpacked [real|auth|projects|worker|crash|unresponsive|generation|generation-queue]',
  );
const directory = fs.realpathSync(process.argv[2]);
const resilience = ['worker', 'crash', 'unresponsive'].includes(process.argv[3])
  ? process.argv[3]
  : '';
const generationQueueMode = process.argv[3] === 'generation-queue';
const generationMode = process.argv[3] === 'generation' || generationQueueMode;
const projectMode = process.argv[3] === 'projects';
const authMode = process.argv[3] === 'auth';
const mock = ['real', 'auth', 'generation', 'generation-queue'].includes(
  process.argv[3],
)
  ? '0'
  : '1';
if (process.platform !== 'linux' || !process.env.DISPLAY)
  throw Error('Packaged smoke requires a Linux X11 DISPLAY');
const archive = path.join(directory, 'resources/app.asar');
const crypto = require('node:crypto');
const archiveHash = () =>
  crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const beforeHash = archiveHash();
const harness = path.join(
  __dirname,
  generationMode ? 'generation-ui-harness.cjs' : 'smoke-harness.cjs',
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-packaged-smoke-'));
const original = path.join(root, 'original');
fs.mkdirSync(original);
const report = path.join(root, 'report.json');
const childEnv = {
  ...process.env,
  XDG_CONFIG_HOME: original,
  SDSTUDIO_USER_DATA_DIR: path.join(root, 'isolated'),
  SDSTUDIO_MOCK_BACKEND: mock,
  SDSTUDIO_OFFLINE: authMode || generationMode ? '0' : '1',
  SDSTUDIO_SMOKE_REPORT: report,
  SDSTUDIO_SMOKE_WORKSPACE: mock,
  SDSTUDIO_SMOKE_SKIP_SINGLETON: '1',
  SDSTUDIO_SMOKE_AUTH_UI: authMode ? '1' : '0',
  SDSTUDIO_SMOKE_PROJECTS: projectMode ? '1' : '0',
  SDSTUDIO_PROJECT_UI_PHASE: 'create',
  SDSTUDIO_GENERATION_PHASE: generationQueueMode ? 'queue' : 'create',
  SDSTUDIO_SMOKE_RESILIENCE: resilience,
};
if (authMode) delete childEnv.SDSTUDIO_USER_DATA_DIR;
const child = spawn(
  path.join(directory, require('../../package.json').build.executableName),
  [
    '--inspect-brk=127.0.0.1:0',
    '--ozone-platform=x11',
    '--disable-gpu',
    ...(authMode ? ['--password-store=basic'] : []),
  ],
  { env: childEnv, stdio: ['ignore', 'inherit', 'pipe'] },
);
// The inspector is bound to loopback on an ephemeral port; only the test harness
// is injected before entry. Package files and app.isPackaged stay unchanged.
let attached = false;
let socket;
let currentId = 0;
const requests = new Map();
let setupInfo;
let inspectorLog = '';
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++currentId;
    requests.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  inspectorLog = (inspectorLog + String(chunk)).slice(-8192);
  const m = inspectorLog.match(/(ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/);
  if (!m || attached) return;
  attached = true;
  socket = new WebSocket(m[1]);
  socket.on('error', (error) => {
    process.stderr.write(String(error));
    child.kill('SIGTERM');
    process.exitCode = 1;
  });
  socket.on('message', async (raw) => {
    const message = JSON.parse(raw);
    if (message.id) {
      const pending = requests.get(message.id);
      requests.delete(message.id);
      if (message.error) pending?.reject(message.error);
      else pending?.resolve(message.result);
      return;
    }
    if (message.method === 'Debugger.paused') {
      try {
        const expression = `(()=>{const {app}=require('electron');require(${JSON.stringify(harness)});return {isPackaged:app.isPackaged,resourcesPath:process.resourcesPath,appPath:app.getAppPath()};})()`;
        const result = await send('Debugger.evaluateOnCallFrame', {
          callFrameId: message.params.callFrames[0].callFrameId,
          expression,
          returnByValue: true,
        });
        if (result.exceptionDetails)
          throw Error(JSON.stringify(result.exceptionDetails));
        setupInfo = result.result.value;
        process.stdout.write(
          'Packaged harness: ' + JSON.stringify(setupInfo) + '\n',
        );
        await send('Debugger.resume');
        socket.close();
      } catch (error) {
        process.stderr.write(
          'Inspector setup failed: ' + JSON.stringify(error) + '\n',
        );
        child.kill('SIGTERM');
        process.exitCode = 1;
      }
    }
  });
  socket.on('open', async () => {
    try {
      await send('Runtime.enable');
      await send('Debugger.enable');
      await send('Runtime.runIfWaitingForDebugger');
    } catch (error) {
      process.stderr.write(String(error));
      child.kill('SIGTERM');
      process.exitCode = 1;
    }
  });
});
const timer = setTimeout(() => {
  child.kill('SIGTERM');
  process.exitCode = 1;
}, 45000);
child.on('error', (error) => {
  clearTimeout(timer);
  process.stderr.write(String(error));
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timer);
  socket?.close();
  if (code !== 0 || !fs.existsSync(report)) {
    process.exitCode = 1;
    return;
  }
  const data = JSON.parse(fs.readFileSync(report));
  const forkDirectory = path.join(original, 'SDStudio-HyunnJg');
  const profileIsolated = authMode
    ? JSON.stringify(fs.readdirSync(original)) ===
        JSON.stringify(['SDStudio-HyunnJg']) &&
      data.authUI?.profile === forkDirectory
    : fs.readdirSync(original).length === 0;
  data.packageContext = {
    isPackaged: setupInfo?.isPackaged,
    archiveUnchanged: archiveHash() === beforeHash,
    profileIsolated,
    inspectorInjectedHarness: true,
  };
  fs.writeFileSync(report, JSON.stringify(data, null, 2));
  if (
    data.error ||
    !data.ready ||
    (mock === '1' &&
      !(resilience
        ? data.resilience
        : projectMode
          ? data.projectUI
          : data.workspace)) ||
    (mock === '0' &&
      !authMode &&
      !generationMode &&
      data.blockedOperations?.length !== 5) ||
    (authMode && !data.authUI) ||
    (generationMode &&
      (!data.nativeQuitObserved ||
        data.loopbackRequests !== (generationQueueMode ? 13 : 3) ||
        data.checks?.length !== (generationQueueMode ? 8 : 6))) ||
    !setupInfo?.isPackaged ||
    !data.packageContext.archiveUnchanged ||
    data.externalRequests.length ||
    data.rendererErrors.length ||
    !profileIsolated
  )
    process.exitCode = 1;
  if (process.env.SDSTUDIO_PACKAGE_REPORT)
    fs.copyFileSync(report, process.env.SDSTUDIO_PACKAGE_REPORT);
  process.stdout.write('Packaged smoke report: ' + report + '\n');
});
