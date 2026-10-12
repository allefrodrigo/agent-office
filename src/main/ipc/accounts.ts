import { ipcMain } from 'electron'
import { MAIN_ACCOUNT } from '@shared/accounts'
import { accountNameSchema, cleanAccountIds, floorIdSchema, parse } from '../validate'
import { id, type IpcContext } from './context'

/** Claude accounts: add, remove, log in and the pool of each floor. */
export function registerAccountsIpc(ctx: IpcContext): void {
  const { store, usage, accounts, broadcast } = ctx
  ipcMain.handle('office:checkAccounts', () => accounts.check())
  ipcMain.handle('office:addAccount', (_e, name: unknown) => {
    const account = accounts.create(accountNameSchema.parse(name))
    store.settings = { ...store.settings, accounts: [...store.settings.accounts, account] }
    broadcast({ type: 'settings', settings: store.settings })
    void accounts.check()
    void usage.refresh()
    return store.settings
  })
  ipcMain.handle('office:removeAccount', (_e, raw: unknown) => {
    const gone = id(raw)
    if (gone === MAIN_ACCOUNT) throw new Error('A conta principal não pode ser removida.')
    const s = store.settings
    const drop = (ids?: string[]) => ids?.filter((x) => x !== gone)
    store.settings = {
      ...s,
      accounts: s.accounts.filter((a) => a.id !== gone),
      defaultAccounts: drop(s.defaultAccounts) ?? [],
      projects: s.projects.map((p) => ({ ...p, accounts: drop(p.accounts) })),
    }
    broadcast({ type: 'settings', settings: store.settings })
    broadcast({ type: 'accounts', accounts: accounts.statuses() })
    broadcast({ type: 'usage', usage: usage.current() })
    return store.settings
  })
  ipcMain.handle('office:loginAccount', (_e, raw: unknown) => accounts.login(id(raw)))
  ipcMain.handle('office:setAccountPool', (_e, rawFloor: unknown, ids: unknown) => {
    const floorId = parse(floorIdSchema, rawFloor, 'Esse andar não existe mais.')
    const s = store.settings
    const pool = cleanAccountIds(ids, s.accounts)
    if (floorId === null) store.settings = { ...s, defaultAccounts: pool }
    else if (s.projects.some((p) => p.id === floorId)) store.settings = { ...s, projects: s.projects.map((p) => (p.id === floorId ? { ...p, accounts: pool.length ? pool : undefined } : p)) }
    else throw new Error('Esse andar não existe mais.')
    broadcast({ type: 'settings', settings: store.settings })
    return store.settings
  })
}
