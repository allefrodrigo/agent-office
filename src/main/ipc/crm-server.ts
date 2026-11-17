// "Servidor local" da Sala de CRM: o estado da Evolution em Docker (ou Colima) e os botões de
// ligar e desligar. O renderer só escolhe a ação; validate.ts confere antes.
import { ipcMain } from 'electron'
import { LocalServer } from '../crm/server'
import { cleanCrmServerAction } from '../validate'
import type { IpcContext } from './context'

/** The channel the preload uses, by name. Exported for the tests. */
export function crmServerHandlers(server: Pick<LocalServer, 'act'>): Record<string, (...args: unknown[]) => unknown> {
  return {
    'office:crmServer': (action) => server.act(cleanCrmServerAction(action)),
  }
}

export function registerCrmServerIpc(ctx: Pick<IpcContext, 'broadcast'>, dir: string): LocalServer {
  const server = new LocalServer({ dir, broadcast: (status) => ctx.broadcast({ type: 'crm:server', status }) })
  for (const [channel, handler] of Object.entries(crmServerHandlers(server)))
    ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args))
  return server
}
