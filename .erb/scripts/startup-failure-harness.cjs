// Child-process fixture: fail only the tag DB read, observe the error dialog and quit.
const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { app } = electron;
if (process.env.SDSTUDIO_SMOKE_SKIP_SINGLETON === '1')
  app.requestSingleInstanceLock = () => true;
const readFile = fs.promises.readFile.bind(fs.promises);
fs.promises.readFile = async (filename, ...args) => {
  if (path.basename(String(filename)) === 'db.csv')
    throw Object.assign(new Error('Synthetic missing tag DB: db.csv'), {
      code: 'ENOENT',
    });
  return readFile(filename, ...args);
};
let reported;
// Load dialog only after profileBootstrap has selected all storage paths.
app.once('ready', () => {
  electron.dialog.showErrorBox = (title, message) => {
    reported = { title, message };
  };
});
const exit = app.exit.bind(app);
app.exit = (code) => {
  fs.writeFileSync(
    process.env.SDSTUDIO_SMOKE_REPORT,
    JSON.stringify(
      {
        reported,
        windowCount: electron.BrowserWindow.getAllWindows().length,
        quitObserved: true,
        singleInstanceLockSimulated:
          process.env.SDSTUDIO_SMOKE_SKIP_SINGLETON === '1',
      },
      null,
      2,
    ),
  );
  exit(code);
};
