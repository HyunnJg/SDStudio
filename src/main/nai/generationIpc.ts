/* eslint import/prefer-default-export: off */
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { GenerationReply } from '../../workspaceGeneration';
import { ProjectError } from '../../workspaceProject';
import { GenerationError, WorkspaceGeneration } from './workspaceGeneration';

export function registerGeneration(
  ipc: Pick<IpcMain, 'handle'>,
  service: WorkspaceGeneration,
  trusted: (event: IpcMainInvokeEvent) => boolean,
) {
  const handle = (channel: string, action: (...args: any[]) => unknown) => {
    ipc.handle(
      channel,
      async (event, ...args): Promise<GenerationReply<unknown>> => {
        try {
          if (!trusted(event)) throw new GenerationError('UNTRUSTED_SENDER');
          const value = await action(...args);
          if (!trusted(event)) throw new GenerationError('UNTRUSTED_SENDER');
          return { ok: true, value };
        } catch (error) {
          if (error instanceof GenerationError)
            return {
              ok: false,
              code: error.code,
              mayHaveReachedServer: error.mayHaveReachedServer,
              ...(error.httpStatus !== undefined
                ? { httpStatus: error.httpStatus }
                : {}),
              ...(error.projectCode ? { projectCode: error.projectCode } : {}),
              ...(error.pendingResult ? { pendingResult: true } : {}),
              ...(error.conflictSceneId
                ? { conflictSceneId: error.conflictSceneId }
                : {}),
            };
          return {
            ok: false,
            code: error instanceof ProjectError ? error.code : 'INVALID_INPUT',
            mayHaveReachedServer: false,
          };
        }
      },
    );
  };
  handle(
    'workspace-generation-import-reference',
    (id, revision, png, purpose) =>
      service.importReference(id, revision, png, purpose),
  );
  handle('workspace-generation-reference-image', (id, sceneId) =>
    service.referenceImage(id, sceneId),
  );
  handle('workspace-generation-status', () => service.status());
  handle('workspace-generation-prepare', (id, revision, sceneId) =>
    service.prepare(id, revision, sceneId),
  );
  handle('workspace-generation-run', (ticket, confirmed) =>
    service.run(ticket, confirmed),
  );
  handle(
    'workspace-generation-prepare-queue',
    (id, revision, sceneIds, repeats) =>
      service.prepareQueue(id, revision, sceneIds, repeats),
  );
  handle('workspace-generation-prepare-remaining', (queueId, id, revision) =>
    service.prepareRemaining(queueId, id, revision),
  );
  handle('workspace-generation-run-queue', (ticket, confirmed) =>
    service.runQueue(ticket, confirmed),
  );
  handle('workspace-generation-exclude-scene', (queueId, sceneId, confirmed) =>
    service.excludePendingScene(queueId, sceneId, confirmed),
  );
  handle('workspace-generation-clear-queue', () => service.clearQueue());
  handle('workspace-generation-queue-status', (revision) =>
    service.queueStatus(revision),
  );
  handle('workspace-generation-cancel', () => service.cancel());
  handle('workspace-generation-retry-save', (asNewProject) =>
    service.retrySave(asNewProject),
  );
  handle('workspace-generation-discard', () => service.discardPending());
  handle('workspace-generation-image', (id, imageId) =>
    service.image(id, imageId),
  );
}
