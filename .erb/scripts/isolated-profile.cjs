const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseArguments(argv) {
  const [mode, ...remaining] = argv;
  if (!['check', 'start'].includes(mode))
    throw new Error('Expected check or start');
  const directory =
    remaining[0] && !remaining[0].startsWith('-')
      ? remaining.shift()
      : undefined;
  return { mode, directory, electronArgs: remaining };
}

function extraElectronArgs(value) {
  const args = value ? JSON.parse(value) : [];
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error(
      'SDSTUDIO_TEST_ELECTRON_ARGS must be a JSON array of strings',
    );
  }
  return args;
}

function main() {
  const { mode, directory, electronArgs } = parseArguments(
    process.argv.slice(2),
  );
  if (mode === 'start' && !process.env.npm_execpath) {
    throw new Error(
      'Run start:isolated through npm so npm_execpath is available',
    );
  }
  const root = path.resolve(__dirname, '../..');
  const profile = path.resolve(
    directory || path.join(root, '.sdstudio-dev-profile'),
  );
  const env = { ...process.env, SDSTUDIO_USER_DATA_DIR: profile };
  const args =
    mode === 'check'
      ? [
          require.resolve('electron/cli.js'),
          '-r',
          'ts-node/register/transpile-only',
          '.',
          ...electronArgs,
        ]
      : [process.env.npm_execpath, 'start'];
  if (mode === 'check') env.SDSTUDIO_PROFILE_CHECK = '1';
  else delete env.SDSTUDIO_PROFILE_CHECK;
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  });
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  return result.status ?? 1;
}

module.exports = { parseArguments, extraElectronArgs };
if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
