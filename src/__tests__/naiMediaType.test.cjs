const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  describeResponseMediaType,
  mediaTypeBucket,
} = require('../main/nai/responseMediaType');

test('media type diagnostics preserve a bounded normalized identifier without parameters', () => {
  const parsed = describeResponseMediaType([
    ' Application/X-Synthetic+Zip ; token=synthetic-private-value',
  ]);
  assert.deepEqual(parsed, {
    mediaTypeState: 'present',
    mediaType: 'application/x-synthetic+zip',
  });
  assert.equal(mediaTypeBucket(parsed), 'other');
  assert.ok(!JSON.stringify(parsed).includes('private'));
  assert.equal(
    mediaTypeBucket(
      describeResponseMediaType('APPLICATION/ZIP; charset=utf-8'),
    ),
    'application/zip',
  );
});
test('absent header differs from empty, malformed or ambiguous headers', () => {
  for (const value of [undefined, null])
    assert.deepEqual(describeResponseMediaType(value), {
      mediaTypeState: 'absent',
    });
  for (const value of [
    '',
    '   ',
    [],
    ['text/plain', 'image/png'],
    42,
    { toString: () => assert.fail() },
    'text/plain\r\nsecret',
    'text/비밀',
    'text/plain?token=x',
  ])
    assert.deepEqual(describeResponseMediaType(value), {
      mediaTypeState: 'invalid',
    });
  assert.equal(mediaTypeBucket(describeResponseMediaType()), 'absent');
});
test('diagnostic lengths are bounded independently of the HTTP receive limit', () => {
  for (const value of [
    'a'.repeat(41) + '/zip',
    'application/' + 'x'.repeat(61),
    'text/plain;' + 'x'.repeat(512),
  ])
    assert.equal(describeResponseMediaType(value).mediaTypeState, 'invalid');
  assert.equal(
    describeResponseMediaType('a'.repeat(40) + '/' + 'x'.repeat(60))
      .mediaTypeState,
    'present',
  );
});
