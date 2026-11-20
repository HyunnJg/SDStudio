import { app } from 'electron';
import { initializeDevelopmentProfile } from './developmentProfile';

// Imported before logging, native modules and DEFAULT_APP_DIR in main.ts.
const developmentProfile = (() => {
  try {
    return initializeDevelopmentProfile(
      app,
      process.env.SDSTUDIO_USER_DATA_DIR,
    );
  } catch (error: any) {
    process.stderr.write(`[SDStudio profile] ${error.message}\n`);
    app.exit(1);
    throw error;
  }
})();

if (developmentProfile.active) {
  process.stdout.write(
    `[SDStudio profile] ${JSON.stringify({
      userData: app.getPath('userData'),
      appDirectory: developmentProfile.appDirectory,
      checkOnly: process.env.SDSTUDIO_PROFILE_CHECK === '1',
    })}\n`,
  );
}

if (process.env.SDSTUDIO_PROFILE_CHECK === '1') {
  if (!developmentProfile.active) {
    process.stderr.write(
      '[SDStudio profile] A profile check requires SDSTUDIO_USER_DATA_DIR\n',
    );
    app.exit(1);
  } else {
    // Do not initialize the app, read config/tokens, start services or open a window.
    app.exit(0);
  }
}

export default developmentProfile;
