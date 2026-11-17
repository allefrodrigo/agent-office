import { h } from '../dom'
import type { Toast } from './util'

// Configurações → CRM → WhatsApp (CR-10): endereço da Evolution, instância, token (campo de senha,
// nunca devolvido ao renderer), QR code, estado, "Testar", "Desconectar" e os dois avisos do spec.
// O agente crm-whatsapp preenche esta caixa; o coordenador já a montou em settings-crm.ts.

export function connectBox(_opts: { toast: Toast }): { el: HTMLElement; dispose(): void } {
  return { el: h('div', { class: 'crm-connect', hidden: true }), dispose: () => undefined }
}
