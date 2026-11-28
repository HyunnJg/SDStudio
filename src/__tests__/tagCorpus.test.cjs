const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('desktop, Android and native lookup data match the reviewed tag corpus', () => {
  // The reviewed release data and its source are recorded in LICENSE_REVIEW.md.
  const expected =
    '0694958fe1d9383c8a5f7ce34a731ff2e66271aaf68b1c06610176cf1fd71c7c';
  for (const name of [
    'release/app/data/db.csv',
    'assets/db.txt',
    'src/native/db.csv',
  ]) {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../..', name));
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      expected,
      name,
    );
  }
});
