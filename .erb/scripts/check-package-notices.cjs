// Check physical notice resources against actual ASAR build/package metadata. No execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const identity = require('./notice-package-identity.cjs');
const [directory, ...flags] = process.argv.slice(2);
if (!directory)
  throw new Error(
    'Usage: npm run package:check-notices -- /absolute/linux-unpacked [--require-notice-files]',
  );
const root = fs.realpathSync(directory);
const resources = path.join(root, 'resources');
const archive = path.join(resources, 'app.asar');
const folder = path.join(resources, 'THIRD_PARTY_NOTICES');
const required = [
  'LICENSE',
  'LICENSES/electron-react-boilerplate.txt',
  'LICENSES/tagcomplete-MIT.txt',
  'CREDITS.md',
  'THIRD_PARTY_NOTICES/THIRD_PARTY_NOTICES.txt',
  'THIRD_PARTY_NOTICES/index.json',
  'THIRD_PARTY_NOTICES/APP_LICENSE_STATUS.md',
];
for (const file of required)
  if (!fs.statSync(path.join(resources, file)).isFile())
    throw new Error(`Missing notice resource: ${file}`);
// ASAR's filesystem API expects host-native paths; inventories use portable '/'.
const extract = (name) => asar.extractFile(archive, path.normalize(name));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const electronDist = path.dirname(require('electron'));
const runtimeNotices = [
  ['LICENSE', 'LICENSE.electron.txt'],
  ['LICENSES.chromium.html', 'LICENSES.chromium.html'],
];
for (const [source, shipped] of runtimeNotices) {
  const expected = fs.readFileSync(path.join(electronDist, source));
  if (!expected.equals(fs.readFileSync(path.join(root, shipped))))
    throw new Error(`Electron runtime notice mismatch: ${shipped}`);
}
const index = JSON.parse(fs.readFileSync(path.join(folder, 'index.json')));
for (const doc of index.applicationDocuments) {
  const target = path.resolve(resources, doc.resourcePath);
  if (
    !target.startsWith(resources + path.sep) ||
    hash(fs.readFileSync(target)) !== doc.sha256
  )
    throw new Error(`Application notice hash mismatch: ${doc.resourcePath}`);
}
let copiedFiles = 0;
for (const entry of [
  ...index.packages.flatMap((p) => p.notices),
  ...index.vendors.filter((v) => v.available),
]) {
  const target = path.resolve(folder, entry.copy);
  if (!target.startsWith(folder + path.sep))
    throw new Error('Invalid notice copy path');
  if (hash(fs.readFileSync(target)) !== entry.sha256)
    throw new Error(`Notice hash mismatch: ${entry.copy}`);
  copiedFiles += 1;
}
let bundlePackages = 0;
for (const build of index.buildInputs) {
  const name = build.path.replace(/^release\/app\//, '');
  const bytes = extract(name);
  if (hash(bytes) !== build.sha256)
    throw new Error(`Bundle inventory mismatch: ${name}`);
  const graph = JSON.parse(bytes);
  for (const asset of graph.assets) {
    if (
      hash(extract(asset.path.replace(/^release\/app\//, ''))) !== asset.sha256
    )
      throw new Error(`Packaged bundle mismatch: ${asset.path}`);
  }
  for (const item of graph.packages) {
    if (
      !index.packages.some(
        (p) =>
          p.root === item.root &&
          p.packageJsonSha256 === item.packageJsonSha256,
      )
    )
      throw new Error(`Unindexed bundle package: ${item.root}`);
    bundlePackages += 1;
  }
}
let runtimePackages = 0;
for (const name of asar
  .listPackage(archive)
  .map((p) => p.replaceAll('\\', '/').replace(/^\//, ''))) {
  if (!name.startsWith('node_modules/') || !name.endsWith('/package.json'))
    continue;
  const bytes = extract(name);
  const data = JSON.parse(bytes);
  if (!data.name || !data.version) continue;
  if (
    !index.packages.some(
      (p) =>
        p.name === data.name &&
        p.version === data.version &&
        p.packageIdentitySha256 === identity(data),
    )
  )
    throw new Error(`Unindexed copied runtime package: ${name}`);
  runtimePackages += 1;
}
if (!runtimePackages)
  throw new Error('No copied runtime package metadata was inspected');
const result = {
  runtimeNoticesVerified: runtimeNotices.map(([, name]) => name),
  requiredResourcesPresent: required,
  noticeCopiesVerified: copiedFiles,
  bundlePackageOccurrencesIndexed: bundlePackages,
  copiedRuntimePackagesIndexed: runtimePackages,
  runtimeIdentityBasis:
    'name/version/license/author/repository (builder strips scripts and other build metadata)',
  unresolvedNoticeFiles: index.unresolved,
  allIdentifiedPackagesHaveNoticeFiles: index.unresolved.length === 0,
  completeRedistributionReview: false,
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (flags.includes('--require-notice-files') && index.unresolved.length)
  process.exitCode = 1;
