/* eslint import/prefer-default-export: off */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { LibraryError } from '../../promptLibrary';
import type { LibraryReply } from '../../promptLibrary';
import type { PromptLibraryStore } from './promptLibraryStore';

export function registerPromptLibrary(
  ipc: Pick<IpcMain, 'handle'>,
  store: PromptLibraryStore,
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const actions = {
    'prompt-library-read': () => store.read(),
    'prompt-library-save': (
      revision: string,
      content: import('../../promptLibrary').PresetContent,
      id?: string,
    ) => store.save(revision, content, id),
    'prompt-library-deleted': (
      revision: string,
      id: string,
      deleted: boolean,
    ) => store.setDeleted(revision, id, deleted),
    'prompt-library-remove': (revision: string, id: string) =>
      store.remove(revision, id),
  };
  Object.entries(actions).forEach(([channel, action]) =>
    ipc.handle(channel, async (event, ...args): Promise<LibraryReply> => {
      try {
        if (!trusted(event)) throw new LibraryError('LIBRARY_UNTRUSTED');
        const value = await (
          action as (
            ...args: unknown[]
          ) => Promise<import('../../promptLibrary').LibrarySnapshot>
        )(...args);
        if (!trusted(event)) throw new LibraryError('LIBRARY_UNTRUSTED');
        return { ok: true, value };
      } catch (error) {
        return {
          ok: false,
          code: error instanceof LibraryError ? error.code : 'LIBRARY_IO',
        };
      }
    }),
  );
}
