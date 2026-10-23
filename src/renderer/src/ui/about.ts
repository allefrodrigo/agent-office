import './about.css'
import type { AppInfo, UpdateStatus } from '@shared/types'
import { h, icon } from './dom'
import { cleanError, modal } from './modals'
import { currentUpdate, describe, listen, restart } from './updates'

type Toast = (text: string, kind?: 'info' | 'ok' | 'err') => void

const row = (label: string, value: string, mono = false) => [h('dt', {}, label), h('dd', mono ? { class: 'about-mono' } : {}, value)]

function details(info: AppInfo): HTMLElement[] {
  return [
    ...row('Versão', `${info.version} · build ${__APP_BUILD__}${info.packaged ? '' : ' (código-fonte)'}`),
    ...(info.author ? row('Autor', info.author) : []),
    ...(info.license ? row('Licença', info.license) : []),
    ...row('Claude Code', info.claude.replace(/\s*\(Claude Code\)$/, '')),
    ...row('Sistema', info.os),
    ...row('Motor', `Electron ${info.electron} · Chrome ${info.chrome} · Node ${info.node}`),
    ...row(info.packaged ? 'Instalado em' : 'Código em', info.location, true),
    ...row('Dados', info.dataDir, true),
  ]
}

/**
 * Sobre (click on the version chip): package.json and this machine. "Pedir para um agente
 * me atualizar" serves people who downloaded the app and have no GitHub account: an office
 * agent fetches the newest release from the public repository and installs it.
 */
export function openAbout(root: HTMLElement, opts: { toast: Toast; openAgent(id: string): void }): void {
  if (root.querySelector('.backdrop-about')) return
  const desc = h('div', { class: 'about-desc' })
  const list = h('dl', { class: 'about-list' }, ...row('Versão', `${__APP_VERSION__} · build ${__APP_BUILD__}`))
  const status = h('div', { class: 'bridge-status' })
  const hint = h(
    'div',
    { class: 'field-hint' },
    'Um agente do escritório baixa a versão mais nova do GitHub e instala para você. Não precisa de conta no GitHub.',
  )
  const restartBtn = h('button', { class: 'btn hidden', type: 'button', onclick: () => void restart(root) }, 'Reiniciar')
  const ask = h(
    'button',
    { class: 'btn btn-primary', type: 'button' },
    icon('bot', 15),
    'Pedir para um agente me atualizar',
  ) as HTMLButtonElement
  const site = h('button', { class: 'btn hidden', type: 'button' }, 'Página do projeto')
  const copy = h('button', { class: 'btn', type: 'button' }, icon('copy', 14), 'Copiar diagnóstico')

  // A dev build has no auto-update: the line would contradict the button, which still works (git pull).
  const render = (s: UpdateStatus) => {
    status.classList.toggle('hidden', s.state === 'disabled')
    const dot = s.state === 'error' ? 'dot-error' : s.state === 'ready' || s.state === 'latest' ? 'dot-working' : 'dot-stopped'
    status.replaceChildren(h('span', { class: `dot ${dot}` }), describe(s))
    restartBtn.classList.toggle('hidden', s.state !== 'ready')
  }
  const stop = listen(render)
  render(currentUpdate())

  ask.addEventListener('click', async () => {
    ask.disabled = true
    const asked = Date.now()
    try {
      const agent = await window.office.selfUpdate()
      close()
      opts.openAgent(agent.id)
      opts.toast(
        agent.createdAt < asked ? `${agent.name} já está cuidando da atualização.` : `${agent.name} vai cuidar da atualização.`,
        'ok',
      )
    } catch (err) {
      opts.toast(cleanError(err), 'err')
      ask.disabled = false
    }
  })
  copy.addEventListener('click', async () => {
    try {
      await window.office.copyDiagnostics()
      opts.toast('Diagnóstico copiado. Cole na conversa com o suporte.', 'ok')
    } catch (err) {
      opts.toast(cleanError(err), 'err')
    }
  })

  const close = () => {
    stop()
    el.remove()
  }
  const el = modal(
    'Sobre o Agent Office',
    [
      h(
        'div',
        { class: 'about-head' },
        h('span', { class: 'about-mark' }, '✳'),
        h('div', {}, h('div', { class: 'about-name' }, `Agent Office v${__APP_VERSION__}`), desc),
      ),
      list,
      h(
        'div',
        { class: 'bridge-box' },
        h('div', { class: 'bridge-title' }, icon('download', 16), 'Atualização'),
        status,
        hint,
        h('div', { class: 'update-actions' }, ask, restartBtn),
      ),
    ],
    [h('div', { class: 'about-foot-start' }, site, copy), h('button', { class: 'btn', onclick: () => close() }, 'Fechar')],
    () => close(),
  )
  el.classList.add('backdrop-about')
  root.append(el)
  ask.focus()

  void window.office
    .appInfo()
    .then((info) => {
      desc.textContent = info.description ?? ''
      list.replaceChildren(...details(info))
      if (!info.packaged)
        hint.textContent = 'Você roda o código-fonte: o agente traz a versão nova com git pull e npm install, sem mexer nas suas mudanças.'
      if (info.homepage) {
        const url = info.homepage
        site.classList.remove('hidden')
        site.addEventListener('click', () => void window.office.openExternal(url))
      }
    })
    .catch((err) => opts.toast(cleanError(err), 'err'))
}
