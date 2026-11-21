// Only a private profile path is accepted. Credentials go directly into the GUI.
const path = require('node:path');
const { spawn } = require('node:child_process');
if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) {
  process.stderr.write('Usage: npm start -- /absolute/private-profile\n');
  process.exit(2);
}
const child = spawn(
  require('electron'),
  [path.join(__dirname, 'electron.cjs'), process.argv[2]],
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
