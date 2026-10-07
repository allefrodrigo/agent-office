import { AGENT_NAMES, HAIR_COLORS, HAIR_STYLES, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES } from '@shared/describe'
import type { Look, OfficePermissionMode, SessionEntry } from '@shared/types'
import type { State } from '../state'
import { h, icon, timeAgo } from './dom'
import { portrait } from './portrait'

export const LAST_CWD = 'agent-office:last-cwd'

const MODES: { value: OfficePermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Pedir permissão', hint: 'Ele vem até você antes de editar arquivos ou rodar comandos.' },
  { value: 'acceptEdits', label: 'Editar livremente', hint: 'Edita arquivos sozinho; pede antes de rodar comandos.' },
  { value: 'auto', label: 'Automático', hint: 'Um classificador aprova o que é seguro e só traz o resto para você.' },
  { value: 'plan', label: 'Planejar primeiro', hint: 'Só lê o projeto e traz um plano para você aprovar.' },
  { value: 'bypassPermissions', label: 'Sem pedir nada', hint: 'PERIGOSO: roda qualquer comando sem perguntar. Use só em pastas descartáveis.' },
]

const MODELS = [
  { value: '', label: 'Padrão do Claude Code' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
]

export function modal(title: string, body: HTMLElement[], footer: HTMLElement[], onClose: () => void): HTMLDivElement {
  const box = h(
    'div',
    { class: 'modal card' },
    h('div', { class: 'modal-head' }, h('div', { class: 'modal-title' }, title), h('button', { class: 'icon-btn', onclick: onClose }, icon('x', 18))),
    h('div', { class: 'modal-body' }, ...body),
    h('div', { class: 'modal-foot' }, ...footer),
  )
  const backdrop = h('div', { class: 'backdrop' }, box)
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) onClose()
  })
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose()
    e.stopPropagation()
  })
  return backdrop
}

export function field(label: string, control: HTMLElement, hint?: HTMLElement | string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null)
}

/** Styled yes/no dialog. Resolves true on confirm, false on cancel/Esc/backdrop. */
export function confirmDialog(
  root: HTMLElement,
  opts: { title: string; text: string; confirm: string; cancel: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }
    const ok = h('button', { class: opts.danger ? 'btn btn-danger-solid' : 'btn btn-primary', onclick: () => finish(true) }, opts.confirm)
    const el = modal(opts.title, [h('div', { class: 'confirm-text' }, opts.text)], [h('button', { class: 'btn', onclick: () => finish(false) }, opts.cancel), ok], () => finish(false))
    el.classList.add('backdrop-confirm')
    root.append(el)
    ok.focus()
  })
}

const LAST_SUMMON_MODE = 'agent-office:summon-mode'

/**
 * "Chamar agente": just a folder and how much freedom the agent gets. Resolves the
 * choice, or null if the player gave up.
 */
export function openSummon(root: HTMLElement, state: State): Promise<{ cwd: string; permissionMode: OfficePermissionMode } | null> {
  return new Promise((resolve) => {
    let cwd = localStorage.getItem(LAST_CWD) ?? ''
    const cwdLabel = h('span', { class: 'path-label' }, cwd || 'Nenhuma pasta escolhida')
    const pick = h('button', { class: 'btn', type: 'button' }, icon('folder', 15), 'Escolher…')
    const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label)))
    const saved = localStorage.getItem(LAST_SUMMON_MODE)
    mode.value = MODES.some((m) => m.value === saved) ? saved! : state.settings.defaultPermissionMode
    const modeHint = h('span', {})
    const syncHint = () => {
      const m = MODES.find((x) => x.value === mode.value)!
      modeHint.textContent = m.hint
      modeHint.className = m.value === 'bypassPermissions' ? 'warn' : ''
    }
    mode.addEventListener('change', syncHint)
    syncHint()

    let done = false
    const finish = (v: { cwd: string; permissionMode: OfficePermissionMode } | null) => {
      if (done) return
      done = true
      el.remove()
      resolve(v)
    }
    const go = h('button', { class: 'btn btn-primary' }, icon('terminal', 15), 'Chamar')
    const submit = async () => {
      if (!cwd) {
        const p = await window.office.pickFolder()
        if (!p) return
        cwd = p
        cwdLabel.textContent = p
      }
      if (mode.value === 'bypassPermissions' && !confirm('Esse agente vai rodar qualquer comando sem perguntar. Continuar?')) return
      localStorage.setItem(LAST_CWD, cwd)
      localStorage.setItem(LAST_SUMMON_MODE, mode.value)
      finish({ cwd, permissionMode: mode.value as OfficePermissionMode })
    }
    pick.addEventListener('click', async () => {
      const p = await window.office.pickFolder(cwd || undefined)
      if (p) {
        cwd = p
        cwdLabel.textContent = p
      }
    })
    go.addEventListener('click', () => void submit())
    const el = modal(
      'Chamar agente',
      [
        field('Pasta do projeto', h('div', { class: 'path-row' }, cwdLabel, pick)),
        field('Permissões', mode, modeHint),
        h('div', { class: 'field-hint' }, 'Sem tarefa: ele chega e o painel abre para você digitar.'),
      ],
      [h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancelar'), go],
      () => finish(null),
    )
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement)) void submit()
    })
    root.append(el)
    go.focus()
  })
}

export function openHire(root: HTMLElement, state: State, toast: (t: string, k?: 'info' | 'ok' | 'err') => void): void {
  const used = new Set([...state.agents.values()].map((a) => a.name))
  const name = h('input', { class: 'input', value: AGENT_NAMES.find((n) => !used.has(n)) ?? `Agente ${used.size + 1}`, maxlength: 40 })
  let cwd = localStorage.getItem(LAST_CWD) ?? ''
  const cwdLabel = h('span', { class: 'path-label' }, cwd || 'Nenhuma pasta escolhida')
  const pick = h('button', { class: 'btn', type: 'button' }, icon('folder', 15), 'Escolher…')
  pick.addEventListener('click', async () => {
    const p = await window.office.pickFolder()
    if (p) {
      cwd = p
      cwdLabel.textContent = p
    }
  })
  const task = h('textarea', { class: 'input', rows: 5, placeholder: 'Ex.: Adicione testes para o módulo de pagamentos e corrija o que quebrar.' })
  const model = h('select', { class: 'input' }, ...MODELS.map((m) => h('option', { value: m.value }, m.label)))
  model.value = state.settings.defaultModel
  const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label)))
  mode.value = state.settings.defaultPermissionMode
  const modeHint = h('span', {})
  const syncHint = () => {
    const m = MODES.find((x) => x.value === mode.value)!
    modeHint.textContent = m.hint
    modeHint.className = m.value === 'bypassPermissions' ? 'warn' : ''
  }
  mode.addEventListener('change', syncHint)
  syncHint()

  const close = () => el.remove()
  const submit = h('button', { class: 'btn btn-primary' }, icon('plus', 16), 'Contratar')
  submit.addEventListener('click', async () => {
    if (!cwd) return toast('Escolha a pasta do projeto.', 'err')
    if (!task.value.trim()) return toast('Descreva a tarefa.', 'err')
    if (mode.value === 'bypassPermissions' && !confirm('Esse agente vai rodar qualquer comando sem perguntar. Continuar?')) return
    submit.setAttribute('disabled', '')
    try {
      localStorage.setItem(LAST_CWD, cwd)
      const a = await window.office.hire({
        name: name.value.trim() || 'Agente',
        cwd,
        task: task.value.trim(),
        model: model.value || undefined,
        permissionMode: mode.value as OfficePermissionMode,
      })
      toast(`${a.name} está subindo pelo elevador.`, 'ok')
      close()
    } catch (err) {
      toast(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err), 'err')
      submit.removeAttribute('disabled')
    }
  })

  const el = modal(
    'Contratar agente',
    [
      field('Nome', name),
      field('Pasta do projeto', h('div', { class: 'path-row' }, cwdLabel, pick)),
      field('Tarefa', task),
      h('div', { class: 'field-row' }, field('Modelo', model), field('Permissões', mode)),
      h('div', { class: 'field-hint' }, modeHint),
    ],
    [h('button', { class: 'btn', onclick: close }, 'Cancelar'), submit],
    close,
  )
  root.append(el)
  task.focus()
}

export function openSettings(root: HTMLElement, state: State, toast: (t: string, k?: 'info' | 'ok' | 'err') => void): void {
  const s = state.settings
  const look: Look = { ...s.playerLook }
  const name = h('input', { class: 'input', value: s.playerName, maxlength: 24 })
  const preview = h('div', { class: 'look-preview' })
  const renderPreview = () => preview.replaceChildren(portrait(look, 96))
  renderPreview()

  const swatches = (key: keyof Look, colors: string[]) => {
    const row = h('div', { class: 'swatches' })
    const paint = () => row.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === look[key]))
    for (const c of colors) {
      const b = h('button', { class: 'swatch', style: `background:${c}`, type: 'button' })
      b.dataset.c = c
      b.addEventListener('click', () => {
        ;(look[key] as string) = c
        paint()
        renderPreview()
      })
      row.append(b)
    }
    paint()
    return row
  }
  const styles = h('div', { class: 'swatches' })
  for (let i = 0; i < HAIR_STYLES; i++) {
    const b = h('button', { class: 'swatch swatch-style', type: 'button' }, String(i + 1))
    b.classList.toggle('on', look.hairStyle === i)
    b.addEventListener('click', () => {
      look.hairStyle = i
      styles.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i))
      renderPreview()
    })
    styles.append(b)
  }

  const pixel = h('select', { class: 'input' }, ...[2, 3, 4, 5].map((n) => h('option', { value: n }, `${n}px${n === 3 ? ' (padrão)' : ''}`)))
  pixel.value = String(s.pixelSize)
  const notify = h('input', { type: 'checkbox' }) as HTMLInputElement
  notify.checked = s.notifications
  const model = h('select', { class: 'input' }, ...MODELS.map((m) => h('option', { value: m.value }, m.label)))
  model.value = s.defaultModel
  const mode = h('select', { class: 'input' }, ...MODES.map((m) => h('option', { value: m.value }, m.label)))
  mode.value = s.defaultPermissionMode

  const b = state.bridge
  const bridgeStatus = h(
    'div',
    { class: 'bridge-status' },
    h('span', { class: `dot ${b.installed && b.listening ? 'dot-working' : b.installed ? 'dot-error' : 'dot-stopped'}` }),
    b.installed ? (b.listening ? `Conectado (porta ${b.port})` : `Hooks instalados, servidor parado${b.error ? `: ${b.error}` : ''}`) : 'Desconectado',
  )
  const bridgeBtn = h('button', { class: 'btn' }, b.installed ? 'Desconectar' : 'Conectar')
  bridgeBtn.addEventListener('click', async () => {
    const next = b.installed ? await window.office.uninstallBridge() : await window.office.installBridge()
    toast(next.installed ? 'Sessões do terminal conectadas. Abra um novo `claude` no terminal.' : 'Sessões do terminal desconectadas.', 'ok')
    close()
  })

  const close = () => el.remove()
  const save = h('button', { class: 'btn btn-primary' }, icon('check', 16), 'Salvar')
  save.addEventListener('click', async () => {
    await window.office.saveSettings({
      playerName: name.value.trim() || 'Você',
      playerLook: look,
      pixelSize: Number(pixel.value),
      notifications: notify.checked,
      defaultModel: model.value,
      defaultPermissionMode: mode.value as OfficePermissionMode,
    })
    close()
  })

  const el = modal(
    'Configurações',
    [
      h(
        'div',
        { class: 'look-editor' },
        preview,
        h(
          'div',
          { class: 'look-fields' },
          field('Seu nome', name),
          field('Pele', swatches('skin', SKIN_TONES)),
          field('Cabelo', swatches('hair', HAIR_COLORS)),
          field('Corte', styles),
          field('Camiseta', swatches('shirt', SHIRT_COLORS)),
          field('Calça', swatches('pants', PANTS_COLORS)),
        ),
      ),
      h('div', { class: 'field-row' }, field('Pixel art', pixel), field('Modelo padrão', model), field('Permissão padrão', mode)),
      h('label', { class: 'check' }, notify, 'Notificar quando um agente precisar de mim ou terminar'),
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('terminal', 16), 'Sessões do Claude Code no terminal'),
        h(
          'div',
          { class: 'field-hint' },
          'Adiciona hooks HTTP em ~/.claude/settings.json. Cada `claude` aberto no terminal aparece como agente, e os pedidos de permissão vêm até você aqui. Com o app fechado, o terminal funciona normal.',
        ),
        h('div', { class: 'bridge-row' }, bridgeStatus, bridgeBtn),
      ),
    ],
    [
      h('span', { class: 'app-version', title: `Build de ${__APP_BUILD__}` }, `Agent Office v${__APP_VERSION__} · build ${__APP_BUILD__}`),
      h('button', { class: 'btn', onclick: close }, 'Cancelar'),
      save,
    ],
    close,
  )
  root.append(el)
}

const RECENT_MS = 2 * 60 * 1000

/** Resume center: recent Claude Code sessions, with a way to call each one back. */
export function openResume(
  root: HTMLElement,
  state: State,
  actions: { openAgent(id: string): void; toast(t: string, k?: 'info' | 'ok' | 'err'): void },
): void {
  let sessions: SessionEntry[] = []
  const search = h('input', { class: 'input resume-search', placeholder: 'Buscar por título, pedido ou pasta…' })
  const list = h('div', { class: 'resume-list' }, h('div', { class: 'resume-empty' }, 'Carregando sessões…'))
  const close = () => el.remove()

  const callBack = async (s: SessionEntry, btn: HTMLButtonElement) => {
    if (Date.now() - s.lastModified < RECENT_MS) {
      const go = await confirmDialog(root, {
        title: 'Essa sessão pode estar aberta',
        text: 'Ela foi usada há menos de 2 minutos, talvez num terminal. Retomar a mesma sessão em dois lugares ao mesmo tempo mistura as conversas.',
        confirm: 'Chamar mesmo assim',
        cancel: 'Cancelar',
      })
      if (!go) return
    }
    btn.setAttribute('disabled', '')
    try {
      const a = await window.office.recall(s.sessionId)
      close()
      actions.toast(`${a.name} voltou com a sessão "${clip(s.title, 40)}".`, 'ok')
      actions.openAgent(a.id)
    } catch (err) {
      actions.toast(cleanError(err), 'err')
      btn.removeAttribute('disabled')
    }
  }

  const row = (s: SessionEntry): HTMLElement => {
    const owner = [...state.agents.values()].find((a) => a.sessionId === s.sessionId)
    const recent = Date.now() - s.lastModified < RECENT_MS
    const folder = s.cwd ? s.cwd.split(/[\\/]/).filter(Boolean).pop() : 'pasta desconhecida'
    const command = `cd '${(s.cwd ?? '.').replace(/'/g, `'\\''`)}' && claude --resume ${s.sessionId}`
    const badge = owner
      ? h('span', { class: owner.source === 'office' ? 'chip chip-done' : 'chip chip-term' }, owner.source === 'office' ? `no escritório: ${owner.name}` : 'aberta no terminal')
      : recent
        ? h('span', { class: 'chip chip-wait' }, 'usada agora')
        : null
    const callBtn = h('button', { class: 'btn btn-small btn-primary' }, icon('walk', 14), 'Chamar')
    callBtn.addEventListener('click', () => callBack(s, callBtn))
    const actionsEl = owner
      ? h('button', {
          class: 'btn btn-small',
          onclick: () => {
            close()
            actions.openAgent(owner.id)
          },
        }, icon('eye', 14), 'Ver')
      : h(
          'div',
          { class: 'resume-actions' },
          s.cwd ? callBtn : null,
          state.platform === 'darwin' && s.cwd
            ? h('button', {
                class: 'icon-btn',
                title: 'Abrir no Terminal',
                onclick: async () => {
                  const r = await window.office.openInTerminal(s.sessionId)
                  if (r.ok) actions.toast('Abrindo a sessão no Terminal.', 'ok')
                  else actions.toast(r.message ?? 'Não consegui abrir o Terminal.', 'err')
                },
              }, icon('terminal', 15))
            : null,
          h('button', {
            class: 'icon-btn',
            title: `Copiar: claude --resume ${s.sessionId}`,
            onclick: async () => {
              await navigator.clipboard.writeText(command)
              actions.toast('Comando copiado. Cole no terminal.', 'ok')
            },
          }, icon('copy', 15)),
        )
    const prompt = s.firstPrompt && s.firstPrompt !== s.title && !s.title.startsWith(s.firstPrompt.slice(0, 30)) ? s.firstPrompt : null
    return h(
      'div',
      { class: 'resume-row' },
      h(
        'div',
        { class: 'resume-main' },
        h('div', { class: 'resume-title' }, h('span', { class: 'resume-title-text' }, s.title), badge),
        h(
          'div',
          { class: 'resume-meta' },
          icon('folder', 12),
          h('span', { title: s.cwd ?? '' }, folder ?? ''),
          s.branch ? h('span', { class: 'resume-branch' }, s.branch) : null,
          h('span', {}, '·'),
          h('span', {}, timeAgo(s.lastModified)),
          h('span', { class: 'resume-id', title: s.sessionId }, s.sessionId.slice(0, 8)),
        ),
        prompt ? h('div', { class: 'resume-prompt' }, prompt) : null,
      ),
      actionsEl,
    )
  }

  const render = () => {
    const q = search.value.trim().toLowerCase()
    const shown = sessions.filter((s) => !q || [s.title, s.firstPrompt, s.cwd, s.branch, s.sessionId].some((v) => v?.toLowerCase().includes(q)))
    if (!shown.length) {
      list.replaceChildren(h('div', { class: 'resume-empty' }, sessions.length ? 'Nenhuma sessão com esse texto.' : 'Nenhuma sessão salva ainda.'))
      return
    }
    const groups = new Map<string, SessionEntry[]>()
    for (const s of shown) {
      const g = dayGroup(s.lastModified)
      groups.set(g, [...(groups.get(g) ?? []), s])
    }
    list.replaceChildren(...[...groups].flatMap(([g, items]) => [h('div', { class: 'resume-group' }, g), ...items.map(row)]))
  }

  search.addEventListener('input', render)
  const el = modal(
    'Central de resume',
    [h('div', { class: 'field-hint' }, 'Sessões recentes do Claude Code nesta máquina, do terminal ou do escritório. "Chamar" traz a sessão de volta como agente, com o histórico.'), search, list],
    [h('button', { class: 'btn', onclick: close }, 'Fechar')],
    close,
  )
  el.classList.add('backdrop-resume')
  root.append(el)
  search.focus()

  window.office
    .listSessions()
    .then((s) => {
      sessions = s
      render()
    })
    .catch((err) => list.replaceChildren(h('div', { class: 'resume-empty' }, cleanError(err))))
}

function dayGroup(t: number): string {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((day(new Date()) - day(new Date(t))) / 86400000)
  if (diff <= 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  if (diff < 7) return 'Esta semana'
  return 'Mais antigas'
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function cleanError(err: unknown): string {
  return err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
}
