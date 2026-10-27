const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('gaz', {
  info: () => ipcRenderer.invoke('info'),
  getSettings: () => ipcRenderer.invoke('settings-get'),
  setSettings: (s) => ipcRenderer.invoke('settings-set', s),
  pickBook: () => ipcRenderer.invoke('pick-book'),
  openDropped: (file) => ipcRenderer.invoke('open-book-path', webUtils.getPathForFile(file)),
  pickCover: () => ipcRenderer.invoke('pick-cover'),
  languages: (key) => ipcRenderer.invoke('languages', key),
  build: (opts) => ipcRenderer.invoke('build', opts),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
  openLink: (u) => ipcRenderer.invoke('open-link', u),
  onProgress: (fn) => ipcRenderer.on('progress', (_e, d) => fn(d)),
});
