import fs from 'fs';
import path from 'path';

interface ProfileApp {
  getName(): string;
  getPath(name: 'userData' | 'appData'): string;
  setPath(
    name: 'userData' | 'sessionData' | 'logs' | 'crashDumps',
    value: string,
  ): void;
  isReady(): boolean;
}

export interface DevelopmentProfile {
  active: boolean;
  appDirectory: string;
}

// Resolve existing parents too, so a new directory below a symlink cannot
// silently point back into the original profile.
function canonicalPath(value: string): string {
  const absolute = path.resolve(value);
  try {
    return fs.realpathSync(absolute);
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
    if (path.dirname(absolute) === absolute) {
      throw new Error(
        'Cannot resolve the filesystem root of the development profile',
      );
    }
    return path.join(
      canonicalPath(path.dirname(absolute)),
      path.basename(absolute),
    );
  }
}

export function initializeDevelopmentProfile(
  app: ProfileApp,
  directory: string | undefined,
  platform = process.platform,
  protectedNames = [app.getName(), 'sdstudio', 'SDStudio'],
): DevelopmentProfile {
  if (directory === undefined) {
    const original = app.getPath('userData');
    return { active: false, appDirectory: path.join(original, 'SDStudio') };
  }
  if (!directory.trim() || !path.isAbsolute(directory)) {
    throw new Error('SDSTUDIO_USER_DATA_DIR must be a non-empty absolute path');
  }
  if (app.isReady()) {
    throw new Error(
      'Development profile must be selected before Electron is ready',
    );
  }

  const selected = canonicalPath(directory);
  const compare = (value: string) => {
    const canonical = canonicalPath(value);
    return platform === 'win32' || platform === 'darwin'
      ? canonical.toLowerCase()
      : canonical;
  };
  const candidate = compare(selected);
  const appData = app.getPath('appData');
  const originals = protectedNames.map((name) => path.join(appData, name));
  originals.forEach((existing) => {
    const originalPath = compare(existing);
    const overlaps = (parent: string, child: string) => {
      const relative = path.relative(parent, child);
      return (
        relative === '' ||
        (!relative.startsWith(`..${path.sep}`) &&
          relative !== '..' &&
          !path.isAbsolute(relative))
      );
    };
    if (
      overlaps(originalPath, candidate) ||
      overlaps(candidate, originalPath)
    ) {
      throw new Error(
        'Development profile must not overlap an original SDStudio profile',
      );
    }
  });

  const locations = [
    ['userData', selected],
    ['sessionData', path.join(selected, 'chromium')],
    ['logs', path.join(selected, 'logs')],
    ['crashDumps', path.join(selected, 'crash-dumps')],
  ] as const;
  const appDirectory = path.join(selected, 'SDStudio');
  [...locations.map(([, location]) => location), appDirectory].forEach(
    (location) => {
      const relative = path.relative(candidate, compare(location));
      if (
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      ) {
        throw new Error(
          'Development storage must remain inside the selected profile',
        );
      }
    },
  );
  locations.forEach(([name, location]) => {
    fs.mkdirSync(location, { recursive: true });
    app.setPath(name, location);
  });
  return { active: true, appDirectory };
}

export function storageDirectory(
  profile: DevelopmentProfile,
  savedLocation: string | undefined,
  currentDirectory: string,
): string {
  if (
    profile.active &&
    savedLocation &&
    savedLocation !== profile.appDirectory
  ) {
    process.stdout.write(
      '[SDStudio profile] Ignoring config.saveLocation in isolated mode\n',
    );
  }
  return profile.active
    ? profile.appDirectory
    : savedLocation || currentDirectory;
}
