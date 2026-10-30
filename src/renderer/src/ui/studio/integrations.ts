import { creativeReady, type CreativeStatus } from '@shared/creative'
import { h, icon } from '../dom'
import { cleanError } from '../modals'

// The integrations of the creative floor: Codex (ChatGPT images and the agents) first, then the
// local tools for video. Each card says what is missing and how to fix it, from here.

let cached: CreativeStatus | null = null
let loginUrl = ''

/** The last status read, or a fresh read. */
export async function readStatus(force = false): Promise<CreativeStatus> {
  if (!cached || force) cached = await window.office.creativeStatus()
  return cached
}

export const lastStatus = () => cached

/** `codex login` printed its link (creative:login-url). */
export function setLoginUrl(url: string): void {
  loginUrl = url
  for (const fn of urlListeners) fn()
}
const urlListeners = new Set<() => void>()

/**
 * Integrations panel. `onChange` runs with each new status (login, logout, refresh);
 * `compact` drops the local tools (the new-floor dialog only needs Codex).
 */
export function integrationsView(opts: { toast(t: string, k?: 'info' | 'ok' | 'err'): void; onChange?(s: CreativeStatus): void; compact?: boolean }): HTMLElement {
  const el = h('div', { class: 'st-integrations' })
  let status = cached
  let logging = false

  const set = (s: CreativeStatus) => {
    status = cached = s
    render()
    opts.onChange?.(s)
  }
  const refresh = async () => {
    try {
      set(await readStatus(true))
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    }
  }
  const login = async () => {
    logging = true
    loginUrl = ''
    render()
    try {
      const s = await window.office.codexLogin()
      set(s)
      opts.toast(s.codex.loggedIn ? 'Codex conectado à sua conta ChatGPT.' : 'O login não terminou. Tente de novo.', s.codex.loggedIn ? 'ok' : 'err')
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    } finally {
      logging = false
      render()
    }
  }
  const logout = async () => set(await window.office.codexLogout())

  const row = (ok: boolean | 'warn', name: string, detail: string, ...actions: HTMLElement[]) =>
    h(
      'div',
      { class: `st-int${ok === true ? ' ok' : ok === 'warn' ? ' warn' : ''}` },
      h('span', { class: 'st-int-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'st-int-text' }, h('b', {}, name), h('span', {}, detail)),
      h('div', { class: 'st-int-actions' }, ...actions),
    )

  function render(): void {
    if (!status) {
      el.replaceChildren(h('div', { class: 'st-int' }, h('span', { class: 'st-int-text' }, 'Conferindo as integrações…')))
      return
    }
    const c = status.codex
    const codexRow = !c.installed
      ? row(
          false,
          'ChatGPT (Codex)',
          'O Codex não está instalado. No terminal: npm install -g @openai/codex — depois clique em Conferir.',
          h('button', { class: 'btn btn-small', onclick: () => void refresh() }, 'Conferir'),
        )
      : logging
        ? row(
            'warn',
            'ChatGPT (Codex)',
            'Entre com sua conta ChatGPT na janela do navegador que abriu. Volte aqui quando terminar.',
            ...(loginUrl ? [h('button', { class: 'btn btn-small', onclick: () => void window.office.openExternal(loginUrl) }, icon('external', 13), 'Abrir o login')] : []),
            h('button', { class: 'btn btn-small', onclick: () => void window.office.codexCancelLogin() }, 'Cancelar'),
          )
        : c.loggedIn
          ? row(true, 'ChatGPT (Codex)', `Conectado via ${c.account ?? 'ChatGPT'} · codex ${c.version ?? ''}. Gera imagens e roda os agentes do estúdio.`, h('button', { class: 'btn btn-small', onclick: () => void logout() }, 'Sair'))
          : row(
              false,
              'ChatGPT (Codex)',
              c.error ? `O Codex respondeu: ${c.error}` : `Instalado (codex ${c.version ?? ''}), mas sem login.`,
              h('button', { class: 'btn btn-small btn-primary', onclick: () => void login() }, 'Entrar com ChatGPT'),
            )
    const local = opts.compact
      ? []
      : [
          row(status.ffmpeg, 'ffmpeg', status.ffmpeg ? 'Lê vídeos, tira quadros e converte imagens.' : 'Falta para analisar vídeo. No terminal: brew install ffmpeg'),
          row(
            status.whisper.model ? true : 'warn',
            'Transcrição (whisper)',
            status.whisper.model
              ? `Modelo ${status.whisper.model.split('/').pop()}: a fala dos vídeos vira texto com tempo.`
              : status.whisper.bin
                ? 'whisper-cli instalado, sem modelo ggml. A análise usa só os quadros.'
                : 'Opcional: brew install whisper-cpp e um modelo ggml para transcrever a fala.',
          ),
        ]
    el.replaceChildren(codexRow, ...(opts.compact ? [] : [elevenRow()]), ...local)
  }

  /** ElevenLabs: a key file of ~/.config/elevenlabs, or a pasted key the app keeps in the keychain. */
  function elevenRow(): HTMLElement {
    const e = status!.elevenlabs
    const act = (fn: () => Promise<CreativeStatus>, ok: string) =>
      void fn()
        .then((st) => {
          set(st)
          opts.toast(ok, 'ok')
        })
        .catch((err) => opts.toast(cleanError(err), 'err'))
    if (e.configured) {
      const usage = e.limit ? ` · ${(e.used ?? 0).toLocaleString('pt-BR')} de ${e.limit.toLocaleString('pt-BR')} caracteres no mês` : ''
      return row(
        e.error ? 'warn' : true,
        'ElevenLabs',
        e.error ? e.error : `Conectado (${e.source ?? 'chave'})${e.tier ? ` · plano ${e.tier}` : ''}${usage}. Faz as narrações.`,
        h('button', { class: 'btn btn-small', onclick: () => act(() => window.office.elevenForget(), 'ElevenLabs desconectado.') }, 'Desconectar'),
      )
    }
    const key = h('input', { class: 'input st-input', type: 'password', placeholder: 'sk_…', autocomplete: 'off', spellcheck: 'false' })
    return row(
      false,
      'ElevenLabs',
      e.files.length ? 'Achei chaves em ~/.config/elevenlabs. Use uma delas (a chave fica no arquivo) ou cole outra.' : 'Cole sua chave de API (fica guardada no chaveiro do sistema). Serve para as narrações.',
      ...e.files.map((f) => h('button', { class: 'btn btn-small btn-primary', title: `~/.config/elevenlabs/${f}`, onclick: () => act(() => window.office.elevenUseFile(f), `ElevenLabs conectado com ${f}.`) }, `Usar ${f}`)),
      key,
      h('button', { class: 'btn btn-small', onclick: () => key.value.trim() && act(() => window.office.elevenStoreKey(key.value), 'Chave do ElevenLabs guardada.') }, 'Salvar chave'),
    )
  }

  urlListeners.add(render)
  render()
  if (!cached) void refresh()
  return el
}

export { creativeReady }
