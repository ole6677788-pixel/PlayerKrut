const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('playerAPI', {
  getNowPlaying: () => ipcRenderer.invoke('now-playing'),
  close: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
  togglePin: () => ipcRenderer.send('window:toggle-pin')
});
