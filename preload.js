const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('playerAPI', {
  getNowPlaying: () => ipcRenderer.invoke('now-playing'),
  control: action => ipcRenderer.invoke('media-control', action),
  openSourceApp: () => ipcRenderer.invoke('open-source-app'),
  close: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
  togglePin: () => ipcRenderer.send('window:toggle-pin'),
  scale: delta => ipcRenderer.send('window:scale', delta)
});
