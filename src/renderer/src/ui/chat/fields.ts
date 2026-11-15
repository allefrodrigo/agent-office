import { BOT_COLORS, BOT_GROUND_FLOOR, SENSITIVE_KINDS, SENSITIVE_LABEL, type BotPermissionMode, type SensitiveKind } from '@shared/types'
import { h, icon } from '../dom'
import { confirmDialog, MODES } from '../modals'
import { floorChoices, type ChatCtx } from './util'

// Campos que o perfil e o formulário de Novo bot dividem: permissões com "Sempre pedir antes de",
// a cor, e o andar (com a pasta, no térreo).

/** What goes wrong when a sensitive kind stops waiting for a yes. */
const RISK: Record<SensitiveKind, string> = {
  send: 'O bot poderá mandar e-mails, mensagens e posts sem perguntar. Uma mensagem enviada não volta.',
  publish: 'O bot poderá publicar pacotes, releases e deploys sem perguntar. Isso chega a quem usa o seu produto.',
  delete: 'O bot poderá apagar arquivos, pastas, branches e dados sem perguntar. Nem tudo dá para recuperar.',
  pay: 'O bot poderá cobrar, pagar, reembolsar e emitir notas sem perguntar. Dinheiro movido não volta sozinho.',
  push: 'O bot poderá fazer push, abrir e juntar PRs sem perguntar. O que vai para o remoto outras pessoas veem.',
}

const HINT: Record<SensitiveKind, string> = {
  send: 'e-mail, mensagem, post',
  publish: 'npm publish, release, deploy',
  delete: 'rm -r, git clean, DROP TABLE',
  pay: 'cobrança, pagamento, reembolso',
  push: 'git push, abrir e juntar PR',
}

export interface Field<T> {
  el: HTMLElement
  value(): T
  onChange?: () => void
}

/** Permission mode (never "Sem pedir nada") and "Sempre pedir antes de"; unchecking asks first and explains the risk. */
export function permissionsField(
  ctx: ChatCtx,
  initial: { mode: BotPermissionMode; askBefore: readonly SensitiveKind[] },
  onChange: () => void,
): Field<{ mode: BotPermissionMode; askBefore: SensitiveKind[] }> {
  const modes = MODES.filter((m) => m.value !== 'bypassPermissions')
  const mode = h(
    'select',
    { class: 'ch-select', 'aria-label': 'Modo de permissão' },
    ...modes.map((m) => h('option', { value: m.value }, m.label)),
  ) as HTMLSelectElement
  mode.value = modes.some((m) => m.value === initial.mode) ? initial.mode : 'default'
  const modeHint = h('p', { class: 'ch-field-hint' })
  const syncHint = () => (modeHint.textContent = modes.find((m) => m.value === mode.value)?.hint ?? '')
  mode.addEventListener('change', () => {
    syncHint()
    onChange()
  })
  syncHint()
  const checked = new Set(initial.askBefore)
  const boxes = SENSITIVE_KINDS.map((k) => {
    const box = h('input', { type: 'checkbox', checked: checked.has(k) }) as HTMLInputElement
    box.addEventListener('change', () => {
      if (box.checked) {
        checked.add(k)
        return onChange()
      }
      // the guard stays on unless the player confirms, knowing the risk
      box.checked = true
      void confirmDialog(ctx.root, {
        title: `Deixar de pedir antes de "${SENSITIVE_LABEL[k]}"?`,
        text: `${RISK[k]}\n\nVocê pode marcar de novo a qualquer hora.`,
        warn: 'Ação sensível: sem esta marca, o bot age sem o seu sim.',
        confirm: 'Deixar de pedir',
        cancel: 'Continuar pedindo',
        danger: true,
      }).then((yes) => {
        if (!yes) return box.focus()
        box.checked = false
        checked.delete(k)
        onChange()
        box.focus()
      })
    })
    return h('label', { class: 'ch-check' }, box, h('span', {}, SENSITIVE_LABEL[k], h('small', {}, HINT[k])))
  })
  const el = h(
    'div',
    { class: 'ch-perms' },
    h('label', { class: 'ch-field' }, h('span', { class: 'ch-field-label' }, 'Modo'), mode, modeHint),
    h('fieldset', { class: 'ch-field ch-ask-before' }, h('legend', { class: 'ch-field-label' }, 'Sempre pedir antes de'), ...boxes),
  )
  return { el, value: () => ({ mode: mode.value as BotPermissionMode, askBefore: SENSITIVE_KINDS.filter((k) => checked.has(k)) }) }
}

/** The bot's color: swatches of BOT_COLORS as a radio group. */
export function colorField(initial: string, onChange: () => void): Field<string> {
  let current = (BOT_COLORS as readonly string[]).includes(initial) ? initial : BOT_COLORS[0]
  const swatches = BOT_COLORS.map((c, i) =>
    h('button', {
      type: 'button',
      class: 'ch-swatch',
      role: 'radio',
      style: `--sw: ${c}`,
      'aria-label': `Cor ${i + 1}`,
      title: c,
      onclick: () => pick(c),
    }),
  )
  const paint = () =>
    swatches.forEach((s, i) => {
      const on = BOT_COLORS[i] === current
      s.setAttribute('aria-checked', String(on))
      s.tabIndex = on ? 0 : -1
    })
  const pick = (c: string, focus = false) => {
    current = c
    paint()
    if (focus) swatches[BOT_COLORS.indexOf(c as (typeof BOT_COLORS)[number])].focus()
    onChange()
  }
  const el = h('div', { class: 'ch-swatches', role: 'radiogroup', 'aria-label': 'Cor do bot' }, ...swatches)
  el.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const i = BOT_COLORS.indexOf(current as (typeof BOT_COLORS)[number])
    pick(BOT_COLORS[(i + d + BOT_COLORS.length) % BOT_COLORS.length], true)
  })
  paint()
  return { el, value: () => current }
}

/** The floor the bot works on; on the ground floor, the folder too. */
export function floorField(
  ctx: ChatCtx,
  initial: { floor: string; cwd?: string },
  onChange: () => void,
): Field<{ floor: string; cwd?: string }> {
  const floors = floorChoices(ctx.state)
  const select = h(
    'select',
    { class: 'ch-select', 'aria-label': 'Andar' },
    ...floors.map((f) => h('option', { value: f.id }, f.name)),
  ) as HTMLSelectElement
  if (!floors.some((f) => f.id === initial.floor)) select.append(h('option', { value: initial.floor }, 'Andar removido'))
  select.value = initial.floor
  let cwd = initial.cwd ?? ''
  const label = h('span', { class: 'ch-path-label' })
  const pick = h('button', { type: 'button', class: 'btn btn-small' }, icon('folder', 14), 'Escolher…')
  const folder = h('div', { class: 'ch-path' }, label, pick)
  const hint = h('p', { class: 'ch-field-hint' })
  const sync = () => {
    const ground = select.value === BOT_GROUND_FLOOR
    folder.hidden = !ground
    label.textContent = cwd || 'Nenhuma pasta escolhida'
    const project = ctx.state.settings.projects.find((p) => p.id === select.value)
    hint.textContent = ground
      ? 'No térreo, o bot trabalha na pasta que você escolher.'
      : project
        ? `Trabalha em ${project.cwd}.`
        : 'Este andar não existe mais. Escolha outro.'
  }
  select.addEventListener('change', () => {
    sync()
    onChange()
  })
  pick.addEventListener('click', async () => {
    const p = await window.office.pickFolder(cwd || undefined)
    if (!p) return
    cwd = p
    sync()
    onChange()
  })
  sync()
  const el = h('div', { class: 'ch-field' }, h('span', { class: 'ch-field-label' }, 'Andar'), select, folder, hint)
  return { el, value: () => ({ floor: select.value, cwd: select.value === BOT_GROUND_FLOOR ? cwd || undefined : undefined }) }
}
