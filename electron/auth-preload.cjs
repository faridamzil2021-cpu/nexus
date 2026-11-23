const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusDesktopAuth', Object.freeze({
  submitResult: (payload) => ipcRenderer.send('nexus:googleSignInResult', payload),
}));
