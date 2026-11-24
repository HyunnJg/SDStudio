// Synthetic UI/Electron test only. No real service or credentials.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');
const http = require('node:http'),
  JSZip = require('jszip');
const { png } = require('../../src/__tests__/fixtures/nai/png.cjs');
const root = process.env.SDSTUDIO_LIVE_TEST_ROOT,
  mode = process.env.SDSTUDIO_LIVE_TEST_MODE;
if (!root) throw Error('Synthetic root required');
const report = {
  mode,
  checks: [],
  externalRequests: [],
  rendererErrors: [],
  credentials: 'synthetic-only',
};
let server,
  payload,
  imageBytes,
  requests = 0;
function finish(code) {
  fs.writeFileSync(
    path.join(root, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  server?.close();
  app.exit(code);
}
setTimeout(() => {
  report.failure = 'Timed out';
  finish(1);
}, 20000).unref();
const options = {
  synthetic: true,
  prepare: async () => {
    if (mode === 'recovery') {
      const directory = path.join(process.argv[2], 'live-validation');
      fs.mkdirSync(directory, { mode: 0o700 });
      const candidate = require('../fixtures/nai-live-candidate.json');
      fs.writeFileSync(
        path.join(directory, 'attempt.json'),
        JSON.stringify({
          version: 1,
          requestHash: require('node:crypto')
            .createHash('sha256')
            .update(JSON.stringify(candidate.request))
            .digest('hex'),
          beforeBalance: 100,
        }),
        { mode: 0o600 },
      );
    }
    const archive = new JSZip();
    imageBytes =
      mode === 'unknown-mime' || mode === 'absent-mime'
        ? png(2, 1, require('node:crypto').randomBytes(80000))
        : png();
    archive.file('image.png', imageBytes);
    const image = await archive.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      streamFiles: mode === 'unknown-mime' || mode === 'absent-mime',
    });
    payload =
      mode === 'valid' || mode === 'unknown-mime' || mode === 'absent-mime'
        ? image
        : Buffer.from(
            mode === 'http-error'
              ? 'synthetic private server explanation'
              : 'synthetic bad zip',
          );
    server = http.createServer((request, response) => {
      requests++;
      assert.equal(
        request.headers.authorization,
        'Bearer synthetic-live-token',
      );
      assert.equal(request.headers.cookie, undefined);
      request.on('data', () => {});
      if (mode === 'cancel') return;
      response.writeHead(
        mode === 'http-error' ? 400 : 200,
        mode === 'absent-mime'
          ? {}
          : {
              'Content-Type':
                mode === 'http-error'
                  ? 'application/json'
                  : mode === 'unknown-mime'
                    ? 'application/x-sdstudio-test; charset=utf-8'
                    : 'application/zip',
            },
      );
      response.end(payload);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    options.loopbackURL = `http://127.0.0.1:${server.address().port}/image`;
  },
  onReady: async ({ window, runner, store }) => {
    try {
      const contents = window.webContents,
        call = (code) => contents.executeJavaScript(code);
      contents.on('console-message', ({ level, message }) => {
        if (level === 'error')
          report.rendererErrors.push(message.slice(0, 300));
      });
      const until = async (code) => {
        for (let i = 0; i < 100; i++) {
          if (await call(code)) return;
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        throw Error('UI timed out: ' + code);
      };
      await until(
        `document.querySelector('#candidate').textContent.includes('unverified-experimental-candidate')`,
      );
      assert.equal(await call(`document.querySelector('#run').disabled`), true);
      assert.equal(requests, 0);
      const state = await call('window.validation.status()');
      const evidence = {
        requestHash: state.status.requestHash,
        beforeBalance: 100,
        displayedCost: 5,
        sameSettings: true,
        capture: true,
        candidateAcknowledged: true,
      };
      if (mode === 'recovery') {
        assert.equal(state.status.incomplete, true);
        await until(`document.querySelector('#after-save').disabled===false`);
        assert.match(
          await call(`document.querySelector('#recovery-state').textContent`),
          /결과 기록이 없습니다/,
        );
        assert.equal(
          (await call(`window.validation.run(${JSON.stringify(evidence)})`))
            .code,
          'ALREADY_USED',
        );
        await call(
          `document.querySelector('#after').value='95';document.querySelector('#after-save').click();void 0`,
        );
        await until(
          `document.querySelector('#message').textContent.includes('잔액을 기록')`,
        );
        const balance = JSON.parse(
          fs.readFileSync(path.join(runner.directory, 'balance-after.json')),
        );
        assert.equal(balance.incomplete, true);
        assert.equal(balance.resultRecord, 'missing');
        assert.equal(balance.afterBalance, 95);
        assert.equal(
          fs.existsSync(path.join(runner.directory, 'result.json')),
          false,
        );
        assert.equal(
          (await call('window.validation.after(90)')).code,
          'STORAGE_FAILED',
        );
        assert.equal(requests, 0);
        report.checks.push(
          'reopened interrupted attempt shows missing result, records incomplete balance without sending or overwriting',
        );
        report.loopbackRequests = requests;
        report.electron = process.versions.electron;
        report.node = process.versions.node;
        finish(0);
        return;
      }
      if (mode === 'offline') {
        assert.equal(state.status.offline, true);
        assert.equal(
          await call(`document.querySelector('#token-save').disabled`),
          true,
        );
        assert.equal(
          (await call(`window.validation.setToken('synthetic-live-token')`))
            .code,
          'OFFLINE',
        );
        assert.equal(
          (await call(`window.validation.run(${JSON.stringify(evidence)})`))
            .code,
          'OFFLINE',
        );
        assert.equal(runner.status().used, false);
        assert.deepEqual(fs.readdirSync(runner.directory), []);
        assert.equal(requests, 0);
        report.checks.push(
          'forced offline disables token/send UI and IPC before any attempt or request',
        );
        report.loopbackRequests = requests;
        report.electron = process.versions.electron;
        report.node = process.versions.node;
        finish(0);
        return;
      }
      const denied = await call(
        `window.validation.run(${JSON.stringify({ ...evidence, displayedCost: 11 })})`,
      );
      assert.equal(denied.code, 'COST_LIMIT');
      assert.equal(requests, 0);
      assert.equal(runner.status().used, false);
      report.checks.push(
        'no request before token and web-cost evidence; over-budget rejection does not consume an attempt',
      );
      await call(
        `document.querySelector('#token').value='synthetic-live-token';document.querySelector('#token-save').click();void 0`,
      );
      await until(`!document.querySelector('#run').disabled`);
      assert.equal(await call(`document.querySelector('#token').value`), '');
      assert.equal(
        fs.existsSync(
          path.join(process.argv[2], 'auth/validation-token.v1.json'),
        ),
        false,
      );
      report.checks.push(
        'token enters through trusted IPC, is cleared from DOM and is not saved to disk',
      );
      const other = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          preload: path.join(__dirname, 'nai-live-preload.cjs'),
        },
      });
      await other.loadURL('data:text/html,<p>untrusted test</p>');
      assert.equal(
        (
          await other.webContents.executeJavaScript(
            'window.validation.status()',
          )
        ).code,
        'UNTRUSTED_SENDER',
      );
      other.destroy();
      report.checks.push('secondary window is rejected by validation IPC');
      await call(
        `document.querySelector('#before').value='100';document.querySelector('#cost').value='5';for(const id of ['same','capture','ack'])document.getElementById(id).checked=true;document.querySelector('#run').click();void 0`,
      );
      if (mode === 'cancel') {
        for (let i = 0; i < 100 && requests === 0; i++)
          await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(requests, 1);
        await call(`document.querySelector('#cancel').click();void 0`);
      }
      await until(
        `document.querySelector('#result').textContent.includes('responseCaptured')`,
      );
      await until(`document.querySelector('#after-save').disabled===false`);
      const result = JSON.parse(
        await call(`document.querySelector('#result').textContent`),
      );
      assert.equal(requests, 1);
      assert.equal(result.responseCaptured, mode !== 'cancel');
      assert.equal(result.mayHaveReachedServer, true);
      if (
        mode === 'valid' ||
        mode === 'unknown-mime' ||
        mode === 'absent-mime'
      ) {
        assert.equal(result.ok, true);
        assert.deepEqual(
          fs.readFileSync(path.join(runner.directory, 'result.png')),
          imageBytes,
        );
        assert.equal(result.zipHeader.method, 8);
        if (mode === 'unknown-mime' || mode === 'absent-mime') {
          assert.equal(result.zipHeader.flags, 8);
          assert.equal(
            result.contentType,
            mode === 'unknown-mime' ? 'other' : 'absent',
          );
          assert.equal(
            result.mediaTypeState,
            mode === 'unknown-mime' ? 'present' : 'absent',
          );
          if (mode === 'unknown-mime')
            assert.equal(result.mediaType, 'application/x-sdstudio-test');
          else assert.equal(result.mediaType, undefined);
          assert.equal(result.acceptedByZipSignature, true);
          assert.equal(result.captureTruncated, false);
          assert.ok(result.responseBytes > 65536);
        }
      } else
        assert.equal(
          result.code,
          mode === 'http-error'
            ? 'HTTP_ERROR'
            : mode === 'cancel'
              ? 'CANCELLED'
              : 'INVALID_IMAGE_RESPONSE',
        );
      if (mode === 'bad-zip') assert.equal(result.reason, 'zip-eocd');
      assert.equal(JSON.stringify(result).includes('explanation'), false);
      const file = path.join(runner.directory, 'response.zip');
      assert.deepEqual(
        fs.readFileSync(file),
        mode === 'cancel' ? Buffer.alloc(0) : payload,
      );
      for (const name of ['attempt.json', 'response.zip', 'result.json'])
        assert.equal(
          fs.statSync(path.join(runner.directory, name)).mode & 0o777,
          0o600,
        );
      report.checks.push(
        'private response capture and safe result preserve server uncertainty; successful PNG is byte-identical',
      );
      if (mode !== 'cancel') {
        const replay = spawnSync(
          process.env.SDSTUDIO_LIVE_TEST_NODE,
          [path.resolve(__dirname, 'inspect-nai-response.cjs'), file],
          { encoding: 'utf8' },
        );
        assert.equal(
          replay.status,
          mode === 'valid' || mode === 'unknown-mime' || mode === 'absent-mime'
            ? 0
            : 1,
        );
        if (
          mode !== 'valid' &&
          mode !== 'unknown-mime' &&
          mode !== 'absent-mime'
        )
          assert.equal(JSON.parse(replay.stdout).reason, 'zip-eocd');
        report.checks.push(
          'saved response can be rechecked locally without a second request',
        );
      } else
        report.checks.push(
          'cancellation consumes the attempt without claiming a complete response',
        );
      assert.throws(() => store.read(), { code: 'TOKEN_MISSING' });
      assert.equal(
        (await call(`window.validation.run(${JSON.stringify(evidence)})`)).code,
        'ALREADY_USED',
      );
      assert.equal(requests, 1);
      report.checks.push(
        'token memory is dropped after attempt and another send is refused',
      );
      await call(
        `document.querySelector('#after').value='95';document.querySelector('#after-save').click();void 0`,
      );
      await until(
        `document.querySelector('#message').textContent.includes('잔액을 기록')`,
      );
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(runner.directory, 'balance-after.json')),
        ).afterBalance,
        95,
      );
      report.checks.push(
        'manual after-balance is recorded without claiming per-request billing proof',
      );
      window.setSize(390, 844);
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(
        await call('document.documentElement.scrollWidth<=innerWidth'),
        true,
      );
      report.checks.push('390px form has no horizontal overflow');
      if (process.env.SDSTUDIO_LIVE_TEST_SCREENSHOT && mode === 'bad-zip')
        fs.writeFileSync(
          process.env.SDSTUDIO_LIVE_TEST_SCREENSHOT,
          (await contents.capturePage()).toPNG(),
        );
      assert.equal(report.rendererErrors.length, 0);
      report.loopbackRequests = requests;
      report.safeResult = result;
      report.electron = process.versions.electron;
      report.node = process.versions.node;
      finish(0);
    } catch (error) {
      report.failure = String(error);
      finish(1);
    }
  },
};
require('./nai-live-entry.cjs').start(options);
