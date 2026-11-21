// Production build/pack hook. Reads local inventories and exact notice files; no network.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const identity = require('./notice-package-identity.cjs');
const root = path.resolve(__dirname, '../..');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const relative = (directory) =>
  path.relative(root, directory).split(path.sep).join('/');

function collectNotices() {
  const output = path.join(root, '.erb/generated/notices');
  const packages = new Map();
  const add = (directory, origin, expected) => {
    const real = fs.realpathSync(directory);
    if (relative(real).startsWith('../'))
      throw new Error('Notice package is outside the repository');
    const bytes = fs.readFileSync(path.join(real, 'package.json'));
    const data = JSON.parse(bytes);
    if (
      expected &&
      (expected.version !== data.version ||
        expected.packageJsonSha256 !== hash(bytes))
    )
      throw new Error(`Bundled package changed; rebuild: ${expected.root}`);
    if (!packages.has(real))
      packages.set(real, {
        root: relative(real),
        name: data.name,
        version: data.version,
        declaredLicense: data.license ?? null,
        packageJsonSha256: hash(bytes),
        packageIdentitySha256: identity(data),
        origins: [],
      });
    const item = packages.get(real);
    if (!item.origins.includes(origin)) item.origins.push(origin);
  };
  const inventories = [
    'release/app/dist/main/bundle-licenses.json',
    'release/app/dist/renderer/bundle-licenses.json',
  ];
  const buildInputs = [];
  for (const file of inventories) {
    if (!fs.existsSync(path.join(root, file)))
      throw new Error(
        'Missing bundle license inventory. Run npm run build first.',
      );
    const bytes = fs.readFileSync(path.join(root, file));
    const inventory = JSON.parse(bytes);
    if (
      inventory.lockSha256 !==
      hash(fs.readFileSync(path.join(root, 'package-lock.json')))
    )
      throw new Error(
        'Dependency lock changed; rebuild before collecting notices.',
      );
    for (const asset of inventory.assets) {
      if (hash(fs.readFileSync(path.join(root, asset.path))) !== asset.sha256)
        throw new Error(`Bundle changed after inventory: ${asset.path}`);
    }
    buildInputs.push({
      path: file,
      sha256: hash(bytes),
      compiler: inventory.compiler,
      assets: inventory.assets,
    });
    for (const item of inventory.packages)
      add(path.join(root, item.root), `bundle:${inventory.compiler}`, item);
  }
  const embeddedVisited = new Set();
  const walkEmbedded = (directory, container) => {
    const real = fs.realpathSync(directory);
    if (embeddedVisited.has(real)) return;
    embeddedVisited.add(real);
    if (!relative(real).startsWith('../')) {
      if (
        directory !== container &&
        fs.existsSync(path.join(directory, 'package.json'))
      ) {
        const metadata = JSON.parse(
          fs.readFileSync(path.join(directory, 'package.json')),
        );
        if (metadata.name && metadata.version)
          add(directory, 'embedded-runtime-metadata');
      }
      for (const child of fs.readdirSync(directory, { withFileTypes: true })) {
        if (child.name === 'node_modules' || child.name.startsWith('.'))
          continue;
        if (child.isDirectory())
          walkEmbedded(path.join(directory, child.name), container);
      }
    }
  };
  const runtimeVisited = new Set();
  const walkRuntime = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory).sort()) {
      if (name.startsWith('.')) continue;
      const child = path.join(directory, name);
      if (name.startsWith('@')) {
        walkRuntime(child);
        continue;
      }
      if (!fs.existsSync(path.join(child, 'package.json'))) continue;
      const real = fs.realpathSync(child);
      if (runtimeVisited.has(real)) continue;
      runtimeVisited.add(real);
      add(child, 'copied-runtime');
      walkEmbedded(child, child);
      walkRuntime(path.join(child, 'node_modules'));
    }
  };
  walkRuntime(path.join(root, 'release/app/node_modules'));
  // This directory is generated and ignored; remove stale copies from earlier builds.
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const records = [...packages.values()].sort((a, b) =>
    `${a.name}@${a.version}:${a.root}`.localeCompare(
      `${b.name}@${b.version}:${b.root}`,
    ),
  );
  let text =
    'THIRD-PARTY NOTICES\n\nExact local notices for production bundle modules and installed copied runtime packages.\nLicense declarations and this collection are not a completed redistribution review.\nBinary vendors and unresolved items are recorded in index.json.\n\n';
  for (const item of records) {
    item.origins.sort();
    const directory = path.join(root, item.root);
    const identifier = `${item.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}--${item.version}--${hash(Buffer.from(item.root)).slice(0, 12)}`;
    item.notices = [];
    text += `\n===== ${item.name}@${item.version} =====\nSource: ${item.root}\nDeclared license: ${JSON.stringify(item.declaredLicense)}\n`;
    for (const name of fs.readdirSync(directory).sort()) {
      const namedNotice = /^(licen[sc]e|copying|notice)([._-]|$)/i.test(name);
      const readme = /^readme([._-]|$)/i.test(name);
      if (!namedNotice && !readme) continue;
      const source = path.join(directory, name);
      if (!fs.statSync(source).isFile()) continue;
      if (!fs.realpathSync(source).startsWith(root + path.sep))
        throw new Error('Notice source is outside the repository');
      const bytes = fs.readFileSync(source);
      const decoded = bytes.toString('utf8');
      if (
        !namedNotice &&
        !(
          /permission is hereby granted/i.test(decoded) &&
          /the software is provided/i.test(decoded) &&
          /copyright/i.test(decoded)
        )
      )
        continue;
      const target = `packages/${identifier}/${name}`;
      fs.mkdirSync(path.dirname(path.join(output, target)), {
        recursive: true,
      });
      fs.writeFileSync(path.join(output, target), bytes);
      item.notices.push({
        source: `${item.root}/${name}`,
        copy: target,
        sha256: hash(bytes),
        bytes: bytes.length,
        basis: namedNotice ? 'notice-filename' : 'readme-with-MIT-grant-text',
      });
      text += `\n--- ${name} (exact bytes in ${target}) ---\n${bytes.toString('utf8')}\n`;
    }
    item.status = item.notices.length
      ? 'notice-files-collected'
      : 'missing-notice-file';
    if (!item.notices.length)
      text +=
        '\nNO NOTICE FILE COLLECTED. See unresolved list; do not infer permission from declaration.\n';
  }
  // Binary vendor notices live below the package root and require explicit collection.
  const vendorFiles = [
    'release/app/node_modules/sharp/vendor/8.14.5/linux-x64/THIRD-PARTY-NOTICES.md',
    'release/app/node_modules/sharp/vendor/8.14.5/linux-x64/versions.json',
    'release/app/node_modules/exiftool-vendored.pl/bin/LICENSE',
    'release/app/node_modules/exiftool-vendored.pl/bin/README',
  ];
  const vendors = [];
  for (const file of vendorFiles) {
    if (!fs.existsSync(path.join(root, file))) {
      vendors.push({ source: file, available: false });
      continue;
    }
    const bytes = fs.readFileSync(path.join(root, file));
    const target = `vendors/${path.basename(file)}-${hash(Buffer.from(file)).slice(0, 12)}`;
    fs.mkdirSync(path.dirname(path.join(output, target)), { recursive: true });
    fs.writeFileSync(path.join(output, target), bytes);
    vendors.push({
      source: file,
      available: true,
      copy: target,
      sha256: hash(bytes),
    });
    text += `\n===== Vendored material: ${file} =====\n${bytes.toString('utf8')}\n`;
  }
  fs.writeFileSync(path.join(output, 'THIRD_PARTY_NOTICES.txt'), text);
  fs.copyFileSync(
    path.join(root, 'docs/licenses/APP_LICENSE_STATUS.md'),
    path.join(output, 'APP_LICENSE_STATUS.md'),
  );
  const inventory = {
    formatVersion: 1,
    buildInputs,
    packages: records,
    vendors,
    unresolved: records
      .filter((item) => item.status === 'missing-notice-file')
      .map((item) => ({
        root: item.root,
        name: item.name,
        version: item.version,
        declaredLicense: item.declaredLicense,
      })),
    applicationDocuments: [
      {
        resourcePath: 'LICENSES/electron-react-boilerplate.txt',
        source: 'LICENSES/electron-react-boilerplate.txt',
        sha256: hash(
          fs.readFileSync(
            path.join(root, 'LICENSES/electron-react-boilerplate.txt'),
          ),
        ),
      },
      {
        resourcePath: 'CREDITS.md',
        source: 'CREDITS.md',
        sha256: hash(fs.readFileSync(path.join(root, 'CREDITS.md'))),
      },
      {
        resourcePath: 'THIRD_PARTY_NOTICES/APP_LICENSE_STATUS.md',
        source: 'docs/licenses/APP_LICENSE_STATUS.md',
        sha256: hash(
          fs.readFileSync(path.join(output, 'APP_LICENSE_STATUS.md')),
        ),
      },
      {
        resourcePath: 'THIRD_PARTY_NOTICES/THIRD_PARTY_NOTICES.txt',
        sha256: hash(
          fs.readFileSync(path.join(output, 'THIRD_PARTY_NOTICES.txt')),
        ),
      },
    ],
    completeRedistributionReview: false,
    limitations: [
      'Application-specific copyright notice unresolved',
      'Vendor conditions and non-Linux binaries need review',
      'Assets and tag database provenance need review',
    ],
  };
  fs.writeFileSync(
    path.join(output, 'index.json'),
    JSON.stringify(inventory, null, 2) + '\n',
  );
  process.stdout.write(
    `Notice collection: ${records.length} packages, ${inventory.unresolved.length} unresolved notice files\n`,
  );
  return inventory;
}
// electron-builder passes a context; keep it separate from collector options.
module.exports = () => collectNotices();
if (require.main === module) collectNotices();
