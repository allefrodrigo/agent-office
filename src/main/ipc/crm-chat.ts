// A aba Conversas da Sala de CRM (CR-14): ler, enviar à mão, o cartão do rascunho, "Passar para
// mim", conferir o número e "Parar tudo". Todo argumento passa por validate.ts antes de chegar
// ao CrmChat; o envio segue para a fila (Outbox), que passa pelo portão.
import { ipcMain } from 'electron'
import type { ConversationItem, OfficeEvent } from '@shared/types'
import { AuditFile } from '../crm/audit'
import { CrmChat } from '../crm/chat'
import type { ConversationLog, EvolutionSender } from '../crm/contracts'
import { liveSender, Outbox } from '../crm/outbox'
import type { CrmStore } from '../crm/store'
import {
  cleanCrmFlag,
  cleanCrmId,
  cleanCrmItemId,
  cleanCrmOptItemId,
  cleanCrmSendInput,
  cleanDraftAction,
  cleanDraftText,
} from '../validate'

const GONE = 'Esse cliente não existe mais. Feche a conversa.'

/** The channels the preload uses, by name. Exported for the tests. */
export function crmChatHandlers(chat: Pick<CrmChat, keyof CrmChat>): Record<string, (...args: unknown[]) => unknown> {
  return {
    'office:crmConversations': () => chat.conversations(),
    'office:crmConversation': (customerId, before) => chat.conversation(cleanCrmId(customerId, GONE), cleanCrmOptItemId(before)),
    'office:crmSend': (input) => chat.send(cleanCrmSendInput(input)),
    'office:crmDraft': (customerId, draftId, action, text) =>
      chat.draft(cleanCrmId(customerId, GONE), cleanCrmItemId(draftId), cleanDraftAction(action), cleanDraftText(text)),
    'office:crmHandOff': (customerId, toPlayer) => chat.handOff(cleanCrmId(customerId, GONE), cleanCrmFlag(toPlayer)),
    'office:crmCheckPhone': (customerId) => chat.checkPhone(cleanCrmId(customerId, GONE)),
    'office:crmStopAll': (on) => chat.stopAll(cleanCrmFlag(on)),
  }
}

/** What the wiring needs from the WhatsApp side (CR-08 a CR-10, ipc/crm-whatsapp.ts). */
export interface WhatsappSide {
  api: { setSelfTest(fn: (() => Promise<string>) | undefined): void }
  events: ConstructorParameters<typeof Outbox>[0]['connection'] & {
    sender(): EvolutionSender | null
    evolution(): { checkNumber(number: string): Promise<boolean> } | null
    onInbound?: (customerId: string, item: ConversationItem) => void
  }
  conversations: ConstructorParameters<typeof CrmChat>[0]['conversations']
}

export interface CrmChatWiring {
  chat: CrmChat
  outbox: Outbox
  /** The link opened: the queue looks at what waits (first time: the startup checks too). */
  connected(): void
  stop(): void
}

/**
 * CR-14: the queue, the audit and the Conversas tab tied to the WhatsApp side. "Testar" goes
 * through the queue; what arrives goes through the exit and alert words.
 */
export function wireCrmChat(deps: {
  crmStore: CrmStore
  broadcast(e: OfficeEvent): void
  dir: string
  whatsapp: WhatsappSide
}): CrmChatWiring {
  const { whatsapp } = deps
  const audit = new AuditFile(deps.dir)
  const log = whatsapp.conversations
  // The Outbox writes drafts and sends into the conversation: the list row follows each one.
  const logged: ConversationLog = {
    put: (customerId, item) => {
      log.put(customerId, item)
      const summary = log.summary(customerId)
      if (summary) deps.broadcast({ type: 'crm:summary', summary })
    },
    get: (customerId, itemId) => log.get(customerId, itemId),
    sentSince: (customerId, since) => log.sentSince(customerId, since),
    page: (customerId, before, limit) => log.page(customerId, before, limit),
    summaries: () => log.summaries(),
    markRead: (customerId) => log.markRead(customerId),
    remove: (customerId) => log.remove(customerId),
  }
  const outbox = new Outbox({
    store: deps.crmStore,
    conversations: logged,
    sender: liveSender(() => whatsapp.events.sender()),
    connection: whatsapp.events,
    audit,
    broadcast: deps.broadcast,
  })
  const chat = new CrmChat({
    store: deps.crmStore,
    conversations: whatsapp.conversations,
    outbox,
    audit,
    checkNumber: () => {
      const c = whatsapp.events.evolution()
      return c ? (n) => c.checkNumber(n) : null
    },
    broadcast: deps.broadcast,
  })
  whatsapp.api.setSelfTest(() => outbox.sendSelfTest())
  whatsapp.events.onInbound = (customerId, item) => chat.inbound(customerId, item)
  registerCrmChatIpc(chat)
  return {
    chat,
    outbox,
    // start() is safe to repeat: the stale items were settled the first time; it wakes the queue.
    connected: () => outbox.start(),
    stop: () => outbox.close(),
  }
}

export function registerCrmChatIpc(chat: CrmChat): void {
  for (const [channel, handler] of Object.entries(crmChatHandlers(chat)))
    ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args))
}
