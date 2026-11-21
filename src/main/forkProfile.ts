/* eslint import/prefer-default-export: off */
import path from 'path';
import type { App } from 'electron';
import { FORK_APP_NAME } from '../appIdentity';
import { initializeDevelopmentProfile } from './developmentProfile';

export function initializeForkProfile(app: App, directory?: string) {
  app.setName(FORK_APP_NAME);
  const explicit = directory !== undefined;
  const profile = initializeDevelopmentProfile(
    app,
    directory ?? path.join(app.getPath('appData'), FORK_APP_NAME),
    process.platform,
    explicit ? undefined : ['sdstudio', 'SDStudio'],
  );
  return { ...profile, explicit };
}
