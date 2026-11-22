/* eslint import/prefer-default-export: off */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { ProjectError } from '../../workspaceProject';
import type { ProjectReply } from '../../workspaceProject';
import type { ProjectStore } from './projectStore';

// Local persistence is available offline. Same approved top-level document boundary as auth.
export function registerProjects(
  ipc: Pick<IpcMain, 'handle'>,
  store: ProjectStore,
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const handle = (channel: string, action: (...args: any[]) => unknown) => {
    ipc.handle(channel, (event, ...args): ProjectReply<unknown> => {
      try {
        if (!trusted(event)) throw new ProjectError('PROJECT_UNTRUSTED');
        return { ok: true, value: action(...args) };
      } catch (error) {
        return {
          ok: false,
          code: error instanceof ProjectError ? error.code : 'PROJECT_IO',
        };
      }
    });
  };
  handle('workspace-project-list', () => store.list());
  handle('workspace-project-create', (content) => store.create(content));
  handle('workspace-project-open', (id) => store.open(id));
  handle('workspace-project-save', (id, revision, content) =>
    store.save(id, revision, content),
  );
  handle('workspace-project-history', (id) => store.history(id));
  handle('workspace-project-recover', (id, revision) =>
    store.recover(id, revision),
  );
}
