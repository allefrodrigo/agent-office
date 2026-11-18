// Configurações → CRM → WhatsApp (CR-10): endereço da Evolution, instância e token, "Conectar"
// (QR code), "Testar" e "Desconectar". Todo argumento passa por validate.ts; o token entra aqui,
// vai para o cofre e nunca volta ao renderer.
import { ipcMain } from 'electron'
import type { CrmQr, CrmWhatsappInfo } from '@shared/types'
import { log, secret } from '../log'
import { cleanCrmWhatsappDraft } from '../validate'
import { ConversationStore } from '../crm/conversations'
import { EvolutionClient, evolutionBase, lanExposed } from '../crm/evolution'
import { EvolutionEvents } from '../crm/events'
import { CrmVault, NO_VAULT } from '../crm/vault'
import type { IpcContext } from './context'

/** "Testar" before the coordinator ties it to the Outbox (CR-14): only the Outbox sends. */
export const NO_SELF_TEST = 'O teste chega com a fila de envio.'

export interface CrmWhatsappDeps {
  vault: CrmVault
  events: EvolutionEvents
  /** Builds a client (the tests pass one with a fake fetch). */
  client(cfg: { url: string; instance: string; token: string }): EvolutionClient
  /** The local Evolution answers on the network too? */
  lan(client: EvolutionClient): Promise<boolean>
}

export interface CrmWhatsappApi {
  info(): CrmWhatsappInfo
  save(raw: unknown): Promise<CrmWhatsappInfo>
  connect(): Promise<CrmQr>
  test(): Promise<string>
  disconnect(): Promise<void>
  /** CR-14: "Testar" sends the fixed message to the connected number through the Outbox. */
  setSelfTest(fn: (() => Promise<string>) | undefined): void
  /** Starts the link from what the vault has (or says why it cannot). */
  start(): void
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export function crmWhatsappApi(deps: CrmWhatsappDeps): CrmWhatsappApi {
  let selfTest: (() => Promise<string>) | undefined

  /** The client from the vault; null without address, instance or token. */
  const fromVault = (): EvolutionClient | null => {
    const s = deps.vault.settings()
    const token = deps.vault.token()
    if (!s.instance || !token) return null
    return deps.client({ url: s.url, instance: s.instance, token })
  }

  const start = () => {
    try {
      deps.events.start(fromVault())
    } catch (err) {
      deps.events.fail(errorText(err))
    }
  }

  const info = (): CrmWhatsappInfo => {
    const s = deps.vault.settings()
    return { url: s.url, instance: s.instance, hasToken: s.hasToken, vault: deps.vault.available(), connection: deps.events.current() }
  }

  /** The link now, started on demand (the CRM was turned on after the app opened). */
  const linked = (): EvolutionClient => {
    if (!deps.events.evolution() && deps.events.current().state === 'off') start()
    const c = deps.events.evolution()
    if (!c) {
      const s = deps.vault.settings()
      if (s.instance && s.hasToken && !deps.vault.available()) throw new Error(NO_VAULT)
      throw new Error('Salve o endereço, a instância e o token da Evolution antes de conectar.')
    }
    return c
  }

  return {
    info: () => {
      if (!deps.events.evolution() && deps.events.current().state === 'off' && deps.vault.settings().hasToken) start()
      return info()
    },

    async save(raw) {
      const d = cleanCrmWhatsappDraft(raw)
      const base = evolutionBase(d.url)
      if (d.token) {
        secret(d.token)
        if (!deps.vault.available()) throw new Error(NO_VAULT)
        const c = deps.client({ url: base.base, instance: d.instance, token: d.token })
        // The global key opens every instance of the server: the CRM refuses to keep it.
        let global: boolean
        try {
          global = await c.probeGlobalKey()
        } catch (err) {
          throw new Error(`Não consegui conferir o token: ${errorText(err)}`, { cause: err })
        }
        if (global)
          throw new Error(
            'Isso é a chave global do servidor, não o token da instância. A chave global abre todas as instâncias: cole o token da instância (painel da Evolution → instância → token).',
          )
        try {
          await c.state()
        } catch (err) {
          if ((err as { status?: number }).status === 401 || (err as { status?: number }).status === 403)
            throw new Error(`Esse token não abre a instância "${d.instance}". Copie o token dessa instância no painel da Evolution.`, {
              cause: err,
            })
          throw err
        }
      }
      deps.vault.save({ url: base.base, instance: d.instance, ...(d.token !== undefined ? { token: d.token } : {}) })
      log.info(`CRM: WhatsApp configurado (${base.local ? 'Evolution local' : 'Evolution remota'})`)
      start()
      return info()
    },

    async connect() {
      const c = linked()
      const qr = await c.qr()
      deps.events.noteQr(qr)
      // Docker publishes on every interface unless the compose says 127.0.0.1: check, and warn.
      if (c.local) deps.events.setLan(await deps.lan(c).catch(() => false))
      return qr
    },

    async test() {
      return selfTest ? selfTest() : NO_SELF_TEST
    },

    async disconnect() {
      const c = deps.events.evolution()
      if (!c) return
      await c.logout()
      await deps.events.refresh()
    },

    setSelfTest(fn) {
      selfTest = fn
    },

    start,
  }
}

/** The channels the preload uses, by name. Exported for the tests. */
export function crmWhatsappHandlers(api: CrmWhatsappApi): Record<string, (...args: unknown[]) => unknown> {
  return {
    'office:crmWhatsapp': () => api.info(),
    'office:saveCrmWhatsapp': (draft) => api.save(draft),
    'office:connectCrmWhatsapp': () => api.connect(),
    'office:testCrmWhatsapp': () => api.test(),
    'office:disconnectCrmWhatsapp': () => api.disconnect(),
  }
}

/** What index.ts keeps: the coordinator ties the Outbox, the gate and the hooks to these (CR-14). */
export interface CrmWhatsapp {
  api: CrmWhatsappApi
  /** ConnectionView, plus sender() for the Outbox and onInbound for the exit and alert words. */
  events: EvolutionEvents
  conversations: ConversationStore
  /** Starts the link when the CRM is on (and the vault has a token). */
  start(): void
  stop(): void
  flush(): void
}

export function registerCrmWhatsappIpc(ctx: Pick<IpcContext, 'crmStore' | 'broadcast'>, dir: string): CrmWhatsapp {
  const vault = new CrmVault(dir)
  const conversations = new ConversationStore(dir)
  const lan = (c: EvolutionClient) => lanExposed(c.port, { https: c.base.startsWith('https:') })
  const events = new EvolutionEvents({ store: ctx.crmStore, conversations, broadcast: ctx.broadcast, lan })
  const api = crmWhatsappApi({ vault, events, client: (cfg) => new EvolutionClient(cfg), lan })
  for (const [channel, handler] of Object.entries(crmWhatsappHandlers(api)))
    ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args))
  return {
    api,
    events,
    conversations,
    start: () => api.start(),
    stop: () => events.stop(),
    flush: () => conversations.flush(),
  }
}
