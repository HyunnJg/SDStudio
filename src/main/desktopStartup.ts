import path from 'path';

export function usesDevelopmentAssets(
  packaged: boolean,
  nodeEnv: string | undefined,
): boolean {
  return !packaged && nodeEnv === 'development';
}

export function resolvePreloadPath(directory: string, development: boolean) {
  return development
    ? path.join(directory, '../../.erb/dll/preload.js')
    : path.join(directory, 'preload.js');
}

interface StartupHooks {
  ready: () => Promise<void>;
  initialize: () => Promise<void>;
  open: () => Promise<void>;
  logError: (error: unknown) => void;
  showError: (title: string, message: string) => void;
  quit: () => void;
}

export async function startDesktop(hooks: StartupHooks): Promise<void> {
  try {
    await hooks.ready();
    await hooks.initialize();
    await hooks.open();
  } catch (error) {
    try {
      hooks.logError(error);
    } catch {
      // A log-directory permission error must not hide the startup error dialog.
    }
    try {
      hooks.showError(
        'SDStudio 시작 실패',
        `초기화에 실패했습니다.\n${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      hooks.quit();
    }
  }
}
