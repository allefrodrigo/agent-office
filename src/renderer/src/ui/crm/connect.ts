import { connectionDotTone, connectionView, portWarning, qrImage, type ConnectionTone } from '@shared/crm-inbound'
import { CRM_LIMITS, type CrmConnection, type CrmQr, type CrmWhatsappDraft, type CrmWhatsappInfo } from '@shared/types'
import { h, icon } from '../dom'
import { confirmDialog, field } from '../modals'
import { crmError, type Toast } from './util'

// Configurações → CRM → WhatsApp (CR-10): endereço da Evolution, instância e token (campo de senha,
// nunca preenchido: o token não volta ao renderer), "Conectar" com o QR code, o estado com a via,
// "Testar", "Desconectar", os dois avisos do spec e o da porta aberta na rede. connectionDot é o
// ponto do topo da tela do CRM. Todo texto do servidor entra por textContent; o QR, só como PNG.

const DEFAULT_URL = 'http://localhost:8080'
/** The QR code on the server changes about every 20 s: read it again while it shows. */
const QR_REFRESH_MS = 20_000
/** Right after "Conectar" the server may not have drawn the code yet. */
const QR_FIRST_MS = 3_000
/** Then give up (about 4 minutes); the server stops drawing codes too. */
const QR_TRIES = 12
/** A box left behind (settings closed) stops listening at the next check. */
const ALIVE_MS = 15_000

const DOT: Record<ConnectionTone, string> = { on: 'dot-working', busy: 'dot-waiting', error: 'dot-error', off: 'dot-idle' }

/** The two warnings of the spec: they show until the player clicks "Entendi", once per machine. */
const NOTICES = {
  unofficial: {
    key: 'agent-office:crm-aviso-nao-oficial',
    title: 'Conexão não oficial.',
    text: 'A Evolution, no modo padrão (Baileys), usa o protocolo do WhatsApp Web. O WhatsApp pode bloquear números que disparam em volume. Use um número só do negócio, comece devagar e mantenha os limites. A API oficial (Cloud API) é o caminho para volume.',
  },
  rehearsal: {
    key: 'agent-office:crm-aviso-ensaio',
    title: 'Modo ensaio ligado.',
    text: 'Nos primeiros dias, nada é enviado sozinho: o bot escreve, o portão decide, e a tela mostra o que teria saído. Você desliga o ensaio quando confiar.',
  },
} as const

const NO_VAULT_HINT =
  'Este computador não oferece um cofre para guardar o token (no Linux, instale e destrave o gnome-keyring ou o KWallet). Sem cofre, o CRM não guarda o token.'

// ---------- o estado, dividido entre a caixa e o ponto ----------

let lastConnection: CrmConnection | null = null
const watchers = new Set<(c: CrmConnection) => void>()
let unsubscribe: (() => void) | null = null

function publish(c: CrmConnection): void {
  lastConnection = c
  for (const fn of watchers) fn(c)
}

/** Every link change the main process sends, and every one a box reads. Returns the unsubscribe. */
function watchConnection(fn: (c: CrmConnection) => void): () => void {
  watchers.add(fn)
  unsubscribe ??= window.office.onEvent((e) => {
    if (e.type === 'crm:connection') publish(e.connection)
  })
  if (lastConnection) fn(lastConnection)
  return () => {
    watchers.delete(fn)
    if (!watchers.size && unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }
}

function seen(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function markSeen(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // no storage: the warning comes back next time, which is fine
  }
}

/** A spec warning with its "Entendi"; null when the player already read it. */
function notice(n: { key: string; title: string; text: string }): HTMLElement | null {
  if (seen(n.key)) return null
  const ok = h('button', { class: 'btn btn-small', type: 'button' }, 'Entendi')
  const el = h(
    'div',
    { class: 'crm-connect-notice' },
    icon('alert', 16),
    h('div', { class: 'crm-connect-notice-text' }, h('strong', {}, n.title), ' ', n.text),
    ok,
  )
  ok.addEventListener('click', () => {
    markSeen(n.key)
    el.remove()
  })
  return el
}

// ---------- a caixa de Configurações → CRM ----------

export function connectBox(opts: { toast: Toast }): { el: HTMLElement; dispose(): void } {
  const dot = h('span', { class: 'dot dot-idle', 'aria-hidden': 'true' })
  const label = h('span', { class: 'crm-connect-label' }, 'Lendo a conexão…')
  const via = h('span', { class: 'crm-connect-via hidden' })
  const detail = h('div', { class: 'field-hint crm-connect-detail' })
  const head = h('div', { class: 'crm-connect-head', role: 'status', 'aria-live': 'polite' }, dot, label, via)

  const urlIn = h('input', {
    class: 'input',
    type: 'url',
    placeholder: DEFAULT_URL,
    maxlength: CRM_LIMITS.url,
    spellcheck: 'false',
    autocomplete: 'off',
  }) as HTMLInputElement
  const instanceIn = h('input', {
    class: 'input',
    placeholder: 'escritorio',
    maxlength: CRM_LIMITS.instance,
    spellcheck: 'false',
    autocomplete: 'off',
  }) as HTMLInputElement
  // Never filled with the stored token: the main process does not send it back.
  const tokenIn = h('input', {
    class: 'input',
    type: 'password',
    maxlength: CRM_LIMITS.token,
    spellcheck: 'false',
    autocomplete: 'new-password',
  }) as HTMLInputElement
  const tokenNote = h('span', {})

  const button = (text: string, name: string, cls = 'btn') =>
    h('button', { class: cls, type: 'button' }, icon(name, 15), h('span', {}, text)) as HTMLButtonElement
  const saveBtn = button('Salvar', 'check')
  saveBtn.title = 'Guarda o endereço, a instância e o token (só esta caixa)'
  const connectBtn = button('Conectar', 'plug', 'btn btn-primary')
  const testBtn = button('Testar', 'send')
  testBtn.title = 'Manda uma mensagem de teste para o seu próprio número'
  const disconnectBtn = button('Desconectar', 'power')
  const buttons = [saveBtn, connectBtn, testBtn, disconnectBtn]

  const qrImg = h('img', {
    class: 'crm-connect-qr-img hidden',
    alt: 'QR code para conectar o WhatsApp',
    width: 200,
    height: 200,
  }) as HTMLImageElement
  const qrWait = h('div', { class: 'crm-connect-qr-wait' }, 'Gerando o QR code…')
  const pairing = h('div', { class: 'field-hint hidden' })
  const qrBox = h(
    'div',
    { class: 'crm-connect-qr hidden' },
    qrImg,
    qrWait,
    h(
      'div',
      { class: 'crm-connect-qr-text' },
      h('strong', {}, 'Leia o QR code no celular do negócio'),
      h(
        'ol',
        { class: 'crm-connect-steps' },
        h('li', {}, 'Abra o WhatsApp.'),
        h('li', {}, 'Toque em Configurações → Aparelhos conectados → Conectar um aparelho.'),
        h('li', {}, 'Aponte a câmera para o código.'),
      ),
      pairing,
      h('div', { class: 'field-hint' }, 'O código se renova sozinho. Lido, o ponto fica verde.'),
    ),
  )

  const lanBox = h('div', { class: 'crm-connect-warn hidden' })
  const unofficialSlot = h('div', { class: 'crm-connect-slot' }, notice(NOTICES.unofficial))
  const rehearsalSlot = h('div', { class: 'crm-connect-slot' })

  const el = h(
    'div',
    { class: 'bridge-box crm-connect' },
    h('div', { class: 'bridge-title' }, icon('plug', 16), 'Conexão com a Evolution'),
    head,
    detail,
    lanBox,
    unofficialSlot,
    rehearsalSlot,
    h(
      'div',
      { class: 'field-row' },
      field('Endereço da Evolution', urlIn, 'Padrão: http://localhost:8080, a Evolution desta máquina. Fora dela, só com https://.'),
      field('Instância', instanceIn, 'O nome da instância no painel da Evolution.'),
    ),
    field('Token da instância', tokenIn, tokenNote),
    h('div', { class: 'bridge-row bridge-row-start crm-connect-actions' }, saveBtn, connectBtn, testBtn, disconnectBtn),
    qrBox,
  )

  /** What the main process said last (null until the first read answers). */
  let saved: CrmWhatsappInfo | null = null
  let conn: CrmConnection = { state: 'off' }
  let busy: 'save' | 'connect' | 'test' | 'disconnect' | null = null
  let disposed = false
  let qrShown = false
  /** A code came at least once since "Conectar" (else the server never drew one). */
  let qrDrawn = false
  let qrTries = 0
  let qrTimer: ReturnType<typeof setTimeout> | null = null

  /** The form differs from what is stored (or a token was typed). */
  const dirty = () =>
    !!saved && ((urlIn.value.trim() || DEFAULT_URL) !== saved.url || instanceIn.value.trim() !== saved.instance || !!tokenIn.value.trim())

  function render(): void {
    const v = connectionView(conn)
    dot.className = `dot ${DOT[connectionDotTone(conn)]}`
    label.textContent = v.label
    detail.textContent = v.detail
    const live = conn.state === 'open' || conn.state === 'connecting'
    via.textContent = conn.via === 'websocket' ? 'via WebSocket' : 'via busca'
    via.title =
      conn.via === 'websocket' ? 'As mensagens chegam pelo WebSocket da Evolution.' : 'O app busca as mensagens novas a cada 20 s.'
    via.classList.toggle('hidden', !live || !conn.via)

    const w = portWarning(conn, saved?.url ?? DEFAULT_URL)
    lanBox.classList.toggle('hidden', !w)
    // Rebuilt only when the lines change: a render keeps the player's selection in them.
    if (w && lanBox.dataset.line !== w.to) {
      lanBox.dataset.line = w.to
      lanBox.replaceChildren(
        icon('alert', 16),
        h(
          'div',
          { class: 'crm-connect-warn-text' },
          h('strong', {}, `A porta ${w.port} da Evolution está aberta para a rede.`),
          ' Qualquer aparelho nesta rede alcança a API. No docker-compose.yml, troque a linha',
          h('pre', { class: 'code' }, w.from),
          'por',
          h('pre', { class: 'code' }, w.to),
          'e reinicie a Evolution (Servidor local, abaixo: Desligar e Ligar).',
        ),
      )
    }

    tokenIn.placeholder = saved?.hasToken ? 'Token guardado no cofre' : 'Cole o token da instância'
    tokenNote.textContent =
      saved && !saved.vault
        ? NO_VAULT_HINT
        : saved?.hasToken
          ? 'Token guardado no cofre do sistema. Deixe em branco para manter; cole outro para trocar.'
          : 'O token da instância, no painel da Evolution. Não cole a chave global do servidor.'

    const configured = !!saved?.instance && !!saved.hasToken
    connectBtn.classList.toggle('hidden', conn.state === 'open')
    testBtn.classList.toggle('hidden', conn.state !== 'open')
    disconnectBtn.classList.toggle('hidden', !configured || !live)
    for (const b of buttons) b.disabled = !saved || busy !== null
    connectBtn.lastElementChild!.textContent = busy === 'connect' ? 'Conectando…' : 'Conectar'
    saveBtn.lastElementChild!.textContent = busy === 'save' ? 'Salvando…' : 'Salvar'
    el.setAttribute('aria-busy', String(busy !== null))
  }

  /** The stored settings, into the form (on the first read and after saving). */
  function apply(info: CrmWhatsappInfo): void {
    saved = info
    urlIn.value = info.url || DEFAULT_URL
    instanceIn.value = info.instance
    tokenIn.value = ''
    publish(info.connection)
  }

  function hideQr(): void {
    qrShown = false
    qrDrawn = false
    qrTries = 0
    if (qrTimer) clearTimeout(qrTimer)
    qrTimer = null
    qrImg.removeAttribute('src')
    qrBox.classList.add('hidden')
  }

  function scheduleQr(ms: number): void {
    if (qrTimer) clearTimeout(qrTimer)
    qrTimer = setTimeout(() => void rereadQr(), ms)
  }

  /** "Conectar" answered: draw the code (only a PNG data URL), or say it is connected. */
  function showQr(qr: CrmQr): void {
    if (disposed) return
    if (qr.state === 'open') {
      opts.toast(qrShown ? 'WhatsApp conectado.' : 'O WhatsApp já está conectado.', 'ok')
      return hideQr()
    }
    const src = qrImage(qr.qr)
    qrShown = true
    qrDrawn ||= !!src
    qrBox.classList.remove('hidden')
    qrImg.classList.toggle('hidden', !src)
    qrWait.classList.toggle('hidden', !!src)
    if (src) qrImg.src = src
    pairing.classList.toggle('hidden', !qr.pairingCode)
    pairing.replaceChildren(
      ...(qr.pairingCode
        ? ['Ou toque em "Conectar com número de telefone" e digite ', h('strong', { class: 'crm-connect-pair' }, qr.pairingCode), '.']
        : []),
    )
    scheduleQr(src ? QR_REFRESH_MS : QR_FIRST_MS)
  }

  async function rereadQr(): Promise<void> {
    qrTimer = null
    if (disposed || !qrShown) return
    if (!el.isConnected) return dispose()
    // Read, scanned or expired meanwhile: asking again would start a new code on the server.
    if (conn.state !== 'connecting') return hideQr()
    if (++qrTries > QR_TRIES) {
      const drawn = qrDrawn
      hideQr()
      return opts.toast(
        drawn
          ? 'O QR code expirou sem leitura. Clique em Conectar para gerar outro.'
          : 'A Evolution não mandou o QR code. Confira se ela está ligada e clique em Conectar de novo.',
        'err',
      )
    }
    try {
      showQr(await window.office.connectCrmWhatsapp())
    } catch (err) {
      hideQr()
      opts.toast(crmError(err), 'err')
    }
  }

  async function run(action: NonNullable<typeof busy>, fn: () => Promise<void>): Promise<void> {
    if (busy || disposed) return
    busy = action
    render()
    try {
      await fn()
    } catch (err) {
      opts.toast(crmError(err), 'err')
    } finally {
      busy = null
      if (!disposed) render()
    }
  }

  async function save(): Promise<void> {
    const instance = instanceIn.value.trim()
    if (!instance) {
      instanceIn.focus()
      throw new Error('Informe o nome da instância, como está no painel da Evolution.')
    }
    const draft: CrmWhatsappDraft = { url: urlIn.value.trim() || DEFAULT_URL, instance }
    const token = tokenIn.value.trim()
    if (token) draft.token = token
    else if (!saved?.hasToken) {
      tokenIn.focus()
      throw new Error('Cole o token da instância (painel da Evolution → instância → token).')
    }
    apply(await window.office.saveCrmWhatsapp(draft))
  }

  saveBtn.addEventListener('click', () =>
    run('save', async () => {
      await save()
      opts.toast('Conexão do WhatsApp salva.', 'ok')
    }),
  )

  connectBtn.addEventListener('click', () =>
    run('connect', async () => {
      if (dirty()) await save()
      hideQr()
      showQr(await window.office.connectCrmWhatsapp())
    }),
  )

  testBtn.addEventListener('click', () =>
    run('test', async () => {
      opts.toast(await window.office.testCrmWhatsapp(), 'info')
    }),
  )

  disconnectBtn.addEventListener('click', () =>
    run('disconnect', async () => {
      const root = el.closest('.backdrop')?.parentElement ?? document.body
      const ok = await confirmDialog(root, {
        title: 'Desconectar o WhatsApp?',
        text: 'O número sai da Evolution e o CRM para de receber e enviar mensagens. Para voltar, clique em Conectar e leia o QR code de novo. O token continua guardado.',
        confirm: 'Desconectar',
        cancel: 'Cancelar',
        danger: true,
      })
      if (!ok) return
      await window.office.disconnectCrmWhatsapp()
      hideQr()
      opts.toast('WhatsApp desconectado. O token continua guardado.', 'ok')
    }),
  )

  const offWatch = watchConnection((c) => {
    if (disposed) return
    conn = c
    if (qrShown && c.state === 'open') {
      hideQr()
      opts.toast('WhatsApp conectado.', 'ok')
    } else if (qrShown && c.state !== 'connecting') hideQr()
    render()
  })

  window.office
    .crmWhatsapp()
    .then((info) => !disposed && apply(info))
    .catch((err) => {
      if (disposed) return
      label.textContent = 'Não consegui ler a conexão do WhatsApp'
      detail.textContent = crmError(err)
    })
  // The rehearsal warning only while rehearsal is on (crm.json).
  if (!seen(NOTICES.rehearsal.key))
    window.office
      .crmList()
      .then((data) => {
        if (!disposed && data.settings.rehearsal) rehearsalSlot.replaceChildren(notice(NOTICES.rehearsal) ?? '')
      })
      .catch(() => undefined)

  const alive = setInterval(() => {
    if (!el.isConnected) dispose()
  }, ALIVE_MS)

  function dispose(): void {
    if (disposed) return
    disposed = true
    hideQr()
    clearInterval(alive)
    offWatch()
  }

  render()
  return { el, dispose }
}

// ---------- o ponto no topo da tela do CRM ----------

/** "WhatsApp" with a dot: green connected, amber waiting for the QR code, red closed or failing, grey not set up. */
export function connectionDot(): { el: HTMLElement; dispose(): void } {
  const dot = h('span', { class: 'dot dot-idle', 'aria-hidden': 'true' })
  const el = h('span', { class: 'crm-connect-dot', role: 'status' }, dot, h('span', {}, 'WhatsApp'))
  let disposed = false

  const render = (c: CrmConnection) => {
    if (disposed) return
    const v = connectionView(c)
    dot.className = `dot ${DOT[connectionDotTone(c)]}`
    el.title = v.detail ? `${v.label}. ${v.detail}` : v.label
    el.setAttribute('aria-label', `WhatsApp: ${v.label}`)
  }
  render({ state: 'off' })
  const off = watchConnection(render)
  window.office
    .crmWhatsapp()
    .then((info) => !disposed && publish(info.connection))
    .catch((err) => {
      if (disposed) return
      el.title = crmError(err)
    })

  return {
    el,
    dispose: () => {
      disposed = true
      off()
    },
  }
}
