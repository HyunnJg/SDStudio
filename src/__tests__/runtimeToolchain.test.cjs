const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkToolchain } = require('../../.erb/scripts/check-toolchain.cjs');
test('the selected LTS host works with the user npm version; obsolete or unsupported hosts fail before native work', () => {
  checkToolchain('26.13.1', 'npm/11.21.3 node/v26.13.1');
  checkToolchain('26.14.0', 'npm/11.22.0 node/v26.14.0');
  for (const node of ['22.4.1', '24.22.3', '26.13.0', '27.0.0'])
    assert.throws(() => checkToolchain(node, 'npm/11.21.3'), /Use Node/);
  for (const npm of ['10.8.1', '11.20.0', '11.21.2', '12.0.0'])
    assert.throws(() => checkToolchain('26.13.1', `npm/${npm}`), /Use npm/);
});
