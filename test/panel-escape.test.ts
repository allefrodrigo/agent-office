import { describe, expect, it } from 'vitest'
import { escapeAction, type EscapeContext } from '../src/renderer/src/ui/panel/escape'

const ctx = (c: Partial<EscapeContext>): EscapeContext => ({ busy: false, overlay: false, inInput: false, menuOpen: false, ...c })

describe('Esc no painel do agente (AO-55)', () => {
  it('com o agente trabalhando, pede para interromper, com ou sem foco na caixa', () => {
    expect(escapeAction(ctx({ busy: true }))).toBe('ask-interrupt')
    expect(escapeAction(ctx({ busy: true, inInput: true }))).toBe('ask-interrupt')
    expect(escapeAction(ctx({ busy: true, menuOpen: true }))).toBe('ask-interrupt')
  })

  it('com janela, quadro ou cartão por cima, não interrompe', () => {
    expect(escapeAction(ctx({ busy: true, overlay: true }))).toBe('none')
    expect(escapeAction(ctx({ busy: true, overlay: true, inInput: true }))).toBe('leave-input')
  })

  it('com o agente parado, mantém o Esc de antes', () => {
    expect(escapeAction(ctx({ inInput: true }))).toBe('leave-input')
    expect(escapeAction(ctx({ menuOpen: true }))).toBe('close-menu')
    expect(escapeAction(ctx({}))).toBe('close-panel')
    expect(escapeAction(ctx({ overlay: true }))).toBe('none')
  })
})
