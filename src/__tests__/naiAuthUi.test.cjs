const { test } = require('node:test'),
  assert = require('node:assert/strict');
const {
  prepareTokenInput,
  authErrorMessage,
  tokenStatusLabel,
} = require('../renderer/auth/tokenInput');
test('paste normalization is explicit and rejects internal whitespace/header injection', () => {
  assert.deepEqual(prepareTokenInput(' \nsynthetic-fixture\r\n'), {
    token: 'synthetic-fixture',
    trimmed: true,
    valid: true,
  });
  for (const s of [
    '',
    ' \n',
    'internal space',
    'header\r\ninjection',
    'x'.repeat(4097),
  ])
    assert.equal(prepareTokenInput(s).valid, false);
  assert.equal(prepareTokenInput('synthetic').trimmed, false);
});
test('stored and locally readable credentials are never presented as authenticated', () => {
  for (const storage of ['session', 'encrypted']) {
    const label = tokenStatusLabel({
      configured: true,
      storage,
      secureStorageAvailable: true,
      locallyReadable: true,
    });
    assert.match(label, /서버 인증 미확인/);
    assert.doesNotMatch(label, /로그인됨|인증 완료/);
  }
  assert.match(tokenStatusLabel(), /없음/);
});
test('version/corruption/offline errors give recovery guidance without echoing server text', () => {
  for (const code of ['STORE_VERSION', 'STORE_UNREADABLE'])
    assert.match(authErrorMessage(code), /원본은 그대로/);
  assert.match(authErrorMessage('OFFLINE'), /오프라인/);
  assert.match(authErrorMessage('INVALID_INPUT'), /중간 공백/);
  assert.doesNotMatch(
    authErrorMessage('synthetic-secret-raw-error'),
    /synthetic/,
  );
});

test('remember choice defaults to secure storage when available and preserves explicit session-only use', () => {
  const { defaultRememberToken } = require('../renderer/auth/tokenInput');
  for (const storage of ['none', 'encrypted'])
    assert.equal(
      defaultRememberToken({ storage, secureStorageAvailable: true }),
      true,
    );
  assert.equal(
    defaultRememberToken({ storage: 'session', secureStorageAvailable: true }),
    false,
  );
  for (const storage of ['none', 'encrypted', 'session'])
    assert.equal(
      defaultRememberToken({ storage, secureStorageAvailable: false }),
      false,
    );
});
