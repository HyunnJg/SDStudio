// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { isProvider } from '../recipeAssistant';
import type { NaiAuthResult } from '../naiAuth';
import type { CutRequest, CutResult, Provider } from '../recipeAssistant';
import type { GenerationClient } from '../workspaceGeneration';
import type { ProjectClient } from '../workspaceProject';
import type { LibraryClient } from '../promptLibrary';
import type { NetworkMode, NetworkModeResult } from '../networkMode';

export type Channels =
  | 'write-file'
  | 'read-file'
  | 'delete-file'
  | 'image-gen'
  | 'inpaint-image'
  | 'list-files'
  | 'prompt'
  | 'login'
  | 'rename-file'
  | 'rename-dir'
  | 'write-data-file'
  | 'read-data-file'
  | 'copy-file'
  | 'close'
  | 'show-file'
  | 'zip-files'
  | 'get-version'
  | 'open-web-page'
  | 'search-tags'
  | 'load-pieces-db'
  | 'get-config'
  | 'set-config'
  | 'search-pieces'
  | 'trash-file'
  | 'delete-dir'
  | 'spawn-local-ai'
  | 'is-local-ai-running'
  | 'resize-image'
  | 'exist-file'
  | 'open-image-editor'
  | 'watch-image'
  | 'unwatch-image'
  | 'load-model'
  | 'extract-zip'
  | 'download'
  | 'remove-bg'
  | 'select-dir'
  | 'unzip-files'
  | 'select-file'
  | 'get-remain-credits'
  | 'copy-image-to-clipboard'
  | 'lookup-tag';

function providerAuth(
  provider: Provider,
  operation: 'status' | 'set' | 'clear',
  ...args: unknown[]
) {
  if (!isProvider(provider))
    return Promise.resolve({
      ok: false as const,
      code: 'INVALID_INPUT' as const,
    });
  return ipcRenderer.invoke(`${provider}-auth-${operation}`, ...args);
}
const electronHandler = {
  providerKeys: {
    status: (provider: Provider): Promise<NaiAuthResult> =>
      providerAuth(provider, 'status'),
    set: (
      provider: Provider,
      key: string,
      remember: boolean,
    ): Promise<NaiAuthResult> => providerAuth(provider, 'set', key, remember),
    clear: (provider: Provider): Promise<NaiAuthResult> =>
      providerAuth(provider, 'clear'),
  },
  recipeAssistant: {
    status: (): Promise<NaiAuthResult> =>
      ipcRenderer.invoke('gemini-auth-status'),
    setKey: (key: string, remember: boolean): Promise<NaiAuthResult> =>
      ipcRenderer.invoke('gemini-auth-set', key, remember),
    clear: (): Promise<NaiAuthResult> =>
      ipcRenderer.invoke('gemini-auth-clear'),
    suggest: (request: CutRequest, requestId?: string): Promise<CutResult> =>
      ipcRenderer.invoke('gemini-suggest-cuts', request, requestId),
    cancel: (requestId: string): Promise<boolean> =>
      ipcRenderer.invoke('vibe-cancel-cuts', requestId),
  },
  promptLibrary: {
    importPresets: (revision, values) => ipcRenderer.invoke('prompt-library-import', revision, values),
    read: () => ipcRenderer.invoke('prompt-library-read'),
    save: (revision, content, id) =>
      ipcRenderer.invoke('prompt-library-save', revision, content, id),
    setDeleted: (revision, id, deleted) =>
      ipcRenderer.invoke('prompt-library-deleted', revision, id, deleted),
    remove: (revision, id) =>
      ipcRenderer.invoke('prompt-library-remove', revision, id),
  } satisfies LibraryClient,
  networkMode: {
    status: (): Promise<NetworkModeResult> =>
      ipcRenderer.invoke('network-mode-status'),
    set: (mode: NetworkMode): Promise<NetworkModeResult> =>
      ipcRenderer.invoke('network-mode-set', mode),
    reset: (): Promise<NetworkModeResult> =>
      ipcRenderer.invoke('network-mode-reset'),
    restart: (): Promise<NetworkModeResult> =>
      ipcRenderer.invoke('network-mode-restart'),
  },
  naiAuth: {
    status: (): Promise<NaiAuthResult> => ipcRenderer.invoke('nai-auth-status'),
    setToken: (token: string, remember: boolean): Promise<NaiAuthResult> =>
      ipcRenderer.invoke('nai-auth-set', token, remember),
    clear: (): Promise<NaiAuthResult> => ipcRenderer.invoke('nai-auth-clear'),
    check: (): Promise<NaiAuthResult> => ipcRenderer.invoke('nai-auth-check'),
  },
  projectLifecycle: {
    onCloseRequested: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('workspace-close-request', listener);
      return () => {
        ipcRenderer.removeListener('workspace-close-request', listener);
      };
    },
    finishClose: (): Promise<boolean> =>
      ipcRenderer.invoke('workspace-close-finish'),
    cancelClose: (): Promise<boolean> =>
      ipcRenderer.invoke('workspace-close-cancel'),
  },
  generation: {
    importReference: (id, revision, png, purpose) =>
      ipcRenderer.invoke(
        'workspace-generation-import-reference',
        id,
        revision,
        png,
        purpose,
      ),
    referenceImage: (id, sceneId, purpose) =>
      ipcRenderer.invoke(
        'workspace-generation-reference-image',
        id,
        sceneId,
        purpose,
      ),
    status: () => ipcRenderer.invoke('workspace-generation-status'),
    prepare: (id, revision, sceneId) =>
      ipcRenderer.invoke('workspace-generation-prepare', id, revision, sceneId),
    run: (ticket, confirmed) =>
      ipcRenderer.invoke('workspace-generation-run', ticket, confirmed),
    prepareQueue: (id, revision, sceneIds, repeats, interval) =>
      ipcRenderer.invoke(
        'workspace-generation-prepare-queue',
        id,
        revision,
        sceneIds,
        repeats,
        interval,
      ),
    prepareRemaining: (queueId, id, revision, interval) =>
      ipcRenderer.invoke(
        'workspace-generation-prepare-remaining',
        queueId,
        id,
        revision,
        interval,
      ),
    runQueue: (ticket, confirmed) =>
      ipcRenderer.invoke('workspace-generation-run-queue', ticket, confirmed),
    excludePendingScene: (queueId, sceneId, confirmed) =>
      ipcRenderer.invoke(
        'workspace-generation-exclude-scene',
        queueId,
        sceneId,
        confirmed,
      ),
    clearQueue: () => ipcRenderer.invoke('workspace-generation-clear-queue'),
    queueStatus: (revision) =>
      ipcRenderer.invoke('workspace-generation-queue-status', revision),
    cancel: () => ipcRenderer.invoke('workspace-generation-cancel'),
    retrySave: (asNewProject) =>
      ipcRenderer.invoke('workspace-generation-retry-save', asNewProject),
    discardPending: () => ipcRenderer.invoke('workspace-generation-discard'),
    image: (id, imageId) =>
      ipcRenderer.invoke('workspace-generation-image', id, imageId),
  } satisfies GenerationClient,
  projects: {
    resultPicks: (id) =>
      ipcRenderer.invoke('workspace-project-result-picks', id),
    setResultPicks: (id, revision, ids, picked) =>
      ipcRenderer.invoke(
        'workspace-project-set-result-picks',
        id,
        revision,
        ids,
        picked,
      ),
    exportResults: (id, ids) =>
      ipcRenderer.invoke('workspace-project-export-results', id, ids),
    restartStorage: () =>
      ipcRenderer.invoke('workspace-project-restart-storage'),
    list: () => ipcRenderer.invoke('workspace-project-list'),
    listTrash: () => ipcRenderer.invoke('workspace-project-list-trash'),
    copyLegacyScene: (name, key, withPicks, page) => ipcRenderer.invoke('workspace-project-copy-legacy-scene', name, key, withPicks, page),
    copyLegacyMasks: (name, selected) => ipcRenderer.invoke('workspace-project-copy-legacy-masks', name, selected),
    trashProject: (id) => ipcRenderer.invoke('workspace-project-trash', id),
    purgeProject: (id, confirmed) =>
      ipcRenderer.invoke('workspace-project-purge', id, confirmed),
    restoreProject: (id) => ipcRenderer.invoke('workspace-project-restore', id),
    emptyResultTrash: (id, revision, confirmed) =>
      ipcRenderer.invoke(
        'workspace-project-empty-result-trash',
        id,
        revision,
        confirmed,
      ),
    setImageDeleted: (id, revision, imageId, deleted) =>
      ipcRenderer.invoke(
        'workspace-project-image-deleted',
        id,
        revision,
        imageId,
        deleted,
      ),
    create: (content, referenceSourceId) =>
      ipcRenderer.invoke(
        'workspace-project-create',
        content,
        referenceSourceId,
      ),
    open: (id) => ipcRenderer.invoke('workspace-project-open', id),
    save: (id, revision, content) =>
      ipcRenderer.invoke('workspace-project-save', id, revision, content),
    copy: (id, revision, content) =>
      ipcRenderer.invoke('workspace-project-copy', id, revision, content),
    history: (id) => ipcRenderer.invoke('workspace-project-history', id),
    recover: (id, revision) =>
      ipcRenderer.invoke('workspace-project-recover', id, revision),
  } satisfies ProjectClient,
  runtime: {
    offline: process.argv.includes('--sdstudio-offline'),
    mockBackend: process.argv.includes('--sdstudio-mock-backend'),
  },
  ipcRenderer: {
    on(channel: string, func: (...args: any[]) => void | Promise<void>) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
    invoke(channel: Channels, ...args: unknown[]) {
      return ipcRenderer.invoke(channel, ...args);
    },
    onClose(func: () => void) {
      ipcRenderer.on('close', func);
    },
  },
};

contextBridge.exposeInMainWorld('electron', electronHandler);

export type ElectronHandler = typeof electronHandler;
