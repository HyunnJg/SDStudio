/* eslint import/prefer-default-export: off */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { ProjectError } from '../../workspaceProject';
import type { ProjectReply } from '../../workspaceProject';
import type { ProjectStore } from './projectStore';

export type ProjectOperations = { restartStorage?: () => Promise<void> } & {
  [
    K in
      | 'list'
      | 'create'
      | 'open'
      | 'save'
      | 'history'
      | 'recover'
      | 'copy'
      | 'listTrash'
      | 'trashProject'
      | 'restoreProject'
      | 'setImageDeleted'
  ]: (
    ...args: Parameters<ProjectStore[K]>
  ) => ReturnType<ProjectStore[K]> | Promise<ReturnType<ProjectStore[K]>>;
};

// Local persistence is available offline. Same approved top-level document boundary as auth.
export function registerProjects(
  ipc: Pick<IpcMain, 'handle'>,
  store: ProjectOperations,
  trusted: (event: IpcMainInvokeEvent) => boolean,
  mutation: (
    action: () => Promise<unknown>,
    trashedProjectId?: string,
  ) => Promise<unknown> = async (action) => action(),
) {
  const handle = (channel: string, action: (...args: any[]) => unknown) => {
    ipc.handle(
      channel,
      async (event, ...args): Promise<ProjectReply<unknown>> => {
        try {
          if (!trusted(event)) throw new ProjectError('PROJECT_UNTRUSTED');
          const value = await action(...args);
          if (!trusted(event)) throw new ProjectError('PROJECT_UNTRUSTED');
          return { ok: true, value };
        } catch (error) {
          return {
            ok: false,
            code: error instanceof ProjectError ? error.code : 'PROJECT_IO',
          };
        }
      },
    );
  };
  handle('workspace-project-restart-storage', () => {
    if (!store.restartStorage)
      throw new ProjectError('PROJECT_SERVICE_STOPPED');
    return store.restartStorage();
  });
  handle('workspace-project-list', () => store.list());
  handle('workspace-project-list-trash', () => store.listTrash());
  handle('workspace-project-trash', (id) =>
    mutation(async () => store.trashProject(id), id),
  );
  handle('workspace-project-restore', (id) =>
    mutation(async () => store.restoreProject(id)),
  );
  handle('workspace-project-image-deleted', (id, revision, imageId, deleted) =>
    mutation(async () => store.setImageDeleted(id, revision, imageId, deleted)),
  );
  handle('workspace-project-create', (content, referenceSourceId) =>
    store.create(content, referenceSourceId),
  );
  handle('workspace-project-open', (id) => store.open(id));
  handle('workspace-project-save', (id, revision, content) =>
    store.save(id, revision, content),
  );
  handle('workspace-project-copy', (id, revision, content) =>
    store.copy(id, revision, content),
  );
  handle('workspace-project-history', (id) => store.history(id));
  handle('workspace-project-recover', (id, revision) =>
    store.recover(id, revision),
  );
}
