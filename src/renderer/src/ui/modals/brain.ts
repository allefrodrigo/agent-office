import type { AgentBrain, EffortLevel, OfficePermissionMode } from '@shared/types'
import { h } from '../dom'

// Permission modes, models and the effort meter: what an agent runs with.

export const MODES: { value: OfficePermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Pedir permissão', hint: 'Ele vem até você antes de editar arquivos ou rodar comandos.' },
  { value: 'acceptEdits', label: 'Editar livremente', hint: 'Edita arquivos sozinho; pede antes de rodar comandos.' },
  { value: 'auto', label: 'Automático', hint: 'Um classificador aprova o que é seguro e só traz o resto para você.' },
  { value: 'plan', label: 'Planejar primeiro', hint: 'Só lê o projeto e traz um plano para você aprovar.' },
  { value: 'bypassPermissions', label: 'Sem pedir nada', hint: 'PERIGOSO: roda qualquer comando sem perguntar. Use só em pastas descartáveis.' },
]

export const MODELS = [
  { value: '', label: 'Padrão do Claude Code', hint: 'O modelo configurado no seu Claude Code (/model).' },
  { value: 'fable', label: 'Fable', hint: 'O mais capaz e o mais caro. Pode exigir créditos de uso.' },
  { value: 'opus', label: 'Opus', hint: 'Forte em tarefas longas e código difícil.' },
  { value: 'sonnet', label: 'Sonnet', hint: 'Equilíbrio entre qualidade, velocidade e custo.' },
  { value: 'haiku', label: 'Haiku', hint: 'Rápido e barato, para tarefas simples.' },
]

export const EFFORTS: { value: EffortLevel | ''; label: string; title: string; hint: string; stats?: [depth: number, speed: number, cost: number] }[] = [
  { value: '', label: 'Padrão do modelo', title: 'Auto', hint: 'O modelo usa o esforço padrão dele.' },
  { value: 'low', label: 'Baixo', title: 'Passeio', hint: 'Pensa pouco. Bom para perguntas rápidas e ajustes pequenos.', stats: [1, 5, 1] },
  { value: 'medium', label: 'Médio', title: 'Trote', hint: 'Pensa o suficiente para o trabalho do dia a dia.', stats: [2, 4, 2] },
  { value: 'high', label: 'Alto', title: 'Foco', hint: 'Pensa com cuidado antes de agir. Bom para features e bugs chatos.', stats: [3, 3, 3] },
  { value: 'xhigh', label: 'Extra alto', title: 'Turbo', hint: 'Pensa bastante. Para refatorações grandes e problemas difíceis.', stats: [4, 2, 4] },
  { value: 'max', label: 'Máximo', title: 'Modo lenda', hint: 'Sem economia. O Claude Code rebaixa se o modelo não aceitar.', stats: [5, 1, 5] },
]

/**
 * Effort as a charge meter: bars that light up to the chosen level, cool to hot,
 * with depth/speed/cost pips so the trade-off is visible before hiring.
 * Arrow keys move the charge; hovering previews a level without picking it.
 */
export function effortMeter(initial: string, compact = false): { el: HTMLElement; value(): EffortLevel | '' } {
  let current = EFFORTS.findIndex((e) => e.value === initial)
  if (current < 0) current = 0
  const tiles = EFFORTS.map((e, i) =>
    h(
      'button',
      { type: 'button', class: `emeter-tile emeter-l${i}`, role: 'radio', title: `${e.label}: ${e.hint}`, 'aria-label': e.label },
      i === 0 ? h('span', { class: 'emeter-auto' }, 'A') : h('span', { class: 'emeter-bar' }),
    ),
  )
  const name = h('span', { class: 'emeter-name' })
  const tag = h('span', { class: 'emeter-tag' })
  const hint = h('span', { class: 'emeter-hint' })
  const pips = (label: string) => {
    const row = h('div', { class: 'emeter-stat' }, h('span', { class: 'emeter-stat-label' }, label), h('span', { class: 'emeter-pips' }, ...Array.from({ length: 5 }, () => h('i', {}))))
    return row
  }
  const stats = [pips('Profundidade'), pips('Velocidade'), pips('Custo')]
  const card = h('div', { class: 'emeter-card' }, h('div', { class: 'emeter-head' }, name, tag), compact ? null : h('div', { class: 'emeter-stats' }, ...stats), hint)
  const track = h('div', { class: 'emeter-track', role: 'radiogroup', 'aria-label': 'Esforço' }, ...tiles)
  const el = h('div', { class: `emeter${compact ? ' emeter-compact' : ''}` }, track, card)

  const paint = (shown: number) => {
    const e = EFFORTS[shown]
    el.dataset.level = String(shown)
    tiles.forEach((t, i) => {
      t.classList.toggle('lit', shown > 0 && i > 0 && i <= shown)
      t.classList.toggle('on', i === current)
      t.setAttribute('aria-checked', String(i === current))
      t.tabIndex = i === current ? 0 : -1
    })
    name.textContent = e.title
    tag.textContent = shown === 0 ? 'padrão' : `nível ${shown} · ${e.label.toLowerCase()}`
    hint.textContent = e.hint
    stats.forEach((row, k) => row.querySelectorAll('i').forEach((pip, j) => pip.classList.toggle('on', !!e.stats && j < e.stats[k])))
    card.classList.toggle('emeter-unknown', !e.stats)
  }
  const pick = (i: number, focus = false) => {
    current = Math.max(0, Math.min(EFFORTS.length - 1, i))
    paint(current)
    if (focus) tiles[current].focus()
    // replay the "charge" pop on the new level
    el.classList.remove('emeter-pop')
    void el.offsetWidth
    el.classList.add('emeter-pop')
  }
  tiles.forEach((t, i) => {
    t.addEventListener('click', () => pick(i))
    t.addEventListener('pointerenter', () => paint(i))
  })
  track.addEventListener('pointerleave', () => paint(current))
  track.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (!step) return
    e.preventDefault()
    e.stopPropagation()
    pick(current + step, true)
  })
  paint(current)
  return { el, value: () => EFFORTS[current].value }
}

/**
 * Model picker plus the effort meter, so nobody hires a Haiku on low effort
 * for a migration by mistake.
 */
export function brainFields(initial: { model: string; effort: string }, compact = false): { model: HTMLSelectElement; meter: HTMLElement; hint: HTMLElement; value(): AgentBrain } {
  const model = h('select', { class: 'input' }, ...MODELS.map((m) => h('option', { value: m.value }, m.label))) as HTMLSelectElement
  model.value = MODELS.some((m) => m.value === initial.model) ? initial.model : ''
  const effort = effortMeter(initial.effort, compact)
  const hint = h('span', {})
  const sync = () => {
    const m = MODELS.find((x) => x.value === model.value)!
    hint.textContent = `${m.label}: ${m.hint}`
  }
  model.addEventListener('change', sync)
  sync()
  // '' is sent on purpose: it means "Claude Code's default", not the office default.
  return { model, meter: effort.el, hint, value: () => ({ model: model.value || undefined, effort: effort.value() || undefined }) }
}

/** Not a <label>: a label would forward clicks on its blank space to the first tile. */
export function meterField(label: string, meter: HTMLElement): HTMLElement {
  return h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), meter)
}
