// No token or account identifier is accepted in CLI arguments/environment.
const path = require('node:path'),
  { spawn } = require('node:child_process');
if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) {
  process.stderr.write(
    'Usage: npm run nai:validate-live -- /absolute/private-profile\n',
  );
  process.exit(2);
}
const child = spawn(
  require('electron'),
  [path.join(__dirname, 'nai-live-entry.cjs'), process.argv[2]],
  {
    stdio: 'inherit',
    env: { ...process.env, SDSTUDIO_LIVE_VALIDATION: '1' },
  },
);
child.on('error', () => {
  process.stderr.write('Validation process could not start.\n');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
