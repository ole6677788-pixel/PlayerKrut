const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('playerAPI', {
  getNowPlaying: () => ipcRenderer.invoke('now-playing'),
  control: (action, position) => ipcRenderer.invoke('media-control', action, position),
  openSourceApp: () => ipcRenderer.invoke('open-source-app'),
  close: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
  togglePin: () => ipcRenderer.send('window:toggle-pin'),
  resizeTo: (width, height) => ipcRenderer.invoke('window:resize-to', width, height),
  getWindowSize: () => ipcRenderer.invoke('window:get-size')
});
