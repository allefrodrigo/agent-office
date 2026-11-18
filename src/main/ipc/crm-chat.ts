// A aba Conversas da Sala de CRM (CR-14): ler, enviar à mão, o cartão do rascunho, "Passar para
// mim", conferir o número e "Parar tudo". Todo argumento passa por validate.ts antes de chegar
// ao CrmChat; o envio segue para a fila (Outbox), que passa pelo portão.
import { ipcMain } from 'electron'
import type { CrmChat } from '../crm/chat'
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

export function registerCrmChatIpc(chat: CrmChat): void {
  for (const [channel, handler] of Object.entries(crmChatHandlers(chat)))
    ipcMain.handle(channel, (_e, ...args: unknown[]) => handler(...args))
}
