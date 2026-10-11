const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('playerAPI', {
  getNowPlaying: knownCoverId => ipcRenderer.invoke('now-playing', knownCoverId),
  getAudioLoopbackSource: () => ipcRenderer.invoke('audio-loopback-source'),
  control: (action, position) => ipcRenderer.invoke('media-control', action, position),
  openSourceApp: () => ipcRenderer.invoke('open-source-app'),
  close: () => ipcRenderer.send('window:close'),
  minimize: () => ipcRenderer.send('window:minimize'),
  togglePin: () => ipcRenderer.send('window:toggle-pin'),
  resizeBounds: (bounds) => ipcRenderer.invoke('window:resize-bounds', bounds),
  getWindowSize: () => ipcRenderer.invoke('window:get-size')
});
