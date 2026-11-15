import type { BotState } from '@shared/bots-view'
import type { Look } from '@shared/types'
import { h } from '../dom'
import { portrait } from '../portrait'

// O avatar de um bot: o retrato em pixel art do próprio agente sobre um quadrado arredondado na
// cor do bot, com um ponto de estado. Arte própria (veja a memória do projeto sobre a arte 2D).

const STATE_LABEL: Record<BotState, string> = {
  waiting: 'esperando você',
  working: 'trabalhando',
  failed: 'a última rodada falhou',
  idle: '',
}

/** `size` in px; the dot shows only for a state worth seeing. */
export function botAvatar(bot: { look: Look; color: string; name: string }, state: BotState = 'idle', size = 36): HTMLElement {
  const face = portrait(bot.look, Math.round(size * 0.82))
  face.setAttribute('aria-hidden', 'true')
  const el = h('span', { class: `ch-avatar s-${state}`, style: `--av: ${bot.color}; --av-size: ${size}px` }, face)
  if (state !== 'idle')
    el.append(h('span', { class: 'ch-avatar-dot', role: 'img', 'aria-label': STATE_LABEL[state], title: STATE_LABEL[state] }))
  return el
}
