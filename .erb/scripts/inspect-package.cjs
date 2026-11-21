// Read an existing local package. Never build, publish or execute it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

const [directory, destination] = process.argv.slice(2);
if (!directory || !destination)
  throw new Error(
    'Usage: npm run package:manifest -- /absolute/linux-unpacked /absolute/manifest.jsonl',
  );
const root = fs.realpathSync(directory);
const requestedOutput = path.resolve(destination);
const output = path.join(
  fs.realpathSync(path.dirname(requestedOutput)),
  path.basename(requestedOutput),
);
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink())
  throw new Error('Output must not be a symlink');
const repository = path.resolve(__dirname, '../..');
const within = (child, parent) =>
  child === parent || child.startsWith(`${parent}${path.sep}`);
if (
  within(output, root) ||
  (within(output, repository) &&
    !within(output, path.join(repository, 'docs/validation')))
)
  throw new Error(
    'Write outside the package and source directories (docs/validation is allowed)',
  );
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const records = [];
function walk(directory, prefix = '') {
  for (const entry of fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      records.push({
        kind: 'symlink',
        path: name,
        target: fs.readlinkSync(full),
      });
    } else if (entry.isDirectory()) walk(full, name);
    else {
      const bytes = fs.readFileSync(full);
      records.push({
        kind: 'file',
        path: name,
        bytes: bytes.length,
        sha256: hash(bytes),
      });
    }
  }
}
if (!fs.existsSync(path.join(root, 'resources/app.asar')))
  throw new Error('Expected a packaged resources/app.asar');
walk(root);
const archive = path.join(root, 'resources/app.asar');
const members = asar
  .listPackage(archive)
  .map((name) => name.replace(/^\//, ''))
  .sort();
for (const name of members) {
  const stat = asar.statFile(archive, name, false);
  if (stat.files) continue;
  if (stat.link) {
    records.push({ kind: 'asar-link', path: name, target: stat.link });
    continue;
  }
  const bytes = asar.extractFile(archive, name);
  records.push({
    kind: 'asar-member',
    path: name,
    bytes: bytes.length,
    sha256: hash(bytes),
    unpacked: !!stat.unpacked,
  });
}
const packageJson = JSON.parse(
  asar.extractFile(archive, 'package.json').toString(),
);
const metadata = {
  formatVersion: 1,
  inspectionToolSha256: hash(fs.readFileSync(__filename)),
  asarToolVersion: require('@electron/asar/package.json').version,
  scope:
    'physical package files plus logical ASAR members (unpacked files appear in both views)',
  gitHeadAtInspection: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim(),
  dirtyAtInspection: !!execFileSync('git', ['status', '--porcelain'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim(),
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  archiveSha256: hash(fs.readFileSync(archive)),
  physicalFiles: records.filter((r) => r.kind === 'file').length,
  asarFiles: records.filter((r) => r.kind === 'asar-member').length,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  [metadata, ...records].map((row) => JSON.stringify(row)).join('\n') + '\n',
);
process.stdout.write(`${JSON.stringify(metadata)}\nManifest: ${output}\n`);
