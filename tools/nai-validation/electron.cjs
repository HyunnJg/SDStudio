require('./register.cjs');
const { app } = require('electron');
try {
  require('../../.erb/scripts/nai-live-entry.cjs').start();
} catch {
  process.stderr.write('Validation profile/startup settings rejected.\n');
  app.exit(1);
}
