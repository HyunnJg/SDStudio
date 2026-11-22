// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { NaiAuthResult } from '../naiAuth';
import type { ProjectClient } from '../workspaceProject';
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

const electronHandler = {
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
  projects: {
    list: () => ipcRenderer.invoke('workspace-project-list'),
    create: (content) =>
      ipcRenderer.invoke('workspace-project-create', content),
    open: (id) => ipcRenderer.invoke('workspace-project-open', id),
    save: (id, revision, content) =>
      ipcRenderer.invoke('workspace-project-save', id, revision, content),
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
