const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('s1', {
  config: () => ipcRenderer.invoke('s1:config'),
  gdm: (info) => ipcRenderer.send('s1:gdm', info),
  start: () => ipcRenderer.send('s1:start'),
  chunk: (seq, buf) => ipcRenderer.send('s1:chunk', { seq, buf }),
  ended: () => ipcRenderer.send('s1:ended'),
})
