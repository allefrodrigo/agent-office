/** Evento que abre a tela do Chat; a tela (ui/chat) escuta em window. */
export const OPEN_CHAT_EVENT = 'agent-office:open-chat'

export interface OpenChatDetail {
  /** Abrir neste fio (Bot.id). Ausente = o último fio visto. */
  threadId?: string
}

/**
 * Abre o Chat dos bots: a tecla C, o botão "Chat" do topo e a notificação de um bot chamam
 * esta função. Ela só avisa; quem abre a tela é ui/chat.
 */
export function openChat(threadId?: string): void {
  const detail: OpenChatDetail = threadId ? { threadId } : {}
  window.dispatchEvent(new CustomEvent<OpenChatDetail>(OPEN_CHAT_EVENT, { detail }))
}
