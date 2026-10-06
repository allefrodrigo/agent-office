import { contextBridge, ipcRenderer } from 'electron'
import type { OfficeAPI, OfficeEvent } from '@shared/types'

const api: OfficeAPI = {
  getState: () => ipcRenderer.invoke('office:getState'),
  getLog: (id) => ipcRenderer.invoke('office:getLog', id),
  hire: (req) => ipcRenderer.invoke('office:hire', req),
  send: (id, text) => ipcRenderer.invoke('office:send', id, text),
  interrupt: (id) => ipcRenderer.invoke('office:interrupt', id),
  fire: (id) => ipcRenderer.invoke('office:fire', id),
  closeTerminal: (id) => ipcRenderer.invoke('office:closeTerminal', id),
  listSessions: () => ipcRenderer.invoke('office:listSessions'),
  recall: (id) => ipcRenderer.invoke('office:recall', id),
  openInTerminal: (id) => ipcRenderer.invoke('office:openInTerminal', id),
  respond: (d) => ipcRenderer.invoke('office:respond', d),
  ackResult: (id) => ipcRenderer.invoke('office:ackResult', id),
  pickFolder: () => ipcRenderer.invoke('office:pickFolder'),
  installBridge: () => ipcRenderer.invoke('office:installBridge'),
  uninstallBridge: () => ipcRenderer.invoke('office:uninstallBridge'),
  saveSettings: (patch) => ipcRenderer.invoke('office:saveSettings', patch),
  openExternal: (url) => ipcRenderer.invoke('office:openExternal', url),
  revealPath: (p) => ipcRenderer.invoke('office:revealPath', p),
  onEvent: (cb) => {
    const listener = (_e: unknown, ev: OfficeEvent) => cb(ev)
    ipcRenderer.on('office:event', listener)
    return () => ipcRenderer.removeListener('office:event', listener)
  },
}

contextBridge.exposeInMainWorld('office', api)
