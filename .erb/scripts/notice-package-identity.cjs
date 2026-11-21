const crypto = require('node:crypto');
// electron-builder strips non-runtime fields such as scripts/bugs/keywords.
// These attribution identity fields remain; full source package.json hashes are retained separately.
module.exports = (data) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        name: data.name,
        version: data.version,
        license: data.license ?? null,
        author: data.author ?? null,
        repository: data.repository ?? null,
      }),
    )
    .digest('hex');
