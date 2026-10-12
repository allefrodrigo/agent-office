import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { OfficeAPI, OfficeEvent } from '@shared/types'

const api: OfficeAPI = {
  getState: () => ipcRenderer.invoke('office:getState'),
  getLog: (id) => ipcRenderer.invoke('office:getLog', id),
  hire: (req) => ipcRenderer.invoke('office:hire', req),
  summon: (cwd, mode, brain) => ipcRenderer.invoke('office:summon', cwd, mode, brain),
  send: (id, text, attachments) => ipcRenderer.invoke('office:send', id, text, attachments ?? []),
  pathForFile: (file) => webUtils.getPathForFile(file),
  interrupt: (id) => ipcRenderer.invoke('office:interrupt', id),
  compact: (id) => ipcRenderer.invoke('office:compact', id),
  clearContext: (id) => ipcRenderer.invoke('office:clearContext', id),
  refreshUsage: () => ipcRenderer.invoke('office:refreshUsage'),
  checkAccounts: () => ipcRenderer.invoke('office:checkAccounts'),
  addAccount: (name) => ipcRenderer.invoke('office:addAccount', name),
  removeAccount: (id) => ipcRenderer.invoke('office:removeAccount', id),
  loginAccount: (id) => ipcRenderer.invoke('office:loginAccount', id),
  setAccountPool: (floorId, ids) => ipcRenderer.invoke('office:setAccountPool', floorId, ids),
  fire: (id) => ipcRenderer.invoke('office:fire', id),
  closeTerminal: (id) => ipcRenderer.invoke('office:closeTerminal', id),
  listSessions: () => ipcRenderer.invoke('office:listSessions'),
  recall: (id) => ipcRenderer.invoke('office:recall', id),
  openInTerminal: (id) => ipcRenderer.invoke('office:openInTerminal', id),
  respond: (d) => ipcRenderer.invoke('office:respond', d),
  ackResult: (id) => ipcRenderer.invoke('office:ackResult', id),
  pickFolder: (defaultPath) => ipcRenderer.invoke('office:pickFolder', defaultPath),
  installBridge: () => ipcRenderer.invoke('office:installBridge'),
  uninstallBridge: () => ipcRenderer.invoke('office:uninstallBridge'),
  saveSettings: (patch) => ipcRenderer.invoke('office:saveSettings', patch),
  createTicket: (draft) => ipcRenderer.invoke('office:createTicket', draft),
  updateTicket: (id, patch) => ipcRenderer.invoke('office:updateTicket', id, patch),
  moveTicket: (id, status, beforeId) => ipcRenderer.invoke('office:moveTicket', id, status, beforeId),
  commentTicket: (id, text) => ipcRenderer.invoke('office:commentTicket', id, text),
  deleteTicket: (id) => ipcRenderer.invoke('office:deleteTicket', id),
  closeTickets: (ids) => ipcRenderer.invoke('office:closeTickets', ids),
  listClosed: (search) => ipcRenderer.invoke('office:listClosed', search),
  reopenTicket: (id) => ipcRenderer.invoke('office:reopenTicket', id),
  assignTicket: (id, who) => ipcRenderer.invoke('office:assignTicket', id, who),
  delegateTicket: (id, target) => ipcRenderer.invoke('office:delegateTicket', id, target),
  openExternal: (url) => ipcRenderer.invoke('office:openExternal', url),
  revealPath: (p) => ipcRenderer.invoke('office:revealPath', p),
  radioVideo: () => ipcRenderer.invoke('office:radioVideo'),
  listSquads: (cwd) => ipcRenderer.invoke('office:listSquads', cwd),
  runSquad: (cwd, code, mode, note) => ipcRenderer.invoke('office:runSquad', cwd, code, mode, note),
  getLedger: (query) => ipcRenderer.invoke('office:getLedger', query ?? {}),
  getStats: () => ipcRenderer.invoke('office:getStats'),
  refreshStats: () => ipcRenderer.invoke('office:refreshStats'),
  saveMarkdown: (fileName, content) => ipcRenderer.invoke('office:saveMarkdown', fileName, content),
  onEvent: (cb) => {
    const listener = (_e: unknown, ev: OfficeEvent) => cb(ev)
    ipcRenderer.on('office:event', listener)
    return () => ipcRenderer.removeListener('office:event', listener)
  },
}

contextBridge.exposeInMainWorld('office', api)
