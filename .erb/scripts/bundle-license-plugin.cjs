// Inventory packages from actual production compilation modules, including concatenated modules.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');

function packageRoot(resource, root) {
  let directory = path.dirname(resource.split('?')[0]);
  while (directory.startsWith(`${root}${path.sep}`)) {
    const file = path.join(directory, 'package.json');
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file));
      if (data.name && data.version)
        return { directory, data, bytes: fs.readFileSync(file) };
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Cannot resolve package for bundled module: ${resource}`);
}

class BundleLicensePlugin {
  constructor(label) {
    this.label = label;
  }
  apply(compiler) {
    const root = compiler.context;
    compiler.hooks.thisCompilation.tap('BundleLicensePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'BundleLicensePlugin',
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_REPORT,
        },
        () => {
          const packages = new Map();
          const visited = new Set();
          const visit = (module) => {
            if (visited.has(module)) return;
            visited.add(module);
            if (
              module.resource?.includes(`${path.sep}node_modules${path.sep}`)
            ) {
              const found = packageRoot(module.resource, root);
              const relative = path
                .relative(root, found.directory)
                .split(path.sep)
                .join('/');
              if (!packages.has(relative))
                packages.set(relative, {
                  root: relative,
                  name: found.data.name,
                  version: found.data.version,
                  declaredLicense: found.data.license ?? null,
                  packageJsonSha256: hash(found.bytes),
                  moduleCount: 0,
                });
              packages.get(relative).moduleCount += 1;
            }
            if (module.modules)
              for (const child of module.modules) visit(child);
            if (module.rootModule) visit(module.rootModule);
          };
          for (const module of compilation.modules) visit(module);
          const output = compiler.options.output.path;
          const assets = Object.entries(compilation.assets)
            .filter(([name]) => /\.(js|css)$/.test(name))
            .map(([name, source]) => ({
              path: path
                .relative(root, path.join(output, name))
                .split(path.sep)
                .join('/'),
              sha256: hash(source.buffer()),
            }))
            .sort((a, b) => a.path.localeCompare(b.path));
          const inventory = {
            formatVersion: 1,
            compiler: this.label,
            basis:
              'production compilation modules (conservative, may include tree-shaken/orphan modules); concatenated children included; externals separate',
            lockSha256: hash(
              fs.readFileSync(path.join(root, 'package-lock.json')),
            ),
            assets,
            packages: [...packages.values()].sort((a, b) =>
              a.root.localeCompare(b.root),
            ),
          };
          compilation.emitAsset(
            'bundle-licenses.json',
            new compiler.webpack.sources.RawSource(
              JSON.stringify(inventory, null, 2) + '\n',
            ),
          );
        },
      );
    });
  }
}
module.exports = BundleLicensePlugin;
