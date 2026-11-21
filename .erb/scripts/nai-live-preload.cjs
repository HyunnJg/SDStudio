const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('validation', {
  status: () => ipcRenderer.invoke('validation-status'),
  setToken: (token) => ipcRenderer.invoke('nai-auth-set', token, false),
  run: (evidence) => ipcRenderer.invoke('validation-run', evidence),
  cancel: () => ipcRenderer.invoke('validation-cancel'),
  after: (balance) => ipcRenderer.invoke('validation-after', balance),
});
