process.env.TZ = 'America/Sao_Paulo'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrmConnection, OfficeEvent } from '@shared/types'

// CR-14: a fila, a auditoria e a aba Conversas ligadas ao lado do WhatsApp (ipc/crm-chat.ts), com
// o Electron e a Evolution falsos. Nada aqui fala com uma Evolution de verdade.

const h = vi.hoisted(() => ({ handlers: new Map<string, (e: unknown, ...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (e: unknown, ...args: unknown[]) => unknown) => h.handlers.set(channel, fn) },
}))

const { CrmStore } = await import('../src/main/crm/store')
const { ConversationStore } = await import('../src/main/crm/conversations')
const { EvolutionError } = await import('../src/main/crm/contracts')
const { liveSender, wireCrmChat } = await import('../src/main/ipc/crm-chat')

const CHANNELS = ['crmConversations', 'crmConversation', 'crmSend', 'crmDraft', 'crmHandOff', 'crmCheckPhone', 'crmStopAll'].map(
  (n) => `office:${n}`,
)

let dir: string
let store: InstanceType<typeof CrmStore>
let conversations: InstanceType<typeof ConversationStore>
let events: OfficeEvent[]
let selfTest: (() => Promise<string>) | undefined
const side = {
  api: { setSelfTest: (fn: (() => Promise<string>) | undefined) => (selfTest = fn) },
  events: {
    connected: () => false,
    ownNumber: () => undefined,
    current: (): CrmConnection => ({ state: 'off' }),
    sender: () => null,
    evolution: () => null,
    onInbound: undefined as ((customerId: string, item: import('@shared/types').ConversationItem) => void) | undefined,
  },
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ao-crm-wiring-'))
  store = new CrmStore(dir)
  conversations = new ConversationStore(dir)
  events = []
  h.handlers.clear()
  selfTest = undefined
  side.events.onInbound = undefined
})

afterEach(() => {
  conversations.flush()
  store.lock()
  rmSync(dir, { recursive: true, force: true })
})

describe('liveSender', () => {
  it('sem cliente configurado, erro de configuração (que a fila não repete), nunca um envio', async () => {
    const s = liveSender(() => null)
    const err = await s.sendText('5511900000001', 'oi').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EvolutionError)
    expect((err as InstanceType<typeof EvolutionError>).kind).toBe('config')
    expect((err as InstanceType<typeof EvolutionError>).retryable).toBe(false)
  })
})

describe('wireCrmChat', () => {
  it('registra os 7 canais, liga o "Testar" à fila e as palavras de saída ao que chega', async () => {
    const w = wireCrmChat({ crmStore: store, broadcast: (e) => events.push(e), dir, whatsapp: { ...side, conversations } })
    expect([...h.handlers.keys()].sort()).toEqual([...CHANNELS].sort())
    // "Testar" passa pela fila: sem conexão, a fila diz o que fazer
    await expect(selfTest?.()).rejects.toThrow(/não está conectado/)
    // uma palavra de saída que chega tira o cliente das ofertas
    const c = store.saveCustomer({
      name: 'Cliente Teste',
      phones: ['5511900000001'],
      consent: { offers: true, offersSource: 'teste' },
    }).item
    const item = { id: 'wa-1', t: Date.now(), kind: 'in' as const, text: 'PARAR', waId: '1' }
    conversations.put(c.id, item)
    side.events.onInbound?.(c.id, item)
    expect(store.customer(c.id)?.consent.optOutAt).toBeDefined()
    // a confirmação foi para a fila e foi barrada (sem conexão): a lista recebe o resumo
    expect(events.some((e) => e.type === 'crm:summary')).toBe(true)
    w.stop()
  })
})
