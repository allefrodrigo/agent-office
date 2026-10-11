import { ACCOUNT_COLORS, accountPool, MAIN_ACCOUNT } from '@shared/accounts'
import type { Account, AccountStatus, AgentSummary } from '@shared/types'
import type { State } from '../state'
import { h, icon } from './dom'
import { cleanError, confirmDialog, field, modal } from './modals'

type Toast = (t: string, k?: 'info' | 'ok' | 'err') => void

/** "Trabalho", "Trabalho e Pessoal", "Trabalho, Pessoal e Extra". */
function names(state: State, ids: string[]): string {
  const list = ids.map((id) => state.account(id)?.name ?? '?')
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`
}

function poolText(state: State, ids: string[]): string {
  return ids.length > 1 ? `${names(state, ids)}, revezando` : names(state, ids)
}

/** 14:30 */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** "dev@x.com · max", "Sem login", "Sem espaço até 15:00"… */
export function statusText(st: AccountStatus | undefined): { text: string; tone: 'ok' | 'warn' | 'dim' } {
  if (!st || (st.loggedIn === null && !st.error)) return { text: 'Verificando…', tone: 'dim' }
  if (st.loggedIn === false) return { text: 'Sem login', tone: 'warn' }
  if (st.loggedIn === null) return { text: `Não consegui verificar: ${st.error}`, tone: 'warn' }
  const who = [st.email, st.plan].filter(Boolean).join(' · ') || 'Conectada'
  return st.limitedUntil && st.limitedUntil > Date.now() ? { text: `${who} · sem espaço até ${clock(st.limitedUntil)}`, tone: 'warn' } : { text: who, tone: 'ok' }
}

/** Account an agent runs on, as a small colored chip; nothing while there is a single account. */
export function accountChip(state: State, a: AgentSummary): HTMLElement | null {
  if (state.settings.accounts.length < 2 || a.source !== 'office' || !a.account) return null
  const acc = state.account(a.account)
  if (!acc) return null
  return h('span', { class: 'chip chip-account', style: `--acct:${acc.color}`, title: `Rodando na conta ${acc.name}` }, acc.name)
}

/**
 * "Conta" on the hire and summon forms: the project's accounts (default), one
 * account, or all of them taking turns. Absent while there is a single account.
 */
export function accountField(state: State, cwd: () => string): { el: HTMLElement | null; value(): string[] } {
  const accounts = state.settings.accounts
  if (accounts.length < 2) return { el: null, value: () => [] }
  const fromProject = h('option', { value: '' })
  const select = h(
    'select',
    { class: 'input' },
    fromProject,
    ...accounts.map((a) => h('option', { value: a.id }, a.name)),
    h('option', { value: '*' }, `Revezar entre todas (${accounts.length})`),
  ) as HTMLSelectElement
  // The folder can change while the form is open.
  const sync = () => (fromProject.textContent = `Do projeto: ${poolText(state, accountPool(state.settings, cwd()))}`)
  select.addEventListener('pointerdown', sync)
  select.addEventListener('focus', sync)
  sync()
  return {
    el: field('Conta', select, 'Revezando, cada agente começa na conta menos usada e passa para a outra quando o limite acaba.'),
    value: () => (select.value === '*' ? accounts.map((a) => a.id) : select.value ? [select.value] : []),
  }
}

/**
 * Claude accounts: log in, rename, and pick which accounts each floor uses.
 * Changes apply right away.
 */
export function openAccounts(root: HTMLElement, state: State, toast: Toast): void {
  const list = h('div', { class: 'acct-list' })
  const pools = h('div', { class: 'acct-pools' })
  const newName = h('input', { class: 'input', maxlength: 32, placeholder: 'Nome da nova conta (ex.: Trabalho 2)' })
  const add = h('button', { class: 'btn', type: 'button' }, icon('plus', 15), 'Adicionar')
  const check = h('button', { class: 'btn', type: 'button' }, icon('history', 15), 'Verificar logins')

  const fail = (err: unknown) => toast(cleanError(err), 'err')

  const row = (a: Account): HTMLElement => {
    const st = state.accounts.find((x) => x.id === a.id)
    const status = statusText(st)
    const dot = h('button', { class: 'acct-dot', type: 'button', style: `background:${a.color}`, title: 'Trocar a cor' })
    dot.addEventListener('click', () => {
      const color = ACCOUNT_COLORS[(ACCOUNT_COLORS.indexOf(a.color) + 1) % ACCOUNT_COLORS.length]
      window.office.saveSettings({ accounts: state.settings.accounts.map((x) => (x.id === a.id ? { ...x, color } : x)) }).catch(fail)
    })
    const name = h('input', { class: 'input acct-name', value: a.name, maxlength: 32, title: 'Nome da conta' })
    name.addEventListener('change', () => {
      const v = name.value.trim()
      if (!v || v === a.name) return
      window.office.saveSettings({ accounts: state.settings.accounts.map((x) => (x.id === a.id ? { ...x, name: v } : x)) }).catch(fail)
    })
    const login = h('button', { class: st?.loggedIn ? 'btn' : 'btn btn-primary', type: 'button' }, st?.loggedIn ? 'Entrar de novo' : 'Entrar')
    login.addEventListener('click', async () => {
      const r = await window.office.loginAccount(a.id).catch((err) => ({ ok: false, message: cleanError(err) }))
      if (r.ok) toast(`Faça o login de ${a.name} no navegador. Quando terminar, volte aqui.`, 'info')
      else toast(r.message ?? 'Não consegui abrir o terminal.', 'err')
    })
    const folder = a.configDir ?? '~/.claude'
    const cmd = a.configDir ? `CLAUDE_CONFIG_DIR=${a.configDir} claude` : 'claude'
    const copy = h('button', { class: 'icon-btn', type: 'button', title: `Copiar o comando para usar esta conta no terminal:\n${cmd}` }, icon('copy', 14))
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(cmd).then(() => toast('Comando copiado. Cole no terminal para abrir o Claude nesta conta.', 'ok'))
    })
    const remove =
      a.id === MAIN_ACCOUNT
        ? null
        : h('button', { class: 'icon-btn', type: 'button', title: 'Remover a conta (a pasta e o login continuam no disco)' }, icon('trash', 15))
    remove?.addEventListener('click', async () => {
      const ok = await confirmDialog(root, {
        title: `Remover ${a.name}?`,
        text: `Os agentes dela passam para as outras contas do projeto. A pasta ${folder} e o login continuam no disco: adicionar uma conta com o mesmo nome usa os dois de novo.`,
        confirm: 'Remover',
        cancel: 'Cancelar',
        danger: true,
      })
      if (ok) window.office.removeAccount(a.id).catch(fail)
    })
    return h(
      'div',
      { class: 'acct-row' },
      dot,
      h('div', { class: 'acct-main' }, name, h('span', { class: `acct-status acct-${status.tone}`, title: folder }, status.text)),
      login,
      copy,
      remove,
    )
  }

  /** Toggle chips: none = the default; two or more take turns. */
  const poolRow = (label: string, path: string | null, floorId: string | null, current: string[]): HTMLElement => {
    const chips = state.settings.accounts.map((a) => {
      const on = current.includes(a.id)
      const b = h('button', { class: `acct-chip${on ? ' on' : ''}`, type: 'button', style: `--acct:${a.color}` }, a.name)
      b.addEventListener('click', () => {
        const next = on ? current.filter((id) => id !== a.id) : [...current, a.id]
        window.office.setAccountPool(floorId, next).catch(fail)
      })
      return b
    })
    const fallback = floorId === null ? state.account(MAIN_ACCOUNT)?.name ?? 'Principal' : `padrão: ${poolText(state, accountPool(state.settings, undefined))}`
    const summary = current.length ? poolText(state, current) : fallback
    return h(
      'div',
      { class: 'acct-pool' },
      h('div', { class: 'acct-pool-head' }, h('span', { class: 'acct-pool-name' }, label), h('span', { class: 'acct-pool-sum' }, summary)),
      path ? h('div', { class: 'acct-pool-path', title: path }, path) : null,
      h('div', { class: 'acct-chips' }, ...chips),
    )
  }

  const render = () => {
    // Keep typing in a name field: re-render once it loses focus.
    if (document.activeElement instanceof HTMLInputElement && list.contains(document.activeElement)) return
    const s = state.settings
    list.replaceChildren(...s.accounts.map(row))
    pools.replaceChildren(
      poolRow('Térreo e outras pastas', null, null, s.defaultAccounts),
      ...s.projects.map((p) => poolRow(p.name, p.cwd, p.id, p.accounts ?? [])),
    )
  }
  list.addEventListener('focusout', () => setTimeout(render, 0))

  const addAccount = async () => {
    const v = newName.value.trim()
    if (!v) return toast('Dê um nome para a conta.', 'err')
    add.setAttribute('disabled', '')
    try {
      const s = await window.office.addAccount(v)
      newName.value = ''
      const made = s.accounts[s.accounts.length - 1]
      toast(`${made.name} criada em ${made.configDir}. Clique em "Entrar" para fazer o login.`, 'ok')
    } catch (err) {
      fail(err)
    } finally {
      add.removeAttribute('disabled')
    }
  }
  add.addEventListener('click', () => void addAccount())
  newName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void addAccount()
  })
  check.addEventListener('click', async () => {
    check.setAttribute('disabled', '')
    await window.office.checkAccounts().catch(fail)
    check.removeAttribute('disabled')
  })

  const off = state.onChange(render)
  const close = () => {
    off()
    el.remove()
  }
  render()
  const el = modal(
    'Contas do Claude',
    [
      h(
        'div',
        { class: 'field-hint' },
        'Cada conta tem o próprio login e os próprios limites de 5h e da semana. Skills, configurações, sessões e memória são as mesmas em todas: as contas extras usam o seu ~/.claude por links.',
      ),
      list,
      h('div', { class: 'acct-add' }, newName, add),
      h('div', { class: 'bridge-title' }, icon('users', 16), 'Quem usa cada conta'),
      h(
        'div',
        { class: 'field-hint' },
        'Marque duas ou mais para revezar: cada agente começa na conta menos usada e, se ela bater o limite no meio da tarefa, continua a mesma conversa na outra.',
      ),
      pools,
    ],
    [check, h('button', { class: 'btn btn-primary', onclick: close }, 'Fechar')],
    close,
  )
  root.append(el)
  void window.office.checkAccounts().catch(() => undefined)
}
