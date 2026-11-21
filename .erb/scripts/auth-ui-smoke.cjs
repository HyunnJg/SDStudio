// Exercise the shipped renderer, preload and production auth IPC using synthetic local data.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { app, BrowserWindow } = require('electron');
module.exports = async function (contents, offline) {
  const checks = [];
  const evaluate = (code) => contents.executeJavaScript(code);
  const until = async (code) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(code)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw Error('Auth UI assertion timed out: ' + code);
  };
  const click = async (selector) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).focus(); document.querySelector(${JSON.stringify(selector)}).click()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 35));
  };
  const fill = async (value) => {
    await evaluate(
      `document.querySelector('#nai-token-input').value=${JSON.stringify(value)}`,
    );
  };
  await click('[data-testid=open-nai-auth]');
  await until(`!!document.querySelector('dialog[open]')`);
  if (offline) {
    assert.equal(
      await evaluate(
        `document.querySelector('[data-testid=nai-auth-save]').matches(':disabled')`,
      ),
      true,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('#nai-token-input').matches(':disabled')`,
      ),
      true,
    );
    checks.push(
      'offline dialog disables token entry without accessing credentials',
    );
  } else {
    await until(
      `!document.querySelector('[data-testid=nai-auth-refresh]').disabled`,
    );
    assert.match(
      await evaluate(
        `document.querySelector('[data-testid=nai-auth-status]').textContent`,
      ),
      /없음/,
    );
    const realFile = path.join(
      app.getPath('userData'),
      'auth/novelai-token.v1.json',
    );
    assert.equal(fs.existsSync(realFile), false);
    assert.equal(
      await evaluate(
        `document.querySelectorAll('input[name=nai-storage]')[1].checked`,
      ),
      false,
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('input[name=nai-storage]')[1].disabled`,
      ),
      true,
    );
    await fill(' \nsynthetic-auth-ui-token\r\n');
    await click('[data-testid=nai-auth-save]');
    await until(
      `document.querySelector('[data-testid=nai-auth-notice]')?.textContent.includes('앞뒤 공백')`,
    );
    assert.equal(
      await evaluate(`document.querySelector('#nai-token-input').value`),
      '',
    );
    assert.equal(fs.existsSync(realFile), false);
    assert.match(
      await evaluate(
        `document.querySelector('[data-testid=nai-auth-status]').textContent`,
      ),
      /이번 실행에만.*서버 인증 미확인/,
    );
    checks.push(
      'paste trimming is disclosed; token is cleared from input and never written in session mode',
    );
    await click('[data-testid=nai-auth-check]');
    await until(
      `document.querySelector('[data-testid=nai-auth-notice]')?.textContent.includes('이 기기에서')`,
    );
    checks.push(
      'local readability check succeeds without claiming server authentication',
    );
    await click('[data-testid=nai-auth-delete]');
    await until(`!!document.querySelector('.nai-confirm')`);
    await click('.nai-confirm button');
    assert.match(
      await evaluate(
        `document.querySelector('[data-testid=nai-auth-status]').textContent`,
      ),
      /이번 실행/,
    );
    checks.push('cancelling deletion preserves session token');
    await click('[data-testid=nai-auth-delete]');
    await click('[data-testid=nai-auth-confirm-delete]');
    await until(
      `document.querySelector('[data-testid=nai-auth-status]').textContent.includes('없음')`,
    );
    fs.mkdirSync(path.dirname(realFile), { recursive: true });
    const future =
      '{"format":"sdstudio-nai-token","version":99,"ciphertext":"synthetic"}';
    fs.writeFileSync(realFile, future);
    await click('[data-testid=nai-auth-refresh]');
    await until(
      `document.querySelector('[data-testid=nai-auth-status]').textContent.includes('저장된 토큰 있음')`,
    );
    await click('[data-testid=nai-auth-check]');
    await until(
      `document.querySelector('[data-testid=nai-auth-error]')?.textContent.includes('더 새로운 형식')`,
    );
    await fill('synthetic-replacement');
    await click('[data-testid=nai-auth-save]');
    await until(
      `document.querySelector('[data-testid=nai-auth-error]')?.textContent.includes('더 새로운 형식')`,
    );
    assert.equal(fs.readFileSync(realFile, 'utf8'), future);
    checks.push(
      'future-version file is preserved by read and session-mode replacement; recovery guidance is visible',
    );
    await click('[data-testid=nai-auth-delete]');
    await click('.nai-confirm button');
    assert.equal(fs.readFileSync(realFile, 'utf8'), future);
    await click('[data-testid=nai-auth-delete]');
    await click('[data-testid=nai-auth-confirm-delete]');
    await until(
      `document.querySelector('[data-testid=nai-auth-status]').textContent.includes('없음')`,
    );
    assert.equal(fs.existsSync(realFile), false);
    checks.push('only confirmed deletion removes unsupported ciphertext');
    await fill('internal space');
    await click('[data-testid=nai-auth-save]');
    await until(`!!document.querySelector('[data-testid=nai-auth-error]')`);
    assert.match(
      await evaluate(
        `document.querySelector('[data-testid=nai-auth-error]').textContent`,
      ),
      /중간 공백/,
    );
    assert.equal(fs.existsSync(realFile), false);
    checks.push('invalid input is rejected before storage');
  }
  if (process.env.SDSTUDIO_AUTH_UI_SCREENSHOT)
    fs.writeFileSync(
      process.env.SDSTUDIO_AUTH_UI_SCREENSHOT,
      (await contents.capturePage()).toPNG(),
    );
  const window = BrowserWindow.fromWebContents(contents);
  window.setMinimumSize(360, 600);
  window.setSize(390, 844);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(
    await evaluate(
      `document.querySelector('dialog').scrollWidth<=document.querySelector('dialog').clientWidth+1 && document.documentElement.scrollWidth<=innerWidth`,
    ),
    true,
  );
  checks.push('390px modal has no horizontal overflow');
  await fill('synthetic-unsaved');
  await click('[aria-label="토큰 설정 닫기"]');
  await until(`!document.querySelector('dialog[open]')`);
  await click('[data-testid=open-nai-auth]');
  await until(`!!document.querySelector('dialog[open]')`);
  assert.equal(
    await evaluate(`document.querySelector('#nai-token-input').value`),
    '',
  );
  assert.equal(
    await evaluate(`document.activeElement.closest('dialog') !== null`),
    true,
  );
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await until(`!document.querySelector('dialog[open]')`);
  assert.equal(
    await evaluate(`document.activeElement.dataset.testid`),
    'open-nai-auth',
  );
  checks.push(
    'close clears unsaved input; modal traps focus and Escape restores the opener',
  );
  return {
    checks,
    offline,
    profile: app.getPath('userData'),
    width: 390,
    realCredentialsUsed: false,
  };
};
