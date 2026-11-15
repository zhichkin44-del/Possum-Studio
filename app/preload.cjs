// Мост окно ↔ приложение: окно не видит Node, ключей и файлов — только эти вызовы.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('possum', {
  state: () => ipcRenderer.invoke('state'),
  job: (id) => ipcRenderer.invoke('job', id),
  redo: (id) => ipcRenderer.invoke('redo', id),
  scan: () => ipcRenderer.invoke('scan'),
  open: (what) => ipcRenderer.invoke('open', what),
  pick: () => ipcRenderer.invoke('pick'),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  connect: (kind) => ipcRenderer.invoke('connect', kind),
  publish: (id, platforms) => ipcRenderer.invoke('publish', { id, platforms }),
  onJobs: (fn) => { ipcRenderer.on('jobs', (_e, list) => fn(list)); },
});
