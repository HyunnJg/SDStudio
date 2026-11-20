const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [mode, directory, ...electronArgs] = process.argv.slice(2);
if (!['check', 'start'].includes(mode)) {
  throw new Error('Expected check or start');
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
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
